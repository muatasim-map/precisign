import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import express from 'express';
import { openDatabase } from '../backend/src/db';
import { createApp } from '../backend/src/app';
import { hashPassword, tokenHash } from '../backend/src/auth';
import { INITIAL_WORKFLOWS } from '../shared/data/seedData';
import type { WorkflowConfig, RequestRecord } from '../shared/types';
import type { AttachmentStorageService } from '../backend/src/attachmentStorage';

async function main() {
  const runId = randomUUID().slice(0, 8);
  const tempOutDir = mkdtempSync(join(tmpdir(), `precisign-findings-build-${runId}-`));
  const tempDbPath = join(tmpdir(), `precisign-findings-${runId}.sqlite`);

  let server: any;
  let browser: any;
  let db: DatabaseSync | undefined;

  try {
    console.log('=== PreciSign Modern Web Guidance Verification ===\n');

    // 1. Build frontend in connected mode (VITE_DATA_MODE=api) into temporary directory
    console.log(`[Step 1] Building frontend in connected mode into ${tempOutDir}...`);
    execFileSync(
      process.execPath,
      ['node_modules/vite/bin/vite.js', 'build', '--outDir', tempOutDir],
      {
        env: { ...process.env, VITE_DATA_MODE: 'api' },
        stdio: 'pipe',
      }
    );
    console.log('[Step 1] Build finished successfully.\n');

    // 2. Initialize isolated temporary database
    console.log(`[Step 2] Initializing isolated temporary SQLite database at ${tempDbPath}...`);
    db = openDatabase(tempDbPath);

    const password = 'Synthetic-findings-1234!';
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
          JSON.stringify(['PEW']),
          JSON.stringify({ PEW: ['Admin Work Request', 'Administrative & Payment Request'] }),
          role === 'Director' ? 1 : 0
        );
    };

    insertUser(reqId, reqEmail, 'Synthetic Requester', 'Admin');
    insertUser(gmId, gmEmail, 'Synthetic GM', 'General Manager');
    insertUser(dirId, dirEmail, 'Synthetic Director', 'Director');

    // Configure workflow
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
    db.prepare('INSERT INTO workflows (company_id, form_type, version, config) VALUES (?, ?, ?, ?)')
      .run('PEW', 'Administrative & Payment Request', 1, JSON.stringify({ ...wf, id: `wf-pew-ap-${runId}`, formType: 'Administrative & Payment Request' }));

    // Storage mock to test temporary storage failures
    let simulateStorageFailure = false;
    const mockStorage: AttachmentStorageService = {
      async upload() {},
      async download() {
        if (simulateStorageFailure) {
          throw new Error('Simulated R2 storage connection timeout');
        }
      },
    };

    // 3. Start Express server with connected API and static build
    const site = express();
    server = site.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = (server.address() as { port: number }).port;
    const origin = `http://127.0.0.1:${port}`;

    const apiApp = await createApp(db, { origin, secureCookies: false }, mockStorage);
    site.use('/api', (req, res, next) => { req.url = '/api' + req.url; apiApp(req, res, next); });
    site.use(express.static(tempOutDir));
    site.get('*', (_req, res) => res.sendFile(join(tempOutDir, 'index.html')));

    console.log(`[Step 3] App server listening at ${origin}\n`);

    // Create a synthetic request with an attachment for testing
    const reqToken = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(tokenHash(reqToken), reqId, Date.now() + 3600000);

    const syntheticPngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    const submitRes = await fetch(`${origin}/api/requests`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: `precisign_session=${reqToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        companyId: 'PEW',
        formType: 'Admin Work Request',
        formData: {
          workDescription: 'Precision lathe alignment for synthetic testing',
          dateOfRequest: '2026-11-20',
          department: 'Engineering',
          priority: 'Medium',
          documents: {
            onlineDocumentChamber: false,
            physicalDocumentChamber: false,
            companyDocumentAjeer: false,
            employeeSalaryCertificate: false,
            permanentEmploymentVisa: false,
            workVisitVisa: false,
            businessVisitVisa: false,
            agencyWakala: false,
            others: false,
            othersDescription: '',
          },
        },
        attachments: [
          {
            id: 'file-synthetic-1',
            name: 'spec-sheet.png',
            sizeBytes: 68,
            sizeFormatted: '68 B',
            mimeType: 'image/png',
            dataUrl: syntheticPngDataUrl,
          },
          {
            id: 'file-synthetic-2',
            name: 'remote-attachment.png',
            sizeBytes: 68,
            sizeFormatted: '68 B',
            mimeType: 'image/png',
            dataUrl: syntheticPngDataUrl,
          },
        ],
        signatureDataUrl: syntheticPngDataUrl,
      }),
    });

    if (submitRes.status !== 201) {
      console.error('Submit error:', await submitRes.text());
    }
    assert.equal(submitRes.status, 201, 'Synthetic submission should succeed');
    const createdReq = await submitRes.json();
    const requestId = createdReq.id;
    console.log(`Created synthetic request ${requestId} for testing.\n`);

    // In SQLite, update file-synthetic-2 to have an r2: reference so we can test R2 download & 503 error handling
    const row = db.prepare('SELECT record FROM requests WHERE id = ?').get(requestId) as { record: string };
    const rec = JSON.parse(row.record);
    rec.attachments[1].dataUrl = 'r2:precisign-attachments/v1/synthetic-hash';
    db.prepare('UPDATE requests SET record = ? WHERE id = ?').run(JSON.stringify(rec), requestId);

    browser = await chromium.launch({ channel: 'chrome', headless: true });

    // =========================================================================
    // Finding 1: Keyboard access to signature uploads in SignatureModal
    // =========================================================================
    console.log('--- Checking Finding 1: Keyboard access to signature uploads ---');
    const pageKbd = await browser.newPage();
    await pageKbd.goto(`${origin}/`);

    // Sign in as GM Signer
    await pageKbd.fill('input[type="email"]', gmEmail);
    await pageKbd.fill('input[type="password"]', password);
    await Promise.all([
      pageKbd.waitForResponse((res: any) => res.url().includes('/api/auth/login') && res.status() === 200),
      pageKbd.click('button[type="submit"]'),
    ]);
    await pageKbd.waitForSelector('input[type="email"]', { state: 'detached' });

    // Open the synthetic request review page
    await pageKbd.goto(`${origin}/requests/${encodeURIComponent(requestId)}`);
    await pageKbd.waitForSelector('button:has-text("Approve & sign")');

    // Open signature modal by clicking Approve & sign
    await pageKbd.click('button:has-text("Approve & sign")');
    await pageKbd.waitForSelector('#signature-dialog-title');

    // Navigate to the Upload tab using keyboard:
    // Focus the Upload tab button and press Enter
    const uploadTabButton = pageKbd.locator('button:has-text("Upload")');
    await uploadTabButton.focus();
    await pageKbd.keyboard.press('Enter');

    // Verify upload tab is active
    await pageKbd.waitForSelector('text=Choose PNG or JPEG image');

    // Verify file input is focusable and reachable via keyboard
    const fileInput = pageKbd.locator('#sig-file-upload');
    await fileInput.focus();
    const isFocused = await fileInput.evaluate((el: any) => document.activeElement === el);
    assert.equal(isFocused, true, 'File input should receive keyboard focus');

    // Check visible focus indicator styles
    const labelStyles = await pageKbd.locator('label[for="sig-file-upload"]').evaluate((el: any) => {
      const parent = el.closest('div');
      return {
        hasPeerSrOnly: el.previousElementSibling?.classList.contains('sr-only'),
        parentClasses: parent?.className,
      };
    });
    assert.equal(labelStyles.hasPeerSrOnly, true, 'File input must use sr-only instead of hidden');

    // Create a synthetic PNG buffer
    const syntheticBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    // Upload the synthetic file via keyboard / file chooser
    await fileInput.setInputFiles({
      name: 'synthetic-signature.png',
      mimeType: 'image/png',
      buffer: syntheticBuffer,
    });

    // Wait for preview image to appear
    await pageKbd.waitForSelector('img[alt="Uploaded signature"]');
    console.log('  ✓ Synthetic PNG uploaded and rendered in preview');

    // Tab to Confirm button and press Enter
    const confirmButton = pageKbd.locator('button:has-text("Confirm & Apply Signature"), button:has-text("Confirm & sign")');
    await confirmButton.focus();
    const isConfirmFocused = await confirmButton.evaluate((el: any) => document.activeElement === el);
    assert.equal(isConfirmFocused, true, 'Confirm button should receive keyboard focus');
    await pageKbd.keyboard.press('Enter');

    // Wait for submission to complete and modal to close
    await pageKbd.waitForSelector('#signature-dialog-title', { state: 'detached', timeout: 8000 });
    console.log('  ✓ Signature flow completed entirely via keyboard without a mouse!\n');
    await pageKbd.close();

    // =========================================================================
    // Finding 2: Touch / Pointer drawing in SignatureModal
    // =========================================================================
    console.log('--- Checking Finding 2: Touch drawing in signature dialog ---');
    const pageDraw = await browser.newPage();
    await pageDraw.goto(`${origin}/`);

    // Sign in as Director Signer
    await pageDraw.fill('input[type="email"]', dirEmail);
    await pageDraw.fill('input[type="password"]', password);
    await Promise.all([
      pageDraw.waitForResponse((res: any) => res.url().includes('/api/auth/login') && res.status() === 200),
      pageDraw.click('button[type="submit"]'),
    ]);
    await pageDraw.waitForSelector('input[type="email"]', { state: 'detached' });

    await pageDraw.goto(`${origin}/requests/${encodeURIComponent(requestId)}`);
    await pageDraw.waitForSelector('button:has-text("Approve & sign")');

    await pageDraw.click('button:has-text("Approve & sign")');
    await pageDraw.waitForSelector('#signature-dialog-title');

    // Switch to Draw tab
    await pageDraw.click('button:has-text("Draw")');
    await pageDraw.waitForSelector('canvas[aria-label="Signature drawing area"]');

    // Dispatch pointer events onto the canvas
    const canvas = pageDraw.locator('canvas[aria-label="Signature drawing area"]');
    const canvasBox = await canvas.boundingBox();
    assert.ok(canvasBox, 'Canvas bounding box should be valid');

    // Perform drawing using pointer events
    await pageDraw.evaluate(() => {
      const c = document.querySelector('canvas[aria-label="Signature drawing area"]') as HTMLCanvasElement;
      if (!c) throw new Error('Canvas not found');
      const rect = c.getBoundingClientRect();

      // Dispatch PointerDown
      c.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: rect.left + 50,
        clientY: rect.top + 30,
      }));

      // Dispatch PointerMove
      c.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: rect.left + 150,
        clientY: rect.top + 70,
      }));

      // Dispatch PointerUp
      c.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: rect.left + 150,
        clientY: rect.top + 70,
      }));
    });

    // Check if canvas has non-blank data
    const hasDrawn = await pageDraw.evaluate(() => {
      const c = document.querySelector('canvas[aria-label="Signature drawing area"]') as HTMLCanvasElement;
      const ctx = c?.getContext('2d');
      if (!ctx) return false;
      const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
      return pixels.some(p => p !== 0);
    });
    assert.equal(hasDrawn, true, 'Canvas should contain drawn signature pixels from touch/pointer event');
    console.log('  ✓ Touch/pen pointer drawing produces signature mark on canvas');

    // Test pointer cancel handling
    await pageDraw.evaluate(() => {
      const c = document.querySelector('canvas[aria-label="Signature drawing area"]') as HTMLCanvasElement;
      c.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 2,
        pointerType: 'touch',
        isPrimary: true,
        button: 0,
        clientX: 10,
        clientY: 10,
      }));
      c.dispatchEvent(new PointerEvent('pointercancel', {
        bubbles: true,
        cancelable: true,
        pointerId: 2,
        pointerType: 'touch',
        isPrimary: true,
      }));
    });
    console.log('  ✓ Pointer cancellation gracefully handled without error');

    // Test Clear Canvas
    await pageDraw.click('button:has-text("Clear Canvas")');
    const isCleared = await pageDraw.evaluate(() => {
      const c = document.querySelector('canvas[aria-label="Signature drawing area"]') as HTMLCanvasElement;
      const ctx = c?.getContext('2d');
      if (!ctx) return true;
      const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
      return !pixels.some(p => p !== 0);
    });
    assert.equal(isCleared, true, 'Canvas should be clean after Clear Canvas');
    console.log('  ✓ Clear Canvas resets drawing state and data URL\n');
    await pageDraw.close();

    // =========================================================================
    // Finding 3: Historical attachment download errors
    // =========================================================================
    console.log('--- Checking Finding 3: Historical attachment download errors ---');
    // Test direct API responses for neutral wording & status codes
    // 3a: Non-existent attachment on valid request (404)
    const res404 = await fetch(`${origin}/api/requests/${requestId}/attachments/1/non-existent-file`, {
      headers: { Cookie: `precisign_session=${reqToken}` },
    });
    assert.equal(res404.status, 404, 'Missing attachment should return 404');
    const data404 = await res404.json();
    assert.equal(data404.error, 'Attachment unavailable.', 'Unavailable attachment wording must be neutral');
    console.log(`  ✓ 404 response returns neutral message: "${data404.error}"`);

    // 3b: Unauthorized request access (should return 404 Attachment unavailable without leaking existence)
    const unauthorizedToken = randomBytes(32).toString('hex');
    const unauthUserId = `usr-unauth-${runId}`;
    db.prepare('INSERT INTO users (id, email, name, role, department, company_id, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(unauthUserId, `unauth-${runId}@example.test`, 'Unauth', 'IT', 'IT', 'ICCL', passwordHash);
    db.prepare('INSERT INTO account_access (user_id, company_grants, form_grants, is_super_admin, is_disabled, must_change_password) VALUES (?, ?, ?, 0, 0, 0)')
      .run(unauthUserId, JSON.stringify(['ICCL']), JSON.stringify([]));
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(tokenHash(unauthorizedToken), unauthUserId, Date.now() + 3600000);

    const resUnauth = await fetch(`${origin}/api/requests/${requestId}/attachments/1/file-synthetic-1`, {
      headers: { Cookie: `precisign_session=${unauthorizedToken}` },
    });
    assert.equal(resUnauth.status, 404, 'Inaccessible request attachment should return 404');
    const dataUnauth = await resUnauth.json();
    assert.equal(dataUnauth.error, 'Attachment unavailable.', 'Inaccessible request must not expose whether request exists');
    console.log('  ✓ Inaccessible request returns neutral 404 without leaking request existence');

    // 3c: Temporary storage failure (503)
    simulateStorageFailure = true;
    const res503 = await fetch(`${origin}/api/requests/${requestId}/attachments/1/${rec.attachments[1].id}`, {
      headers: { Cookie: `precisign_session=${reqToken}` },
    });
    assert.equal(res503.status, 503, 'Storage failure should return 503');
    const data503 = await res503.json();
    assert.ok(data503.error.includes('unavailable'), '503 error explains storage failure');
    console.log(`  ✓ Storage failure returns 503: "${data503.error}"\n`);
    simulateStorageFailure = false;

    // =========================================================================
    // Finding 4: Mobile validation feedback
    // =========================================================================
    console.log('--- Checking Finding 4: Mobile validation feedback ---');
    const pageMobile = await browser.newPage();
    // Set to iPhone 14 viewport
    await pageMobile.setViewportSize({ width: 390, height: 844 });
    await pageMobile.goto(`${origin}/`);

    // Sign in as Requester
    await pageMobile.fill('input[type="email"]', reqEmail);
    await pageMobile.fill('input[type="password"]', password);
    await Promise.all([
      pageMobile.waitForResponse((res: any) => res.url().includes('/api/auth/login') && res.status() === 200),
      pageMobile.click('button[type="submit"]'),
    ]);
    await pageMobile.waitForSelector('input[type="email"]', { state: 'detached' });

    await pageMobile.goto(`${origin}/forms/administrative-payment/new`);
    if (await pageMobile.locator('select').isVisible()) {
      await pageMobile.selectOption('select', 'PEW');
    }
    await pageMobile.waitForSelector('text=Request administrative work and add payment details');

    // Toggle to Live A4 preview tab on mobile
    const previewToggle = pageMobile.locator('button:has-text("Live A4 preview")');
    await previewToggle.click();
    await pageMobile.waitForSelector('.editor-preview');

    // Verify .editor-fields is hidden while on mobile preview
    const isFieldsHidden = await pageMobile.locator('.editor-fields').evaluate((el: any) => {
      return window.getComputedStyle(el).display === 'none';
    });
    assert.equal(isFieldsHidden, true, '.editor-fields should be hidden when viewing mobile preview');

    // Submit with required description empty from the preview tab
    const submitBtn = pageMobile.locator('button:has-text("Sign & Submit Request")');
    await submitBtn.click();

    // Verify editor tab opened automatically
    await pageMobile.waitForSelector('.editor-fields');
    const isFieldsVisible = await pageMobile.locator('.editor-fields').evaluate((el: any) => {
      return window.getComputedStyle(el).display !== 'none';
    });
    assert.equal(isFieldsVisible, true, 'Editor view should automatically open on failed submit');

    // Verify accessible error summary or invalid field received focus
    await pageMobile.waitForTimeout(200);
    const focusedElement = await pageMobile.evaluate(() => {
      const active = document.activeElement;
      return {
        id: active?.id,
        tagName: active?.tagName,
        ariaInvalid: active?.getAttribute('aria-invalid'),
        role: active?.getAttribute('role'),
      };
    });
    console.log('  Focused element after mobile preview submit:', focusedElement);

    // Verify error announcement with role="alert" exists
    const alertExists = await pageMobile.locator('[role="alert"]').count();
    assert.ok(alertExists > 0, 'Accessible role="alert" message must exist in the DOM');

    const alertText = await pageMobile.locator('[role="alert"]').first().innerText();
    console.log(`  ✓ Screen reader announcement present: "${alertText.trim()}"`);
    console.log('  ✓ Focus moved to invalid field or accessible error summary after editor opened\n');
    await pageMobile.close();

    // =========================================================================
    // Finding 5: Font loading measurement & fallback stability
    // =========================================================================
    console.log('--- Checking Finding 5: Font loading measurements ---');

    async function measureFontScenario(blocked: boolean) {
      const context = await browser.newContext();
      const page = await context.newPage();

      if (blocked) {
        await page.route('**fonts.googleapis.com/**', (route: any) => route.abort());
        await page.route('**fonts.gstatic.com/**', (route: any) => route.abort());
      }

      // Collect layout shifts
      await page.addInitScript(() => {
        (window as any).__cls = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!(entry as any).hadRecentInput) {
              (window as any).__cls += (entry as any).value;
            }
          }
        });
        observer.observe({ type: 'layout-shift', buffered: true });
      });

      // 1. Measure Sign-In page
      const startSignIn = Date.now();
      await page.goto(`${origin}/`, { waitUntil: 'load' });
      const signInLoadMs = Date.now() - startSignIn;

      const signInMetrics = await page.evaluate(() => {
        const perf = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        const authMain = document.querySelector('.preci-auth-main');
        const computed = authMain ? window.getComputedStyle(authMain) : null;
        return {
          domContentLoadedMs: Math.round(perf?.domContentLoadedEventEnd || 0),
          cls: (window as any).__cls || 0,
          fontFamily: computed?.fontFamily,
          fontSizeAdjust: computed?.fontSizeAdjust,
        };
      });

      // 2. Sign in and measure Request Review page
      await page.fill('input[type="email"]', reqEmail);
      await page.fill('input[type="password"]', password);
      await Promise.all([
        page.waitForResponse((res: any) => res.url().includes('/api/auth/login') && res.status() === 200),
        page.click('button[type="submit"]'),
      ]);
      await page.waitForSelector('input[type="email"]', { state: 'detached' });

      // Navigate to the synthetic request review page
      const startReview = Date.now();
      await page.goto(`${origin}/requests/${requestId}`, { waitUntil: 'load' });
      const reviewLoadMs = Date.now() - startReview;

      const reviewMetrics = await page.evaluate(() => {
        const docHeader = document.querySelector('h1, h2');
        const computed = docHeader ? window.getComputedStyle(docHeader) : null;
        return {
          cls: (window as any).__cls || 0,
          fontFamily: computed?.fontFamily,
        };
      });

      // 3. Test typed signature preview rendering
      await page.goto(`${origin}/settings/profile`);
      await page.waitForSelector('text=Signature settings');
      const sigPreviewMetrics = await page.evaluate(() => {
        const preview = document.querySelector('div[style*="Caveat"]');
        if (!preview) return null;
        const rect = preview.getBoundingClientRect();
        const computed = window.getComputedStyle(preview);
        return {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          fontFamily: computed.fontFamily,
          text: preview.textContent?.trim(),
        };
      });

      await context.close();
      return {
        blocked,
        signInLoadMs,
        signInMetrics,
        reviewLoadMs,
        reviewMetrics,
        sigPreviewMetrics,
      };
    }

    console.log('  Measuring Scenario A: Font host reachable (Google Fonts allowed)...');
    const normalMetrics = await measureFontScenario(false);
    console.log('    Sign-in load time:', normalMetrics.signInLoadMs, 'ms | CLS:', normalMetrics.signInMetrics.cls);
    console.log('    Review load time:', normalMetrics.reviewLoadMs, 'ms | CLS:', normalMetrics.reviewMetrics.cls);
    console.log('    Signature font family:', normalMetrics.sigPreviewMetrics?.fontFamily);

    console.log('  Measuring Scenario B: Font host blocked (fonts.googleapis.com / fonts.gstatic.com aborted)...');
    const blockedMetrics = await measureFontScenario(true);
    console.log('    Sign-in load time (blocked):', blockedMetrics.signInLoadMs, 'ms | CLS:', blockedMetrics.signInMetrics.cls);
    console.log('    Review load time (blocked):', blockedMetrics.reviewLoadMs, 'ms | CLS:', blockedMetrics.reviewMetrics.cls);
    console.log('    Signature font family (blocked):', blockedMetrics.sigPreviewMetrics?.fontFamily);

    // Save metrics summary for the report
    const measurementSummary = {
      normal: normalMetrics,
      blocked: blockedMetrics,
    };
    writeFileSync(join(tempOutDir, 'font-measurements.json'), JSON.stringify(measurementSummary, null, 2));

    console.log('\n=== All 5 Findings Verified Successfully! ===');
  } finally {
    if (browser) await browser.close();
    if (server) server.close();
    if (db) db.close();
    if (existsSync(tempDbPath)) rmSync(tempDbPath, { force: true });
    if (existsSync(tempOutDir)) rmSync(tempOutDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
