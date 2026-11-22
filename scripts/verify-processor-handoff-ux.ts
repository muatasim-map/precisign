// Connected UX walkthrough for access rights, the dashboard and the processor handoff.
// Usage: node --import tsx scripts/verify-processor-handoff-ux.ts <api-build-dir> <label> [--serve]
// Uses a fresh temporary SQLite database, synthetic accounts and mock email only.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Server } from 'node:http';
import express from 'express';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { createApp } from '../backend/src/app';
import { hashPassword } from '../backend/src/auth';
import { openDatabase } from '../backend/src/db';
import { MockEmailTransport, type OutboxProcessor } from '../backend/src/email';
import { INITIAL_REQUESTS, INITIAL_WORKFLOWS } from '../shared/data/seedData';
import { SUBMITTABLE_FORMS, type VersionedRequest } from '../shared/types/apiTypes';
import type { RouteAccessRights, WorkflowConfig } from '../shared/types';

const [buildArg, label = 'run'] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const serve = process.argv.includes('--serve');
assert(buildArg, 'Pass the API-mode build directory.');
const build = resolve(buildArg);
const out = resolve('.artifacts/processor-handoff-ux', label);
const form = 'Administrative & Payment Request';
const password = 'Synthetic-only-2026!';
const signature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQMgkTMgljgFAAEA4CcUNrdOsAAAAASUVORK5CYII=';
const noSigner = Object.fromEntries(SUBMITTABLE_FORMS.map(name => [name, [] as string[]]));
// id, name, department, staff role, companies, Super Admin, PEW rights
const people: [string, string, string, string, string[], boolean, RouteAccessRights][] = [
  ['anzar', 'Anzar Test', 'Operations', 'Admin', ['PEW'], false, { signerSteps: noSigner }],
  ['shekhar', 'Shekhar Test', 'Operations', 'General Manager', ['PEW'], false, { signerSteps: { ...noSigner, [form]: ['department'] } }],
  ['afzal', 'Afzal Kazi Test', 'Management', 'Director', ['PEW', 'ICCL'], true, { signerSteps: { ...noSigner, [form]: ['final'] } }],
  ['bala', 'Bala Test', 'Accounts', 'Finance', ['PEW'], false, { signerSteps: noSigner, processorTasks: { [form]: ['finance'] } }],
  ['ravi', 'Ravi Test', 'Accounts', 'Finance', ['PEW'], false, { signerSteps: noSigner, processorTasks: { [form]: ['finance'] } }],
  ['dina', 'Dina Test', 'Accounts', 'Finance', ['PEW', 'ICCL'], false,
    { companyAdmin: true, signerSteps: { ...noSigner, [form]: ['department'] }, processorTasks: { [form]: ['finance'] } }],
];
const email = (id: string) => id + '@example.test';
const stages = (company: string, final: string) => INITIAL_WORKFLOWS[0].stages.map((step, index) => ({
  ...step, id: index === 0 ? 'department' : 'final', assignedUserId: index === 0 ? (company === 'PEW' ? 'shekhar' : 'dina') : final,
  name: index === 0 ? 'Department Head' : 'Final approver', documentSlot: index === 0 ? 'department-head' as const : undefined,
  isFinalApproval: index === 1, mapsToDocumentSignature: index === 1,
}));
const workflow = (companyId: 'PEW' | 'ICCL'): WorkflowConfig => ({
  ...INITIAL_WORKFLOWS[0], id: 'synthetic-ux-' + companyId, companyId, formType: form, version: 0,
  signerSelection: 'company-directory',
  stages: companyId === 'PEW' ? stages(companyId, 'afzal') : stages(companyId, 'afzal').slice(1).map(step => ({ ...step, stageNumber: 1 })),
});
const submission = (companyId: string, description: string) => ({
  companyId, formType: form, expectedWorkflowVersion: 1, signatureDataUrl: signature,
  formData: {
    dateOfRequest: '2026-11-21', department: 'Operations', priority: 'Medium', workDescription: description,
    documents: INITIAL_REQUESTS[0].formData.documents,
    administrativePayment: { documentDescription: 'QA stationery order', payment: { amount: '120', transferMode: 'Cash', purpose: 'Advance Cash' } },
  },
  attachments: [{ name: 'synthetic-invoice.png', dataUrl: signature }],
});

const folder = mkdtempSync(join(tmpdir(), 'precisign-ux-test-'));
const filename = join(folder, 'synthetic.sqlite');
let db = openDatabase(filename);
const mockEmail = new MockEmailTransport();
let server: Server | undefined;
let worker: OutboxProcessor | undefined;
let browser: Browser | undefined;
let port = 0;
let origin = '';
const sessions = new Map<string, string>();
const shots: string[] = [];

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
  site.use(express.static(build));
  site.get(/^\//, (_req, res) => res.sendFile(join(build, 'index.html')));
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
    method, headers: { Origin: origin, Cookie: sessions.get(id) ?? '', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function ok(response: Response, status = 200) {
  if (response.status !== status) assert.equal(response.status, status, await response.text());
  return response;
}
const record = async (response: Response, status = 200) => await (await ok(response, status)).json() as VersionedRequest;
const approve = (request: VersionedRequest, actor: string) => call(actor, '/requests/' + request.id + '/approve', { expectedRevision: request.revision, signatureDataUrl: signature });

async function context(width: number) {
  const mobile = width < 500;
  const value = await browser!.newContext({ viewport: { width, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
  await value.addInitScript('globalThis.__name = globalThis.__name || (f => f)');
  // A first-run product tour (if present in this build) would cover the screens being captured; mark it seen for the synthetic accounts.
  await value.addInitScript(`try { for (const id of ${JSON.stringify(people.map(([id]) => id))}) for (const mode of ['api', 'demo', 'showcase']) localStorage.setItem('precisign.tour.v1.' + mode + '.' + id, 'done'); } catch {}`);
  return value;
}
async function signIn(value: BrowserContext, id: string) {
  const page = await value.newPage();
  await page.goto(origin);
  await page.locator('input[type=email]').fill(email(id));
  await page.locator('input[type=password]').fill(password);
  await page.locator('button[type=submit]').click();
  await page.locator('.preci-shell').waitFor();
  return page;
}
async function shot(page: Page, name: string, full = false) {
  mkdirSync(out, { recursive: true });
  await page.waitForTimeout(250);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) console.warn('  ! page-level horizontal overflow on ' + name + ': ' + overflow + 'px');
  await page.screenshot({ path: join(out, name + '.png'), animations: 'disabled', fullPage: full });
  shots.push(name);
}
async function chooseScope(page: Page, scope: 'PEG' | 'PEW' | 'ICCL') {
  await page.locator('button[title="Active Viewing Scope / Organization"]').click();
  await page.getByRole('button', { name: scope === 'PEG' ? /Precision Engineering Group/ : new RegExp('^' + scope) }).first().click();
  await page.waitForTimeout(300);
}
const layouts = [['desktop', 1366], ['mobile', 390]] as const;

try {
  const hash = await hashPassword(password);
  for (const [id, name, department, role, companies, superAdmin, rights] of people) {
    const routeRights = { PEW: rights, ...(companies.includes('ICCL') ? { ICCL: { signerSteps: id === 'dina' ? { ...noSigner, [form]: ['department'] } : { ...noSigner, [form]: ['final'] } } } : {}) };
    db.prepare('INSERT INTO users (id,email,name,role,department,company_id,password_hash,route_rights) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, email(id), name, role, department, 'PEW', hash, JSON.stringify(routeRights));
    db.prepare('INSERT INTO user_signatures VALUES (?,?,?)').run(id, signature, name);
    db.prepare('INSERT INTO account_access (user_id,company_grants,form_grants,is_super_admin) VALUES (?,?,?,?)').run(
      id, JSON.stringify(companies), JSON.stringify(Object.fromEntries(companies.map(company => [company, [form, 'Admin Work Request']]))), superAdmin ? 1 : 0);
  }
  await start();
  for (const [id] of people) {
    const response = await ok(await call(id, '/auth/login', { email: email(id), password }));
    sessions.set(id, response.headers.get('set-cookie')!.split(';')[0]);
  }
  // Route admin (Dina, Company Admin for PEW) saves the PEW route with suggested processors; ICCL is saved by the Super Admin without processors.
  await ok(await call('dina', '/workflows/PEW/' + encodeURIComponent(form), { expectedVersion: 0, workflow: { ...workflow('PEW'), processorTasks: [{ id: 'finance', suggestedUserIds: ['bala', 'dina'] }] } }, 'PUT'));
  await ok(await call('afzal', '/workflows/ICCL/' + encodeURIComponent(form), { expectedVersion: 0, workflow: workflow('ICCL') }, 'PUT'));

  const initial = await record(await call('anzar', '/requests', { ...submission('PEW', 'Synthetic payroll stationery payment'),
    signerChoices: { department: 'shekhar', final: 'afzal' }, processorChoices: { finance: ['bala', 'dina'] } }), 201);
  const early = await record(await approve(initial, 'afzal'));
  assert.equal(early.status, 'Pending Approval');
  assert.equal((await (await call('bala', '/requests')).json() as VersionedRequest[]).some(item => item.id === initial.id), false, 'Handoff must wait for signing to complete.');
  const icclRequest = await record(await call('dina', '/requests', { ...submission('ICCL', 'Synthetic ICCL courier payment'), signerChoices: { final: 'afzal' } }), 201);
  const pending = await record(await call('dina', '/requests', { ...submission('PEW', 'Synthetic toner purchase'),
    signerChoices: { department: 'shekhar', final: 'afzal' }, processorChoices: { finance: ['bala'] } }), 201);
  void pending; void icclRequest;

  if (serve) {
    console.log('Serving ' + origin + ' (password ' + password + '). Accounts: ' + people.map(([id]) => email(id)).join(', '));
    await new Promise(() => undefined);
  }

  const executablePath = process.env.PRECISIGN_PDF_CHROMIUM;
  browser = await chromium.launch({ executablePath, channel: !executablePath && !existsSync(chromium.executablePath()) && process.platform === 'win32' ? 'msedge' : undefined });
  const path = '/requests/' + initial.id;

  for (const [layout, width] of layouts) {
    // 1. Super Admin grants access (Dina has overlapping responsibilities).
    const admin = await context(width);
    const directory = await signIn(admin, 'afzal');
    await directory.goto(origin + '/settings/users');
    const card = directory.locator('.preci-directory-row').filter({ has: directory.getByRole('heading', { name: 'Dina Test' }) });
    await card.getByRole('button', { name: 'Manage access' }).click();
    const dialog = directory.getByRole('dialog');
    await dialog.getByRole('heading', { name: 'Access Rights' }).waitFor();
    await shot(directory, 'access-rights-' + layout);
    const signerDetails = dialog.locator('details').filter({ hasText: /signer/i }).first();
    await signerDetails.locator('summary').click();
    await signerDetails.scrollIntoViewIfNeeded();
    await shot(directory, 'access-rights-expanded-' + layout);
    const bulk = dialog.getByRole('button', { name: /Remove from all signer pickers/ }).first();
    if (await bulk.count()) {
      await bulk.click();
      await dialog.getByRole('alert').first().scrollIntoViewIfNeeded();
      await shot(directory, 'access-rights-bulk-confirm-' + layout);
      await dialog.getByRole('button', { name: 'Keep' }).click();
    }
    // Long matrix: scroll the dialog body to check the company headers and form names stay visible.
    await dialog.locator('.overflow-y-auto').first().evaluate(element => { element.scrollTop = 900; });
    await shot(directory, 'access-rights-scrolled-' + layout);
    // Unsaved edits: closing asks before discarding.
    await dialog.getByLabel('Job title').fill('Accounts Lead');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const discard = dialog.getByRole('button', { name: 'Discard' });
    if (await discard.count()) {
      await shot(directory, 'access-rights-discard-' + layout);
      await dialog.getByRole('button', { name: 'Keep editing' }).click();
    }
    // 2. Route settings: After approval.
    await directory.keyboard.press('Escape');
    await admin.close();

    const routeAdmin = await context(width);
    const settings = await signIn(routeAdmin, 'dina');
    await chooseScope(settings, 'PEW');
    await settings.goto(origin + '/settings/signing-routes');
    await settings.waitForTimeout(800);
    const configure = settings.getByRole('button', { name: /Edit route|Edit/ }).first();
    if (await configure.count()) await configure.click().catch(() => undefined);
    await settings.waitForTimeout(500);
    const accordion = settings.locator('details.route-accordion').filter({ hasText: /^\s*After approval/ });
    const target = (await accordion.count()) ? accordion.first() : settings.locator('details.route-accordion').filter({ hasText: 'Processing team and read access' }).first();
    await target.locator('summary').click();
    await settings.getByRole('region', { name: /After approval/ }).first().scrollIntoViewIfNeeded();
    await shot(settings, 'route-after-approval-' + layout);
    // 3. Employee submits: the processors section on the payment request.
    await settings.goto(origin + '/forms/administrative-payment/new');
    const choices = settings.getByRole('region', { name: 'Processors after approval' });
    await choices.waitFor();
    await choices.scrollIntoViewIfNeeded();
    await shot(settings, 'submit-processors-' + layout);
    // Company scope: the ICCL route has no processor setup.
    await settings.goto(origin + '/forms/administrative-payment/new?company=ICCL');
    await settings.waitForTimeout(800);
    const setupGap = settings.getByText(/hasn’t been set up|not set up|No processors/i).first();
    if (await setupGap.count()) await setupGap.scrollIntoViewIfNeeded();
    await shot(settings, 'submit-processors-iccl-' + layout);
    // 6. Combined access: dashboard in one company and in Group View.
    await settings.goto(origin + '/dashboard');
    await chooseScope(settings, 'PEW');
    await settings.goto(origin + '/dashboard');
    await settings.waitForTimeout(500);
    await shot(settings, 'dashboard-combined-pew-' + layout, true);
    await chooseScope(settings, 'PEG');
    await shot(settings, 'dashboard-combined-group-' + layout, true);
    await settings.reload();
    await settings.locator('.preci-shell').waitFor();
    const keptGroup = await settings.locator('button[title="Active Viewing Scope / Organization"]').innerText();
    console.log('  ' + layout + ': scope after refresh = ' + keptGroup.replace(/\s+/g, ' ').trim());
    await routeAdmin.close();

    // 4. Early final signature: the stepper while the department step is open.
    const requesterContext = await context(width);
    const requester = await signIn(requesterContext, 'anzar');
    await shot(requester, 'dashboard-requester-' + layout, true);
    await requester.goto(origin + path);
    await requester.getByRole('region', { name: 'Signing progress' }).waitFor();
    await shot(requester, 'stepper-early-final-' + layout);
    await requesterContext.close();
  }

  const approved = await record(await approve(early, 'shekhar'));
  assert.equal(approved.status, 'Approved');
  assert.equal(approved.processorReads, undefined);

  for (const [layout, width] of layouts) {
    const requesterContext = await context(width);
    const requester = await signIn(requesterContext, 'anzar');
    await requester.goto(origin + path);
    await requester.getByRole('region', { name: 'Signing progress' }).waitFor();
    await shot(requester, 'stepper-awaiting-' + layout);
    await requesterContext.close();
    const processorContext = await context(width);
    const processor = await signIn(processorContext, 'bala');
    await shot(processor, 'processor-queue-' + layout, true);
    await processorContext.close();
  }

  // 5. Processor opens the approved request and downloads a supporting file.
  const desktop = await context(1366);
  const processor = await signIn(desktop, 'bala');
  await processor.getByRole('button', { name: /^(View|Open) approved request$/ }).first().click();
  await processor.getByRole('region', { name: 'Signing progress' }).waitFor();
  await processor.waitForTimeout(800);
  const attachment = await ok(await call('bala', path + '/attachments/1/' + approved.attachments[0].id));
  assert.equal((await attachment.arrayBuffer()).byteLength > 0, true);
  await desktop.close();
  const read = await record(await call('anzar', path));
  assert.equal(read.processorReads?.length, 1);
  assert.equal(read.processorReads?.[0].userId, 'bala');
  assert.equal(read.revision, approved.revision, 'A receipt must not change the approval revision.');
  const firstAt = read.processorReads?.[0].at;

  for (const [layout, width] of layouts) {
    const value = await context(width);
    const page = await signIn(value, 'afzal');
    await page.goto(origin + path);
    const progress = page.getByRole('region', { name: 'Signing progress' });
    await progress.waitFor();
    await progress.scrollIntoViewIfNeeded();
    await shot(page, 'stepper-read-' + layout);
    const details = progress.locator('details summary').first();
    if (await details.count()) { await details.click(); await progress.scrollIntoViewIfNeeded(); }
    await shot(page, 'stepper-read-details-' + layout);
    await value.close();
  }

  // App-wide craft screens: page heroes, glyphs, empty/not-found art, palette, toasts, sheet, previews.
  for (const [layout, width] of layouts) {
    const value = await context(width);
    const page = await signIn(value, 'afzal');
    for (const [path, name] of [['/forms', 'forms-library'], ['/archive', 'archive'], ['/settings/profile', 'profile'], ['/settings/branding', 'branding'], ['/settings/signing-routes', 'signing-routes'], ['/settings/users', 'user-directory'], ['/this-route-does-not-exist', 'not-found']] as const) {
      await page.goto(origin + path);
      await page.locator('h1').first().waitFor();
      await page.waitForTimeout(500);
      await shot(page, 'craft-' + name + '-' + layout);
    }
    await page.goto(origin + '/dashboard');
    await page.locator('h1').first().waitFor();
    if (width > 500) {
      // Hover states: a form card (glyph lifts and draws), the sidebar, and a request ID preview.
      await page.locator('.dash-form-card').first().hover();
      await page.waitForTimeout(350);
      await shot(page, 'craft-hover-form-card-desktop');
      const requestId = page.locator('table .request-id').first();
      if (await requestId.count()) {
        await requestId.hover();
        await page.waitForTimeout(700);
        await shot(page, 'craft-hover-preview-desktop');
      }
      if (await page.locator('.command-palette').count()) {
        await page.keyboard.press('Control+k');
        for (let attempt = 0; attempt < 5 && !(await page.locator('.command-palette[open]').count()); attempt++) {
          await page.waitForTimeout(200);
          if (!(await page.locator('.command-palette[open]').count())) await page.evaluate(() => window.dispatchEvent(new Event('precisign:command-palette')));
        }
        const palette = page.locator('.command-palette[open] input');
        if (!(await palette.count())) { await shot(page, 'debug-palette'); console.log('  palette state', await page.evaluate(() => [...document.querySelectorAll('dialog')].map(d => d.className + ':' + d.open))); }
        await palette.fill('payment');
        await page.waitForTimeout(150);
        await shot(page, 'craft-command-palette-desktop');
        await page.keyboard.press('Escape');
      }
      // First-time guide: Afzal hasn't submitted anything, so it shows; "Got it" is remembered after a refresh.
      if (!label.startsWith('before')) {
        const guide = page.getByRole('region', { name: 'How a PreciRoute travels' });
        await guide.waitFor();
        await guide.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await shot(page, 'craft-first-route-guide-desktop');
        await guide.getByRole('button', { name: 'Got it' }).click();
        await page.reload();
        await page.locator('h1').first().waitFor();
        assert.equal(await page.getByRole('region', { name: 'How a PreciRoute travels' }).count(), 0, 'Dismissed guide must stay hidden');
        console.log('  first-route guide: shown, dismissed, stays hidden');
      }
      // Tab badge: Afzal has a request waiting, so the icon carries the dot (a data: URL).
      if (!label.startsWith('before')) {
        await page.waitForTimeout(400);
        const icon = await page.locator('link[rel="icon"]').getAttribute('href');
        assert.match(icon ?? '', /^data:image\/png/, 'Favicon badge expected while something needs action');
        console.log('  favicon badge: on');
      }
    } else {
      // First-time guide on phones: stacks as rows with the art beside the text, without sideways scroll.
      if (!label.startsWith('before')) {
        const guide = page.getByRole('region', { name: 'How a PreciRoute travels' });
        await guide.waitFor();
        await guide.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700);
        await shot(page, 'craft-first-route-guide-mobile');
      }
      // Request page on phones: "Go to actions" lifts the actions column into a sheet.
      await page.goto(origin + path);
      const actions = page.getByRole('button', { name: 'Go to actions' });
      await actions.waitFor();
      await actions.click();
      await page.waitForTimeout(500);
      await shot(page, 'craft-actions-sheet-mobile');
      if (await page.getByRole('button', { name: 'Close actions' }).count()) await page.getByRole('button', { name: 'Close actions' }).click();
      await page.goto(origin + '/dashboard');
      await page.locator('h1').first().waitFor();
      const filters = page.getByRole('button', { name: /^Filters/ });
      if (await filters.count()) {
        await filters.click();
        await page.waitForTimeout(500);
        await shot(page, 'craft-filter-sheet-mobile');
        await page.keyboard.press('Escape');
      }
    }
    await value.close();
  }
  // Toast after saving access, captured mid-display.
  {
    const value = await context(1366);
    const page = await signIn(value, 'afzal');
    await page.goto(origin + '/settings/users');
    const row = page.locator('.preci-directory-row').filter({ has: page.getByRole('heading', { name: 'Ravi Test' }) });
    await row.getByRole('button', { name: 'Manage access' }).click();
    await page.getByRole('dialog').getByLabel('Job title').fill('Accounts Officer');
    await page.getByRole('dialog').getByRole('button', { name: 'Save access' }).click();
    await page.getByText('Access updated for Ravi Test.').waitFor();
    await page.waitForTimeout(450);
    await shot(page, 'craft-toast-desktop');
    await value.close();
  }
  // Reduced motion: the waving hand and route drift are static.
  {
    const value = await browser!.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await value.addInitScript('globalThis.__name = globalThis.__name || (f => f)');
    await value.addInitScript(`try { for (const id of ${JSON.stringify(people.map(([id]) => id))}) for (const mode of ['api', 'demo', 'showcase']) localStorage.setItem('precisign.tour.v1.' + mode + '.' + id, 'done'); } catch {}`);
    const page = await signIn(value, 'afzal');
    await page.goto(origin + '/dashboard');
    await page.locator('.dash-wave').waitFor();
    const animations = await page.evaluate(() => ['.dash-wave', '.dashboard-hero-motif .route-decor-path'].map(selector => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element).animationName : 'missing';
    }));
    assert.deepEqual(animations, ['none', 'none'], 'Reduced motion must keep decorative motion static: ' + animations.join(', '));
    console.log('  reduced motion: decorative animations off');
    await value.close();
  }

  // Restart: grants, processors and receipts persist; a repeat open keeps the first timestamp.
  await stop();
  db = openDatabase(filename);
  await start();
  for (const [id] of people) {
    const response = await ok(await call(id, '/auth/login', { email: email(id), password }));
    sessions.set(id, response.headers.get('set-cookie')!.split(';')[0]);
  }
  await ok(await call('bala', path + '/processor-read', { version: 1 }));
  const reopened = await record(await call('anzar', path));
  assert.equal(reopened.processorReads?.[0].at, firstAt);
  assert.equal(reopened.processorReads?.length, 1);
  console.log(label + ': connected walkthrough passed; ' + shots.length + ' screenshots in ' + out);
} finally {
  await browser?.close();
  if (server) await stop();
  if (dirname(folder) === tmpdir() && basename(folder).startsWith('precisign-ux-test-')) {
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
