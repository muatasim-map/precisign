import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { chromium, type Browser, type Page } from 'playwright-core';
import { PDFArray, PDFDocument, PDFRawStream } from 'pdf-lib';
import { createApp } from '../backend/src/app';
import { hashPassword } from '../backend/src/auth';
import { migrateAsyncDatabase, openAsyncDatabase } from '../backend/src/asyncDatabase';
import { openDatabase } from '../backend/src/db';
import { MockEmailTransport, type OutboxProcessor } from '../backend/src/email';
import { INITIAL_REQUESTS, INITIAL_WORKFLOWS } from '../shared/data/seedData';
import { SUBMITTABLE_FORMS, type VersionedRequest } from '../shared/types/apiTypes';
import type { RouteAccessRights, WorkflowConfig } from '../shared/types';

const form = 'Administrative & Payment Request';
const password = 'Synthetic-only-2026!';
const signature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQMgkTMgljgFAAEA4CcUNrdOsAAAAASUVORK5CYII=';
const people = [
  ['anzar', 'Anzar Test', 'Operations', 'Admin'],
  ['shekhar', 'Shekhar Test', 'Operations', 'General Manager'],
  ['afzal', 'Afzal Kazi Test', 'Management', 'Director'],
  ['bala', 'Bala Test', 'Accounts', 'Finance'],
  ['dina', 'Dina Test', 'Accounts', 'Finance'],
  ['ravi', 'Ravi Test', 'Accounts', 'Finance'],
  ['guest', 'Guest Test', 'Sales', 'Admin'],
  ['other', 'Other Test', 'Accounts', 'Finance'],
] as const;
const email = (id: string) => id + '@example.test';
const noSigner = Object.fromEntries(SUBMITTABLE_FORMS.map(name => [name, [] as string[]]));
const workflow: WorkflowConfig = {
  ...INITIAL_WORKFLOWS[0], id: 'synthetic-handoff', companyId: 'PEW', formType: form, version: 0,
  signerSelection: 'company-directory', processorTasks: [{ id: 'finance', suggestedUserIds: ['bala'] }],
  stages: INITIAL_WORKFLOWS[0].stages.map((step, index) => ({
    ...step, id: index === 0 ? 'department' : 'final', assignedUserId: index === 0 ? 'shekhar' : 'afzal',
    name: index === 0 ? 'Department Head' : 'Final approver',
    documentSlot: index === 0 ? 'department-head' : undefined,
    isFinalApproval: index === 1, mapsToDocumentSignature: index === 1,
  })),
};
const submission = {
  companyId: 'PEW', formType: form, expectedWorkflowVersion: 1, signatureDataUrl: signature,
  formData: {
    dateOfRequest: '2026-11-21', department: 'Operations', priority: 'Medium',
    workDescription: 'Synthetic payroll stationery payment', documents: INITIAL_REQUESTS[0].formData.documents,
    administrativePayment: { documentDescription: 'QA stationery order', payment: { amount: '120', transferMode: 'Cash', purpose: 'Advance Cash' } },
  },
  attachments: [{ name: 'synthetic.png', dataUrl: signature }],
};

async function pdfFingerprint(bytes: ArrayBuffer) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map(page => {
    const hash = createHash('sha256');
    const contents = page.node.Contents();
    if (contents instanceof PDFRawStream) hash.update(contents.getContents());
    if (contents instanceof PDFArray) {
      for (let index = 0; index < contents.size(); index++) hash.update(contents.lookup(index, PDFRawStream).getContents());
    }
    return { ...page.getSize(), contents: hash.digest('hex') };
  });
}

async function exercise(adapter: 'sqlite' | 'libsql', folder: string, build?: string) {
  const filename = join(folder, 'synthetic.sqlite');
  const open = () => adapter === 'sqlite' ? openDatabase(filename) : openAsyncDatabase('file:' + filename.replaceAll('\\', '/'));
  let db = open();
  if (!('prepare' in db)) await migrateAsyncDatabase(db);
  const query = async (sql: string, args: (string | number)[] = []) => 'prepare' in db
    ? db.prepare(sql).all(...args) : (await db.execute(sql, args)).rows;
  const mockEmail = new MockEmailTransport();
  let server: Server | undefined;
  let worker: OutboxProcessor | undefined;
  let browser: Browser | undefined;
  let origin = '';
  let port = 0;
  const previousEmailUrl = process.env.PRECISIGN_EMAIL_APP_URL;
  const sessions = new Map<string, string>();

  async function start() {
    const site = express();
    server = site.listen(port, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    port = address.port;
    origin = 'http://127.0.0.1:' + port;
    process.env.PRECISIGN_EMAIL_APP_URL = origin;
    const api = await createApp(db, { origin, secureCookies: false, emailTransport: mockEmail });
    worker = (api as unknown as { outboxProcessor: OutboxProcessor }).outboxProcessor;
    site.use((req, res, next) => req.path.startsWith('/api/') ? api(req, res, next) : next());
    if (build) {
      site.use(express.static(build));
      site.get('*', (_req, res) => res.sendFile(join(build, 'index.html')));
    }
  }
  async function stop() {
    worker?.stop();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>(done => server!.close(() => done()));
      server = undefined;
    }
    db.close();
  }
  async function call(id: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    return fetch(origin + '/api' + path, {
      method,
      headers: { Origin: origin, Cookie: sessions.get(id) ?? '', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  async function expectStatus(response: Response, status: number) {
    if (response.status !== status) assert.equal(response.status, status, await response.text());
    return response;
  }
  const jsonRecord = async (response: Response, status = 200) => await (await expectStatus(response, status)).json() as VersionedRequest;
  const approvals = (record: VersionedRequest, actor: string) => call(actor, '/requests/' + record.id + '/approve', {
    expectedRevision: record.revision, signatureDataUrl: signature,
  });
  const handoffMessages = (id: string) => query(
    "SELECT event_type,recipient_user_id,payload_json FROM email_outbox WHERE request_id=? AND event_type IN ('PROCESSOR_HANDOFF','ROUTE_COMPLETED') ORDER BY recipient_user_id", [id]);
  async function signInPage(page: Page, id: string) {
    await page.goto(origin);
    // A first-run product tour (if present in this build) would cover the captured screens; mark it seen for this synthetic account.
    await page.evaluate(user => { try { for (const mode of ['api', 'demo', 'showcase']) localStorage.setItem('precisign.tour.v1.' + mode + '.' + user, 'done'); } catch { /* no storage */ } }, id);
    await page.locator('input[type=email]').fill(email(id));
    await page.locator('input[type=password]').fill(password);
    await page.locator('button[type=submit]').click();
    await page.locator('.preci-shell').waitFor();
  }
  async function screenshot(page: Page, name: string) {
    const artifacts = resolve('.artifacts/processor-handoff');
    mkdirSync(artifacts, { recursive: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Page overflows horizontally: ' + name);
    await page.screenshot({ path: join(artifacts, name + '.png'), animations: 'disabled' });
  }

  try {
    const hash = await hashPassword(password);
    for (const [id, name, department, role] of people) {
      const company = id === 'other' ? 'ICCL' : 'PEW';
      let rights: RouteAccessRights = { signerSteps: noSigner };
      if (id === 'shekhar' || id === 'afzal') rights = { signerSteps: { ...noSigner, [form]: [id === 'afzal' ? 'final' : 'department'] } };
      if (id === 'bala' || id === 'dina' || id === 'ravi' || id === 'other') {
        rights = { ...rights, processorTasks: { [form]: ['finance'] } };
      }
      if (id === 'dina') rights = { ...rights, companyAdmin: true, signerSteps: { ...noSigner, [form]: ['department'] } };
      const companies = id === 'afzal' || id === 'dina' ? ['PEW', 'ICCL'] : [company];
      await query('INSERT INTO users (id,email,name,role,department,company_id,password_hash,route_rights) VALUES (?,?,?,?,?,?,?,?)',
        [id, email(id), name, role, department, company, hash, JSON.stringify({ [company]: rights, ...(id === 'dina' ? { ICCL: { signerSteps: noSigner } } : {}) })]);
      await query('INSERT INTO user_signatures VALUES (?,?,?)', [id, signature, name]);
      await query('INSERT INTO account_access (user_id,company_grants,form_grants,is_super_admin) VALUES (?,?,?,?)', [
        id, JSON.stringify(companies), JSON.stringify({ [company]: [form, 'Admin Work Request'] }), id === 'afzal' ? 1 : 0,
      ]);
    }
    const legacy = { ...INITIAL_WORKFLOWS[0], stages: INITIAL_WORKFLOWS[0].stages.map((step, index) => ({
      ...step, assignedUserId: index === 0 ? 'shekhar' : 'afzal',
    })) };
    await query('INSERT INTO workflows VALUES (?,?,?,?)', ['PEW', 'Admin Work Request', 1, JSON.stringify(legacy)]);
    // Existing accounts without step restrictions retain eligibility on legacy forms.
    for (const id of ['shekhar', 'afzal']) {
      const profile = (await query('SELECT route_rights FROM users WHERE id=?', [id]))[0];
      const rights = JSON.parse(String(profile.route_rights));
      delete rights.PEW.signerSteps['Admin Work Request'];
      await query('UPDATE users SET route_rights=? WHERE id=?', [JSON.stringify(rights), id]);
    }
    await start();
    for (const [id] of people) {
      const response = await expectStatus(await call(id, '/auth/login', { email: email(id), password }), 200);
      const cookie = response.headers.get('set-cookie');
      assert(cookie);
      sessions.set(id, cookie.split(';')[0]);
    }

    const grants = { companyIds: ['PEW'], formsByCompany: { PEW: [form] }, jobTitle: 'Accounts Lead',
      routeRights: { PEW: { signerSteps: noSigner, processorTasks: { [form]: ['finance'] } } } };
    await expectStatus(await call('guest', '/admin/accounts/bala/grants', grants, 'PUT'), 403);
    await expectStatus(await call('afzal', '/admin/accounts/bala/grants', grants, 'PUT'), 204);
    const myProfile = await (await expectStatus(await call('bala', '/auth/me'), 200)).json();
    assert.equal(myProfile.user.jobTitle, 'Accounts Lead');
    assert.deepEqual(myProfile.user.routeRights, grants.routeRights);

    const saveRoute = '/workflows/PEW/' + encodeURIComponent(form);
    await expectStatus(await call('guest', saveRoute, { expectedVersion: 0, workflow }, 'PUT'), 403);
    await expectStatus(await call('dina', '/workflows/ICCL/' + encodeURIComponent(form),
      { expectedVersion: 0, workflow: { ...workflow, companyId: 'ICCL' } }, 'PUT'), 403);
    await expectStatus(await call('dina', saveRoute, { expectedVersion: 0, workflow }, 'PUT'), 200);

    const withHead = { ...submission, signerChoices: { department: 'shekhar', final: 'afzal' }, processorChoices: { finance: ['bala', 'dina'] } };
    await expectStatus(await call('anzar', '/requests', { ...withHead, signerChoices: { final: 'guest' } }), 400);
    await expectStatus(await call('anzar', '/requests', { ...withHead, processorChoices: { finance: ['other'] } }), 400);
    await expectStatus(await call('anzar', '/requests', { ...withHead, processorChoices: { finance: [] } }), 400);
    const initial = await jsonRecord(await call('anzar', '/requests', withHead), 201);
    const path = '/requests/' + initial.id;
    const first = await jsonRecord(await approvals(initial, 'afzal'));
    assert.equal(first.status, 'Pending Approval');
    assert.deepEqual(await handoffMessages(initial.id), []);
    assert.equal((await (await call('bala', '/requests')).json() as VersionedRequest[]).some(record => record.id === initial.id), false);
    await expectStatus(await call('bala', path + '/processor-read', { version: 1 }), 409);

    console.log(adapter + ': processor and signer eligibility, delegated settings, early signing passed.');
    if (build) {
      const executablePath = process.env.PRECISIGN_PDF_CHROMIUM;
      browser = await chromium.launch({ executablePath, channel: !executablePath && !existsSync(chromium.executablePath()) && process.platform === 'win32' ? 'msedge' : undefined });
      for (const width of [1366, 390]) {
        const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 940 }, isMobile: width < 500, hasTouch: width < 500, serviceWorkers: 'block' });
        const page = await context.newPage();
        const layout = width < 500 ? 'mobile' : 'desktop';
        await signInPage(page, 'anzar');
        await page.getByRole('heading', { name: /Welcome back, Anzar/ }).waitFor();
        assert.equal(await page.getByText('Needs my action', { exact: true }).count(), 0);
        assert.match(await page.getByRole('button', { name: /^My requests\s+1$/ }).innerText(), /1/);
        await screenshot(page, 'requester-dashboard-' + layout);
        if (width > 500) {
          await page.goto(origin + '/forms/administrative-payment/new');
          const processors = page.getByRole('region', { name: 'Processors after approval' });
          await processors.getByText('Bala Test', { exact: false }).waitFor();
          assert.equal(await processors.getByText('Guest Test', { exact: false }).count(), 0);
          assert.equal(await processors.getByText('Other Test', { exact: false }).count(), 0);
        }
        await context.close();

        const admin = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 1000 }, isMobile: width < 500, hasTouch: width < 500 });
        const directory = await admin.newPage();
        await signInPage(directory, 'afzal');
        await directory.goto(origin + '/settings/users');
        const card = directory.locator('.preci-directory-row').filter({ has: directory.getByRole('heading', { name: 'Bala Test' }) });
        await card.getByRole('button', { name: 'Manage access' }).click();
        const dialog = directory.getByRole('dialog');
        await dialog.getByRole('heading', { name: 'Access Rights' }).waitFor();
        if (width > 500) {
          await dialog.getByLabel('Job title').fill('Accounts Processor');
          await dialog.getByRole('button', { name: 'Save access' }).click();
          await directory.getByText('Access updated for Bala Test.').waitFor();
          assert.equal((await (await call('bala', '/auth/me')).json()).user.jobTitle, 'Accounts Processor');
          await card.getByRole('button', { name: 'Manage access' }).click();
        }
        assert.equal(await dialog.getByRole('columnheader', { name: 'ICCL' }).isVisible(), width >= 768);
        await screenshot(directory, 'access-rights-' + layout);
        await admin.close();
      }
    }

    if (build) console.log(adapter + ': connected dashboard and matrix captured.');
    const approved = await jsonRecord(await approvals(first, 'shekhar'));
    assert.equal(approved.status, 'Approved');
    assert.equal(approved.processorReads, undefined);
    const messages = await handoffMessages(approved.id);
    assert.deepEqual(messages.map(row => [row.recipient_user_id, row.event_type]), [
      ['anzar', 'ROUTE_COMPLETED'], ['bala', 'PROCESSOR_HANDOFF'], ['dina', 'PROCESSOR_HANDOFF'],
    ]);
    assert.equal(JSON.parse(String(messages[1].payload_json)).portalUrl, origin + path);
    assert.equal(JSON.parse(String(messages[1].payload_json)).dynamicSummary, undefined);
    assert.equal(JSON.parse(String(messages[0].payload_json)).processorHandoff, true);
    await expectStatus(await call('guest', path), 404);
    await expectStatus(await call('other', path), 404);
    await expectStatus(await call('anzar', path + '/processor-read', { version: 1 }), 404);
    await expectStatus(await call('bala', path + '/processor-read', { version: 2 }), 409);
    await expectStatus(await call('bala', path + '/process', { expectedRevision: approved.revision, action: 'payment', note: 'QA' }), 403);
    const attachment = await expectStatus(await call('bala', path + '/attachments/1/' + approved.attachments[0].id), 200);
    assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), Buffer.from(signature.split(',')[1], 'base64'));
    assert.equal((await jsonRecord(await call('bala', path))).processorReads, undefined);

    const pdfArgs = { version: 1, updatedAt: approved.updatedAt };
    const pdfBefore = build && await pdfFingerprint(await (await expectStatus(await call('anzar', path + '/document-pdf', pdfArgs), 200)).arrayBuffer());

    if (browser) {
      const pages = new Map<string, Page>();
      for (const [layout, width] of [['desktop', 1366], ['mobile', 390]] as const) {
        const context = await browser.newContext({ viewport: { width, height: 940 }, isMobile: width < 500, hasTouch: width < 500 });
        const requester = await context.newPage();
        await signInPage(requester, 'anzar');
        await requester.goto(origin + path);
        await requester.getByText('Sent to Accounts', { exact: true }).waitFor();
        await screenshot(requester, 'stepper-awaiting-' + layout);
        await context.close();

        const processor = await browser.newContext({ viewport: { width, height: 940 }, isMobile: width < 500, hasTouch: width < 500 });
        const page = await processor.newPage();
        await signInPage(page, 'bala');
        await page.getByRole('heading', { name: /Approved requests to process/ }).waitFor();
        await page.getByText('New', { exact: true }).waitFor();
        await screenshot(page, 'processor-queue-' + layout);
        pages.set(layout, page);
      }
      await pages.get('desktop')!.bringToFront();
      await pages.get('desktop')!.getByRole('button', { name: 'Open approved request' }).click();
      await pages.get('desktop')!.getByText('Opened by 1 of 2', { exact: true }).waitFor();
      await screenshot(pages.get('desktop')!, 'stepper-read-desktop');
      await pages.get('mobile')!.bringToFront();
      await pages.get('mobile')!.getByRole('button', { name: 'Open approved request' }).click();
      await pages.get('mobile')!.getByText('Opened by 1 of 2', { exact: true }).waitFor();
      await screenshot(pages.get('mobile')!, 'stepper-read-mobile');
    }

    if (build) console.log(adapter + ': connected queue and stepper captured.');
    const receipt = () => call('bala', path + '/processor-read', { version: 1 });
    const readRequests = await Promise.all([receipt(), receipt()]);
    assert(readRequests.some(response => response.status === 200));
    for (const response of readRequests) {
      if (response.status === 503) await expectStatus(await receipt(), 200);
      else await expectStatus(response, 200);
    }
    const read = await jsonRecord(await call('anzar', path));
    assert.equal(read.processorReads?.length, 1);
    assert.equal(read.processorReads?.[0].userId, 'bala');
    assert.equal(read.revision, approved.revision);
    assert.equal(read.updatedAt, approved.updatedAt);
    assert.deepEqual(read.approvalEvidence, approved.approvalEvidence);
    assert.deepEqual(read.frozenVersionPresentations, approved.frozenVersionPresentations);
    assert.deepEqual(read.processing, approved.processing);
    if (build) {
      const pdfAfter = await pdfFingerprint(await (await expectStatus(await call('anzar', path + '/document-pdf', pdfArgs), 200)).arrayBuffer());
      assert.deepEqual(pdfAfter, pdfBefore);
    }

    const dinaRead = await expectStatus(await call('dina', path + '/processor-read', { version: 1 }), 200);
    assert.deepEqual((await dinaRead.json()).processorReads.map((entry: { userId: string }) => entry.userId), ['bala', 'dina']);
    const reassignmentPath = path + '/processor-reassignment';
    await expectStatus(await call('afzal', reassignmentPath, { version: 1, taskId: 'finance', from: 'bala', to: 'ravi', reason: 'QA removal' }), 409);

    let withoutHead: VersionedRequest;
    let second: VersionedRequest;
    if (browser) {
      const submitContext = await browser.newContext({ viewport: { width: 1366, height: 940 } });
      const page = await submitContext.newPage();
      await signInPage(page, 'dina');
      await page.goto(origin + '/forms/administrative-payment/new');
      await page.getByLabel('Work description').fill('Synthetic request sent from the browser');
      await page.getByRole('button', { name: 'Medium', exact: true }).click();
      await page.getByText('Company payment required', { exact: true }).click();
      await page.getByLabel('Amount (SAR)').fill('120');
      const processors = page.getByRole('region', { name: 'Processors after approval' });
      await processors.getByRole('button', { name: 'Change' }).click();
      assert.equal(await processors.getByRole('checkbox', { name: /Bala Test/ }).isChecked(), true);
      await processors.getByRole('checkbox', { name: /Ravi Test/ }).check();
      await processors.getByRole('checkbox', { name: /Ravi Test/ }).uncheck();
      await page.getByRole('button', { name: 'Sign & Submit Request' }).click();
      const submitDialog = page.getByRole('dialog');
      const sent = page.waitForResponse(response => response.url() === origin + '/api/requests' && response.request().method() === 'POST');
      await submitDialog.getByRole('button', { name: 'Apply Signature & Submit' }).click();
      const result = await sent;
      assert.equal(result.status(), 201, await result.text());
      withoutHead = await result.json();
      assert.deepEqual(withoutHead.processorHandoff, [{ taskId: 'finance', userIds: ['bala'] }]);
      await submitContext.close();

      const signContext = await browser.newContext({ viewport: { width: 1366, height: 940 } });
      const signPage = await signContext.newPage();
      await signInPage(signPage, 'afzal');
      await signPage.goto(origin + '/requests/' + withoutHead.id);
      await signPage.getByRole('button', { name: 'Approve & sign', exact: true }).click();
      const signed = signPage.waitForResponse(response => response.url() === origin + '/api/requests/' + withoutHead.id + '/approve' && response.request().method() === 'POST');
      await signPage.getByRole('dialog').getByRole('button', { name: 'Confirm & sign' }).click();
      const response = await signed;
      assert.equal(response.status(), 200, await response.text());
      second = await response.json();
      await signContext.close();
      console.log(adapter + ': submission and final signature through the browser passed.');
    } else {
      withoutHead = await jsonRecord(await call('dina', '/requests', { ...submission, signerChoices: { final: 'afzal' }, processorChoices: { finance: ['bala'] } }), 201);
      second = await jsonRecord(await approvals(withoutHead, 'afzal'));
    }
    assert.equal(withoutHead.approvalSteps.length, 1);
    assert.equal(second.status, 'Approved');
    await expectStatus(await call('dina', '/requests/' + second.id + '/processor-reassignment', {
      version: 1, taskId: 'finance', from: 'bala', to: 'ravi', reason: 'Accounts team shift',
    }), 200);
    await expectStatus(await call('bala', '/requests/' + second.id), 404);
    assert.equal((await jsonRecord(await call('ravi', '/requests/' + second.id))).processorReassignments?.[0].actorId, 'dina');

    const legacySubmission = { ...submission, formType: 'Admin Work Request', formData: {
      ...submission.formData, administrativePayment: undefined,
    }, attachments: [] };
    const previous = await jsonRecord(await call('anzar', '/requests', legacySubmission), 201);
    assert.equal(previous.processorHandoff, undefined);
    assert.equal(previous.approvalSteps.length, 2);

    // Verify that the process and database connection can restart with receipts and grants intact.
    await new Promise(done => setTimeout(done, 150));
    await stop();
    db = open();
    await start();
    const reopened = await jsonRecord(await call('anzar', path));
    assert.equal(reopened.processorReads?.[0].at, read.processorReads?.[0].at);
    assert.equal(reopened.processorReads?.length, 2);
    await expectStatus(await receipt(), 200);
    assert.equal((await jsonRecord(await call('anzar', path))).processorReads?.[0].at, read.processorReads?.[0].at);
    assert.equal((await handoffMessages(approved.id)).length, 3);
    console.log(adapter + ': role isolation, processor selection, early final approval, optional department step, recipients, read receipts, reassignment, evidence, and restart passed' + (build ? ' with connected browser captures and PDF comparison.' : '.'));
  } finally {
    await browser?.close();
    if (server) await stop();
    if (previousEmailUrl === undefined) delete process.env.PRECISIGN_EMAIL_APP_URL;
    else process.env.PRECISIGN_EMAIL_APP_URL = previousEmailUrl;
  }
}

async function temporaryDatabase(run: (path: string) => Promise<void>) {
  const folder = mkdtempSync(join(tmpdir(), 'precisign-processor-test-'));
  try { await run(folder); }
  finally {
    if (dirname(folder) === tmpdir() && basename(folder).startsWith('precisign-processor-test-')) {
      await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

if (process.argv[2] === '--libsql-child') {
  const folder = resolve(process.argv[3] ?? '');
  assert.equal(dirname(folder), tmpdir());
  assert(basename(folder).startsWith('precisign-processor-test-'));
  await exercise('libsql', folder);
} else {
  const build = process.argv[2] ? resolve(process.argv[2]) : undefined;
  await temporaryDatabase(folder => exercise('sqlite', folder, build));
  // On Windows the native libSQL client can hold its file open until the process exits.
  await temporaryDatabase(async folder => {
    const run = spawnSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--libsql-child', folder], { stdio: 'inherit' });
    if (run.error) throw run.error;
    assert.equal(run.status, 0);
  });
}
