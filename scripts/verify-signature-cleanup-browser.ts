import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import express from 'express';
import { openDatabase } from '../backend/src/db';
import { createApp } from '../backend/src/app';
import { MockEmailTransport } from '../backend/src/email';
import { hashPassword, tokenHash } from '../backend/src/auth';
import { INITIAL_WORKFLOWS } from '../shared/data/seedData';
import type { WorkflowConfig, RequestRecord } from '../shared/types';

async function main() {
  const runId = randomUUID().slice(0, 8);
  const tempOutDir = mkdtempSync(join(tmpdir(), `precisign-sigclean-build-${runId}-`));
  const tempDbPath = join(tmpdir(), `precisign-sigclean-${runId}.sqlite`);

  let server: any;
  let browser: any;
  let db: DatabaseSync | undefined;

  try {
    // 1. Build frontend in connected mode (VITE_DATA_MODE=api) into a unique temporary directory
    console.log(`[Step 1] Building frontend in connected mode into ${tempOutDir}...`);
    execFileSync(
      process.execPath,
      ['node_modules/vite/bin/vite.js', 'build', '--outDir', tempOutDir],
      {
        env: { ...process.env, VITE_DATA_MODE: 'api', VITE_SHOWCASE: 'false', PRECISIGN_SHOWCASE: 'false', VITE_SENTRY_DSN: '' },
        stdio: 'pipe',
      }
    );
    console.log('[Step 1] Build finished successfully.');

    // 2. Initialize isolated temporary database
    console.log(`[Step 2] Initializing isolated temporary SQLite database at ${tempDbPath}...`);
    db = openDatabase(tempDbPath);

    const password = 'Synthetic-sigclean-1234!';
    const passwordHash = await hashPassword(password);

    const reqId = `usr-req-${runId}`;
    const gmId = `usr-gm-${runId}`;
    const dirId = `usr-dir-${runId}`;

    const reqEmail = `req-${runId}@example.test`;
    const gmEmail = `gm-${runId}@example.test`;
    const dirEmail = `dir-${runId}@example.test`;

    const insertUser = (id: string, email: string, name: string, role: string) => {
      db!.prepare('INSERT INTO users (id, email, name, role, department, company_id, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, email, name, role, 'Operations', 'PEW', passwordHash);
      db!.prepare('INSERT INTO account_access (user_id, company_grants, form_grants, is_super_admin, is_disabled, must_change_password) VALUES (?, ?, ?, ?, 0, 0)')
        .run(
          id,
          JSON.stringify(['PEW', 'ICCL']),
          JSON.stringify({ PEW: ['Admin Work Request'] }),
          role === 'Director' ? 1 : 0
        );
    };

    insertUser(reqId, reqEmail, 'Requester Synthetic', 'Admin');
    insertUser(gmId, gmEmail, 'GM Signer One', 'General Manager');
    insertUser(dirId, dirEmail, 'Director Signer Two', 'Director');

    // 3. Configure workflow with Stage 1 (GM) and Stage 2 (Director - final)
    const wf: WorkflowConfig = {
      ...INITIAL_WORKFLOWS[0],
      id: `wf-pew-${runId}`,
      companyId: 'PEW',
      formType: 'Admin Work Request',
      version: 1,
      stages: [
        {
          id: `stage-gm-${runId}`,
          stageNumber: 1,
          name: 'General Manager Review',
          assignedUserId: gmId,
          assignedRole: 'General Manager',
          isFinalApproval: false,
          canReject: true,
          canReturnForCorrection: true,
          mapsToDocumentSignature: false,
        },
        {
          id: `stage-dir-${runId}`,
          stageNumber: 2,
          name: 'Final Approval',
          assignedUserId: dirId,
          assignedRole: 'Director',
          isFinalApproval: true,
          canReject: true,
          canReturnForCorrection: true,
          mapsToDocumentSignature: true,
        },
      ],
    };

    db.prepare('INSERT INTO workflows (company_id, form_type, version, config) VALUES (?, ?, ?, ?)')
      .run('PEW', 'Admin Work Request', 1, JSON.stringify(wf));

    // 4. Start Express server with connected API and static build
    const site = express();
    server = site.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const origin = `http://127.0.0.1:${port}`;

    const apiApp = await createApp(db, { origin, secureCookies: false, emailTransport: new MockEmailTransport() });
    site.use('/api', (req, res, next) => { req.url = '/api' + req.url; apiApp(req, res, next); });
    site.use(express.static(tempOutDir));
    site.get('*', (_req, res) => res.sendFile(join(tempOutDir, 'index.html')));

    console.log(`[Step 3] App server listening at ${origin}`);

    // 5. Submit a synthetic request via API as Requester
    const reqToken = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(tokenHash(reqToken), reqId, Date.now() + 3600000);

    const submitRes = await fetch(`${origin}/api/requests`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: `precisign_session=${reqToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedWorkflowVersion: 1,
        companyId: 'PEW',
        formType: 'Admin Work Request',
        formData: {
          dateOfRequest: '2026-11-19',
          department: 'Operations',
          priority: 'Urgent',
          workDescription: 'Multi-session conflict test request',
          documents: {
            onlineDocumentChamber: false,
            physicalDocumentChamber: false,
            companyDocumentAjeer: false,
            employeeSalaryCertificate: false,
            permanentEmploymentVisa: false,
            workVisitVisa: false,
            businessVisitVisa: false,
            agencyWakala: false,
            others: true,
            othersDescription: 'Conflict verification document',
          },
        },
        signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQMgkTMgljgFAAEA4CcUNrdOsAAAAASUVORK5CYII=',
      }),
    });

    if (submitRes.status !== 201) {
      const errText = await submitRes.text();
      throw new Error(`Request submission failed with status ${submitRes.status}: ${errText}`);
    }
    const createdRequest = (await submitRes.json()) as RequestRecord & { revision: number };
    assert.equal(createdRequest.revision, 1, 'Initial request must be at revision 1');
    console.log(`[Step 4] Synthetic request created: ${createdRequest.id} at revision 1`);

    // 6. Browser checks of the new cleanup against the isolated app
    const OUT = join(process.cwd(), '.artifacts', 'signature-qa', 'cleanup');
    const SHOTS = join(OUT, 'browser');
    mkdirSync(SHOTS, { recursive: true });
    const findings: Record<string, unknown> = {};
    const executablePath = process.env.PRECISIGN_PDF_CHROMIUM;
    browser = await chromium.launch({
      executablePath,
      channel: !executablePath && !existsSync(chromium.executablePath()) && process.platform === 'win32' ? 'msedge' : undefined,
      headless: true, timeout: 25000,
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error: Error) => pageErrors.push(error.message));
    await page.goto(`${origin}/`);
    await page.waitForSelector('input[type="email"]');
    await page.fill('input[type="email"]', gmEmail);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.locator('.preci-shell').waitFor({ timeout: 15000 });

    // A near-limit upload: a noisy JPEG tuned to just under the 2 MiB cap.
    const big = join(OUT, 'fixtures', 'near-limit-2mib.jpg');
    const base = join(OUT, 'fixtures', 'large-720.png');
    for (const quality of [96, 92, 88, 84, 80, 76, 72, 66, 60]) {
      const noise = await sharp(randomBytes(3200 * 2400 * 3), { raw: { width: 3200, height: 2400, channels: 3 } }).png().toBuffer();
      await sharp(base).resize(3200, 2400, { fit: 'fill' }).composite([{ input: noise, blend: 'soft-light' }]).jpeg({ quality }).toFile(big);
      if (statSync(big).size < 2 * 1024 * 1024 - 20 * 1024) break;
    }
    findings.nearLimitBytes = statSync(big).size;
    assert.ok(statSync(big).size < 2 * 1024 * 1024, 'fixture must be within the upload cap');

    const openUpload = async () => {
      await page.goto(`${origin}/settings/profile`);
      await page.waitForSelector('text=Signature settings');
      await page.getByRole('button', { name: 'Upload signature' }).click();
    };
    const previewFixture = async (name: string, file: string, expectCleaned = true) => {
      await openUpload();
      await page.locator('#profile-sig-file').setInputFiles(file);
      await page.waitForSelector('text=Move the corners around your signature.');
      const started = Date.now();
      await page.getByRole('button', { name: 'Preview crop' }).click();
      await page.waitForSelector(expectCleaned ? 'text=Cleaned signature' : 'text=No ink detected');
      const previewMs = Date.now() - started;
      await page.screenshot({ path: join(SHOTS, `${name}-preview.png`) });
      return previewMs;
    };

    // (a) Photo cases: preview must show a cleaned result with the Original option still selectable.
    const previews: Record<string, unknown> = {};
    for (const name of ['faint-crossing', 'slanted-rules', 'shadow-hard', 'grid-paper', 'underline-ruled']) {
      const previewMs = await previewFixture(name, join(OUT, 'fixtures', `${name}.jpg`));
      const cleanedRadio = page.getByRole('radio', { name: /Cleaned signature/ });
      const original = page.getByRole('radio', { name: /Original crop/ });
      assert.equal(await cleanedRadio.isDisabled(), false, `${name}: cleaned result expected`);
      assert.equal(await cleanedRadio.isChecked(), true, `${name}: cleaned selected by default`);
      assert.equal(await original.isDisabled(), false, `${name}: original selectable`);
      await original.check();
      await cleanedRadio.check();
      assert.ok(await page.getByText('If part of your signature is missing, choose').isVisible(), 'fallback tip');
      assert.equal(await page.locator('input[type="range"]').count(), 1, 'single slider');
      previews[name] = { previewMs };
    }
    findings.previews = previews;

    // (b) Blank paper: no cleaned result, Original is chosen, cleaned radio disabled.
    await previewFixture('blank-paper', join(OUT, 'fixtures', 'blank-paper.jpg'), false);
    assert.ok(await page.getByText('No ink detected').isVisible());
    assert.equal(await page.getByRole('radio', { name: /Cleaned signature/ }).isDisabled(), true);
    assert.equal(await page.getByRole('radio', { name: /Original crop/ }).isChecked(), true);

    // (c) Near-limit image + slider responsiveness (time from input event to a repainted frame).
    findings.nearLimitPreviewMs = await previewFixture('near-limit', big);
    const readPreview = () => page.getByRole('img', { name: 'Selected signature' }).getAttribute('src');
    const latencies: number[] = [];
    for (const value of ['0.6', '1', '2.5', '4', '1.6']) {
      const before = await readPreview();
      const ms = await page.evaluate(async ({ value }: { value: string }) => {
        const input = document.querySelector('input[type="range"]') as HTMLInputElement;
        const t = performance.now();
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return performance.now() - t;
      }, { value });
      assert.notEqual(before, await readPreview(), `slider ${value} should change the preview`);
      latencies.push(Math.round(ms));
    }
    findings.sliderLatenciesMs = latencies;
    assert.ok(Math.max(...latencies) < 250, `slider latency ${latencies}`);
    await page.screenshot({ path: join(SHOTS, 'near-limit-slider.png') });

    // (d) Save a cleaned photo signature, sign the request, and capture the form + PDF.
    await previewFixture('faint-crossing-save', join(OUT, 'fixtures', 'faint-crossing.jpg'));
    const selectedSrc = await readPreview();
    await page.getByRole('button', { name: 'Save signature', exact: true }).click();
    await page.waitForSelector('text=Signature saved.');
    const stored = await page.locator('img[alt="Saved signature"]').getAttribute('src');
    assert.equal(stored, selectedSrc, 'saved bytes equal the previewed cleaned PNG');
    assert.match(stored!, /^data:image\/png;base64,/);
    const png = Buffer.from(stored!.split(',')[1], 'base64');
    const meta = await sharp(png).metadata();
    assert.equal(meta.hasAlpha, true, 'transparent PNG');
    writeFileSync(join(SHOTS, 'saved-cleaned-signature.png'), png);
    findings.savedSignature = { chars: stored!.length, width: meta.width, height: meta.height, hasAlpha: meta.hasAlpha };

    await page.goto(`${origin}/requests/${encodeURIComponent(createdRequest.id)}`);
    await page.waitForSelector('text=Multi-session conflict test request');
    await page.getByRole('button', { name: 'Approve & sign', exact: true }).click();
    await page.waitForSelector('#signature-dialog-title');
    await page.screenshot({ path: join(SHOTS, 'sign-dialog-saved-signature.png') });
    await page.getByRole('button', { name: /Confirm & Apply Signature|Confirm & sign/ }).click();
    await page.waitForTimeout(1500);
    const row = db.prepare('SELECT record FROM requests WHERE id=?').get(createdRequest.id) as { record: string };
    const recorded = row.record.includes(stored!.split(',')[1]);
    findings.signedRequestStoresExactSavedBytes = recorded;
    assert.ok(recorded, 'request record holds the exact saved signature bytes');
    await page.screenshot({ path: join(SHOTS, 'signed-request-document.png'), fullPage: true });

    // The final signer's signature is the one printed in the form's Approval Authority box.
    const dirContext = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true, deviceScaleFactor: 2 });
    const dirPage = await dirContext.newPage();
    dirPage.on('pageerror', (error: Error) => pageErrors.push(error.message));
    await dirPage.goto(`${origin}/`);
    await dirPage.waitForSelector('input[type="email"]');
    await dirPage.fill('input[type="email"]', dirEmail);
    await dirPage.fill('input[type="password"]', password);
    await dirPage.click('button[type="submit"]');
    await dirPage.locator('.preci-shell').waitFor({ timeout: 15000 });
    await dirPage.goto(`${origin}/settings/profile`);
    await dirPage.waitForSelector('text=Signature settings');
    await dirPage.getByRole('button', { name: 'Upload signature' }).click();
    await dirPage.locator('#profile-sig-file').setInputFiles(join(OUT, 'fixtures', 'underline-ruled.jpg'));
    await dirPage.getByRole('button', { name: 'Preview crop' }).click();
    await dirPage.waitForSelector('text=Cleaned signature');
    await dirPage.getByRole('button', { name: 'Save signature', exact: true }).click();
    await dirPage.waitForSelector('text=Signature saved.');
    await dirPage.goto(`${origin}/requests/${encodeURIComponent(createdRequest.id)}`);
    await dirPage.waitForSelector('text=Multi-session conflict test request');
    await dirPage.getByRole('button', { name: 'Approve & sign', exact: true }).click();
    await dirPage.waitForSelector('#signature-dialog-title');
    await dirPage.getByRole('button', { name: /Confirm & Apply Signature|Confirm & sign/ }).click();
    await dirPage.getByText('Approved', { exact: true }).first().waitFor({ timeout: 15000 });
    const approval = dirPage.locator('img[alt*="signature" i]').last();
    await approval.waitFor();
    await approval.scrollIntoViewIfNeeded();
    const box = await approval.evaluate((el: Element) => { const r = (el.parentElement ?? el).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    await dirPage.screenshot({ path: join(SHOTS, 'form-approval-authority-signature.png'), clip: { x: Math.max(0, box.x - 200), y: Math.max(0, box.y - 90), width: 700, height: 240 } });
    await dirPage.screenshot({ path: join(SHOTS, 'form-approved-fullpage.png'), fullPage: true });
    const pdfButton = dirPage.getByRole('button', { name: /Download PDF/ });
    if (await pdfButton.count()) {
      const [download] = await Promise.all([dirPage.waitForEvent('download', { timeout: 60000 }), pdfButton.click()]);
      const pdfPath = join(SHOTS, 'signed-request.pdf');
      await download.saveAs(pdfPath);
      const pdf = readFileSync(pdfPath);
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      findings.pdf = { bytes: pdf.length, hasSoftMask: pdf.includes('/SMask') };
    } else findings.pdf = 'Download PDF button not shown for this request state';
    findings.pageErrors = pageErrors;
    assert.deepEqual(pageErrors, []);
    writeFileSync(join(OUT, 'browser-findings.json'), JSON.stringify(findings, null, 2));
    console.log('BROWSER FINDINGS', JSON.stringify(findings));
  } finally {
    try { await browser?.close(); } catch {}
    try { if (server) await new Promise(resolve => server.close(resolve)); } catch {}
    try { db?.close(); } catch {}
    try { rmSync(tempDbPath, { force: true }); } catch {}
    try { rmSync(tempOutDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch(error => { console.error(error); process.exit(1); });
