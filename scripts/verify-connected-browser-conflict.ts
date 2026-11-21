import { chromium } from 'playwright-core';
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
  const tempOutDir = mkdtempSync(join(tmpdir(), `precisign-conflict-build-${runId}-`));
  const tempDbPath = join(tmpdir(), `precisign-conflict-${runId}.sqlite`);

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

    const password = 'Synthetic-conflict-1234!';
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

    if (process.argv.includes('--serve')) {
      console.log('Open the request at ' + origin + '/requests/' + createdRequest.id);
      console.log('Temporary test sign-ins: ' + [reqEmail, gmEmail, dirEmail].join(', '));
      console.log('Synthetic password for this local run: ' + password);
      console.log('Press Ctrl+C to close the server and remove the temporary database and build.');
      await new Promise<void>(resolve => {
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
      });
      return;
    }

    // 6. Launch browser and create 2 distinct sessions
    const executablePath = process.env.PRECISIGN_PDF_CHROMIUM;
    browser = await chromium.launch({
      executablePath,
      channel: !executablePath && !existsSync(chromium.executablePath()) && process.platform === 'win32' ? 'msedge' : undefined,
      headless: true,
      timeout: 25000,
    });

    const context1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const context2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });

    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    page1.setDefaultTimeout(15000);
    page2.setDefaultTimeout(15000);

    page1.on('console', (msg: any) => console.log('[P1 Console]:', msg.text()));
    page2.on('console', (msg: any) => console.log('[P2 Console]:', msg.text()));
    page1.on('pageerror', (err: any) => console.error('[P1 PageError]:', err));
    page2.on('pageerror', (err: any) => console.error('[P2 PageError]:', err));

    const loginHelper = async (page: any, email: string) => {
      await page.goto(`${origin}/`);
      await page.waitForSelector('input[type="email"]');
      await page.fill('input[type="email"]', email);
      await page.fill('input[type="password"]', password);
      await page.click('button[type="submit"]');
      await page.locator('.preci-shell').waitFor({ timeout: 15000 });
    };

    console.log('[Step 5] Signing in Session 1 (GM Signer) and Session 2 (Director Signer)...');
    await loginHelper(page1, gmEmail);
    await loginHelper(page2, dirEmail);
    console.log('[Step 5] Both sessions signed in.');

    const fixture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQMgkTMgljgFAAEA4CcUNrdOsAAAAASUVORK5CYII=', 'base64');
    const saveThroughProfile = async (page: typeof page1) => {
      await page.locator('#profile-sig-file').setInputFiles({ name: 'synthetic-signature.png', mimeType: 'image/png', buffer: fixture });
      await page.getByRole('button', { name: 'Preview crop' }).click();
      await page.getByLabel('Original crop', { exact: true }).check();
      await page.getByRole('button', { name: 'Save signature', exact: true }).click();
    };
    await page1.goto(origin + '/requests/' + createdRequest.id);
    const missingRemark = page1.getByRole('textbox', { name: 'Signer remarks (optional)' });
    await missingRemark.fill('Remark survives setup');
    await page1.getByRole('button', { name: 'Approve & sign', exact: true }).click();
    await page1.getByRole('button', { name: 'Set up signature', exact: true }).click();
    const setupUpdate = { ...createdRequest, updatedAt: new Date(Date.parse(createdRequest.updatedAt) + 1000).toISOString(), revision: 2 };
    db.prepare('UPDATE requests SET record=?, revision=? WHERE id=?').run(JSON.stringify(setupUpdate), 2, createdRequest.id);
    await saveThroughProfile(page1);
    await page1.waitForURL('**/requests/' + createdRequest.id);
    await missingRemark.waitFor();
    assert.equal(await missingRemark.inputValue(), 'Remark survives setup');
    await page1.getByText('The request changed while you were setting up your signature.', { exact: false }).waitFor();
    assert.equal(await page1.getByRole('dialog').count(), 0, 'Review must precede a new confirmation');
    assert.equal(Number((db.prepare('SELECT revision FROM requests WHERE id=?').get(createdRequest.id)!).revision), 2);
    await page2.goto(origin + '/settings/profile');
    await saveThroughProfile(page2);
    await page2.getByText('Signature saved.', { exact: true }).waitFor();


    // 7. Session 1: Navigate to request review page at revision 1
    console.log(`[Step 6] Session 1 opening request ${createdRequest.id}...`);
    await page1.goto(`${origin}/requests/${encodeURIComponent(createdRequest.id)}`);
    await page1.waitForSelector('text=Multi-session conflict test request');
    await page1.waitForSelector('text=General Manager Review');

    // GM enters a remark in the textarea
    const remarkText = 'GM initial review remark - verified budget and scope';
    const remarkArea = page1.locator('textarea[placeholder*="Add a remark for the signing history"]');
    await remarkArea.waitFor({ state: 'visible' });
    await remarkArea.fill(remarkText);

    // GM opens the signature modal
    console.log('[Step 7] Session 1 opens signature modal and types signature...');
    const approveBtn = page1.getByRole('button', { name: 'Approve & sign', exact: true });
    await approveBtn.click();

    // Verify signature dialog is open
    await page1.waitForSelector('#signature-dialog-title');
    // Ensure Style tab is selected and signature text is entered
    const modal1 = page1.getByRole('dialog');
    const styledInput = modal1.getByRole('img', { name: /Saved signature for/ });
    await styledInput.waitFor({ state: 'visible' });
    assert.ok(await styledInput.isVisible());
    console.log('[Step 7] Session 1 has signature dialog open with inputs filled.');

    // 8. Session 2: Signs early while Session 1 is still looking at revision 1
    console.log(`[Step 8] Session 2 opening request ${createdRequest.id} to sign early...`);
    await page2.goto(`${origin}/requests/${encodeURIComponent(createdRequest.id)}`);
    await page2.waitForSelector('text=Multi-session conflict test request');

    // Director has early signing option: "Approve & sign · keep open"
    const dirApproveBtn = page2.getByRole('button', { name: /Approve & sign · keep open|Approve & sign/ });
    await dirApproveBtn.waitFor({ state: 'visible' });
    await dirApproveBtn.click();

    await page2.waitForSelector('#signature-dialog-title');
    const modal2 = page2.getByRole('dialog');
    const dirStyleTab = modal2.getByRole('button', { name: 'Style', exact: true });
    if (await dirStyleTab.count() > 0) {
      await dirStyleTab.click();
    }
    const dirStyledInput = modal2.locator('input[placeholder="Your name or initials"]');
    if (await dirStyledInput.count() > 0) {
      await dirStyledInput.fill('Director Signer Two');
    }
    const dirConfirmBtn = modal2.getByRole('button', { name: 'Confirm & sign', exact: true });
    await dirConfirmBtn.click();

    // Wait for Director's approval to succeed
    await page2.waitForSelector('text=You signed. The request stays open for the other signers.', { timeout: 10000 });
    console.log('[Step 8] Session 2 successfully signed early. Request revision bumped in database.');

    // Verify database record revision is now 2
    const dbRow = db.prepare('SELECT revision, status FROM requests WHERE id = ?').get(createdRequest.id) as any;
    assert.equal(Number(dbRow.revision), 3, 'Early approval advances the current revision once');

    // 9. Session 1: Now attempts to confirm approval on the stale revision 1
    console.log('[Step 9] Session 1 submitting stale approval...');
    const gmConfirmBtn = modal1.getByRole('button', { name: 'Confirm & sign', exact: true });
    await gmConfirmBtn.click();

    // 10. Verify Session 1 receives accurate conflict feedback and entries are preserved
    console.log('[Step 10] Verifying conflict feedback in Session 1...');
    const expectedErrorMsg = 'This request changed in another session. The latest version is now loaded. Your entries are preserved. Cancel this dialog to review the latest stage and document before confirming again.';
    await page1.waitForSelector(`text=${expectedErrorMsg}`, { timeout: 10000 });

    // Check modal is still open
    assert.ok(await page1.locator('#signature-dialog-title').isVisible(), 'Signature modal must remain open after conflict');

    // Check entered styled name is preserved
    if (await styledInput.count() > 0) {
      assert.ok(await styledInput.isVisible(), 'Saved signature must remain visible in the dialog');
    }

    console.log('[Step 10] Accurate feedback displayed and modal entries preserved.');

    // 11. Session 1: Close / cancel the dialog to review latest request
    console.log('[Step 11] Session 1 closing dialog to review latest request...');
    const closeDialogBtn = modal1.getByRole('button', { name: 'Close signature dialog' });
    await closeDialogBtn.click();
    await page1.waitForSelector('#signature-dialog-title', { state: 'hidden' });

    // Verify remark in textarea is PRESERVED on the page!
    const preservedRemark = await remarkArea.inputValue();
    assert.equal(preservedRemark, remarkText, 'Signer remark textarea must preserve user entry after dialog close');
    console.log('[Step 11] Signer remark on page is preserved:', preservedRemark);

    // Verify page now shows the latest revision: Stage 2 shows approved by Director
    await page1.waitForSelector('text=Approved', { timeout: 10000 });
    console.log('[Step 11] Latest request stage state loaded on page: Stage 2 shows approved.');

    // 12. Session 1: Review and act again on the latest revision (revision 2)
    console.log('[Step 12] Session 1 acting again on the refreshed revision...');
    const gmApproveAgainBtn = page1.getByRole('button', { name: 'Approve & sign', exact: true });
    await gmApproveAgainBtn.click();

    await page1.waitForSelector('#signature-dialog-title');
    const modal1Again = page1.getByRole('dialog');
    const gmConfirmAgainBtn = modal1Again.getByRole('button', { name: 'Confirm & sign', exact: true });
    await gmConfirmAgainBtn.click();

    // Wait for success confirmation
    await page1.waitForSelector('text=Signature saved.', { timeout: 10000 });
    console.log('[Step 12] Second action succeeded on latest revision.');

    // 13. Verify DB record is now revision 3 and overall status is Approved
    const finalDbRow = db.prepare('SELECT revision, status FROM requests WHERE id = ?').get(createdRequest.id) as any;
    assert.equal(Number(finalDbRow.revision), 4, 'Final approval advances the current revision once');
    assert.equal(finalDbRow.status, 'Approved', 'Request must now be fully Approved');
    console.log(`[Step 13] Final verification passed: Request ${createdRequest.id} is Approved at revision 4.`);

    // -------------------------------------------------------------
    // SCENARIO 2: Conflict where the request becomes unavailable (404/null)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 2: Conflict where request becomes unavailable ---');
    const submitRes2 = await fetch(`${origin}/api/requests`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: `precisign_session=${reqToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedWorkflowVersion: 1,
        companyId: 'PEW',
        formType: 'Admin Work Request',
        formData: {
          dateOfRequest: '2026-11-19', department: 'Operations', priority: 'Medium',
          workDescription: 'Scenario 2: Unavailable after conflict',
          documents: {
            onlineDocumentChamber: false, physicalDocumentChamber: false, companyDocumentAjeer: false,
            employeeSalaryCertificate: false, permanentEmploymentVisa: false, workVisitVisa: false,
            businessVisitVisa: false, agencyWakala: false, others: false, othersDescription: '',
          },
        },
        signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQMgkTMgljgFAAEA4CcUNrdOsAAAAASUVORK5CYII=',
      }),
    });
    const req2 = (await submitRes2.json()) as RequestRecord;
    console.log(`[Scenario 2] Request 2 created: ${req2.id}`);

    await page1.goto(`${origin}/requests/${encodeURIComponent(req2.id)}`);
    await page1.waitForSelector('text=Scenario 2: Unavailable after conflict');
    const remarkArea2 = page1.locator('textarea[placeholder*="Add a remark for the signing history"]');
    await remarkArea2.fill('Preserved remark for unavailable request');

    await page1.getByRole('button', { name: 'Approve & sign', exact: true }).click();
    await page1.waitForSelector('#signature-dialog-title');
    const modalS2 = page1.getByRole('dialog');
    console.log('[Scenario 2 Dialog text]:', await modalS2.innerText());
    const typeTabS2 = modalS2.getByRole('button', { name: 'Type', exact: true });
    if (await typeTabS2.count() > 0) {
      await typeTabS2.click();
    }
    const styledInputS2 = modalS2.getByRole('img', { name: /Saved signature for/ });
    await styledInputS2.waitFor({ state: 'visible' });
    assert.ok(await styledInputS2.isVisible());

    // In DB: Bump revision to 2 so approve will 409
    db.prepare('UPDATE requests SET revision = 2 WHERE id = ?').run(req2.id);

    // Intercept GET /api/requests/:id to return 404
    let makeUnavailable = false;
    await page1.route(`**/api/requests/${encodeURIComponent(req2.id)}`, async (route: any) => {
      if (route.request().method() === 'GET' && makeUnavailable) {
        return route.fulfill({ status: 404, json: { error: 'Request not found.' } });
      }
      return route.continue();
    });
    makeUnavailable = true;

    // GM confirms stale approval
    await modalS2.getByRole('button', { name: 'Confirm & sign', exact: true }).click();

    // Verify accurate unavailable message
    const expectedUnavailableMsg = 'This request changed in another session and is no longer available. Your entries are preserved.';
    await page1.waitForSelector(`text=${expectedUnavailableMsg}`, { timeout: 10000 });

    // Verify dialog remains open and styled name is preserved
    assert.ok(await modalS2.isVisible(), 'Modal must remain open');
    assert.ok(await styledInputS2.isVisible());

    // Close dialog and verify textarea preserves remark
    await modalS2.getByRole('button', { name: 'Close signature dialog' }).click();
    await page1.waitForSelector('#signature-dialog-title', { state: 'hidden' });
    assert.equal(await remarkArea2.inputValue(), 'Preserved remark for unavailable request');
    console.log('[Scenario 2] Passed: Unavailable message shown, modal open, inputs preserved.');

    // -------------------------------------------------------------
    // SCENARIO 3: Conflict where refresh fails (network error)
    // -------------------------------------------------------------
    console.log('\n--- Scenario 3: Conflict where refresh encounters network failure ---');
    const submitRes3 = await fetch(`${origin}/api/requests`, {
      method: 'POST',
      headers: { Origin: origin, Cookie: `precisign_session=${reqToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedWorkflowVersion: 1,
        companyId: 'PEW',
        formType: 'Admin Work Request',
        formData: {
          dateOfRequest: '2026-11-19', department: 'Operations', priority: 'Medium',
          workDescription: 'Scenario 3: Network failure after conflict',
          documents: {
            onlineDocumentChamber: false, physicalDocumentChamber: false, companyDocumentAjeer: false,
            employeeSalaryCertificate: false, permanentEmploymentVisa: false, workVisitVisa: false,
            businessVisitVisa: false, agencyWakala: false, others: false, othersDescription: '',
          },
        },
        signatureDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGMQMgkTMgljgFAAEA4CcUNrdOsAAAAASUVORK5CYII=',
      }),
    });
    const req3 = (await submitRes3.json()) as RequestRecord;
    console.log(`[Scenario 3] Request 3 created: ${req3.id}`);

    await page1.goto(`${origin}/requests/${encodeURIComponent(req3.id)}`);
    await page1.waitForSelector('text=Scenario 3: Network failure after conflict');
    const remarkArea3 = page1.locator('textarea[placeholder*="Add a remark for the signing history"]');
    await remarkArea3.fill('Preserved remark for network error');

    await page1.getByRole('button', { name: 'Approve & sign', exact: true }).click();
    await page1.waitForSelector('#signature-dialog-title');
    const modalS3 = page1.getByRole('dialog');
    const typeTabS3 = modalS3.getByRole('button', { name: 'Type', exact: true });
    if (await typeTabS3.count() > 0) {
      await typeTabS3.click();
    }
    const styledInputS3 = modalS3.getByRole('img', { name: /Saved signature for/ });
    await styledInputS3.waitFor({ state: 'visible' });
    assert.ok(await styledInputS3.isVisible());

    // In DB: Bump revision to 2 so approve will 409
    db.prepare('UPDATE requests SET revision = 2 WHERE id = ?').run(req3.id);

    // Intercept GET /api/requests/:id to abort (network error)
    let abortRefresh = false;
    await page1.route(`**/api/requests/${encodeURIComponent(req3.id)}`, async (route: any) => {
      if (route.request().method() === 'GET' && abortRefresh) {
        return route.abort();
      }
      return route.continue();
    });
    abortRefresh = true;

    // GM confirms stale approval
    await modalS3.getByRole('button', { name: 'Confirm & sign', exact: true }).click();

    // Verify accurate failed refresh message
    const expectedFailedRefreshMsg = 'This request changed in another session, but the latest version could not be loaded. Your entries are preserved. Check the connection and try again; no action was retried.';
    await page1.waitForSelector(`text=${expectedFailedRefreshMsg}`, { timeout: 10000 });

    // Verify dialog remains open and styled name is preserved
    assert.ok(await modalS3.isVisible(), 'Modal must remain open');
    assert.ok(await styledInputS3.isVisible());

    // Close dialog and verify textarea preserves remark
    await modalS3.getByRole('button', { name: 'Close signature dialog' }).click();
    await page1.waitForSelector('#signature-dialog-title', { state: 'hidden' });
    assert.equal(await remarkArea3.inputValue(), 'Preserved remark for network error');
    console.log('[Scenario 3] Passed: Failed refresh message shown, modal open, inputs preserved.');

    console.log('\n=== CONNECTED BROWSER CONFLICT FLOW: ALL CHECKS PASSED ===\n');
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (server) {
      await new Promise(resolve => server.close(resolve)).catch(() => {});
    }
    if (db) {
      try { db.close(); } catch {}
    }
    try { rmSync(tempDbPath, { force: true }); } catch {}
    try { rmSync(tempOutDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch(err => {
  console.error('[Browser Conflict Test FAILED]:', err);
  process.exit(1);
});
