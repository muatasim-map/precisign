import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
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
  const tempOutDir = mkdtempSync(join(tmpdir(), `precisign-signin-build-${runId}-`));
  const tempDbPath = join(tmpdir(), `precisign-signin-${runId}.sqlite`);

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

    const password = 'Synthetic-signin-1234!';
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

    // Sign-in preview checks against the isolated connected build.
    const OUT = join(process.cwd(), '.artifacts', 'signin-polish');
    mkdirSync(join(OUT, 'frames'), { recursive: true });
    const findings: Record<string, unknown> = {};
    const executablePath = process.env.PRECISIGN_PDF_CHROMIUM;
    browser = await chromium.launch({
      executablePath,
      channel: !executablePath && !existsSync(chromium.executablePath()) && process.platform === 'win32' ? 'msedge' : undefined,
      headless: true, timeout: 25000,
    });
    const errors: string[] = [];
    const card = 'section[aria-label="PreciRoute workflow preview"]';
    const activeLabel = (page: any) => page.locator(`${card} li[aria-current="step"] .auth-flow-label`).innerText();
    const activeDescription = (page: any) => page.locator(`${card} .auth-flow-description p[data-active]`).innerText();
    const waitForStage = async (page: any, label: string) => {
      await page.waitForFunction(({ card, label }: { card: string; label: string }) =>
        document.querySelector(`${card} li[aria-current="step"] .auth-flow-label`)?.textContent?.startsWith(label), { card, label }, { timeout: 10000 });
    };

    // 1. Desktop: copy, full loop timing, each stage, fixed geometry, video.
    const desktop = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await desktop.addInitScript('globalThis.__name = globalThis.__name || (f => f)');
    const page = await desktop.newPage();
    page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(`${origin}/`);
    await page.waitForSelector('input[type="email"]');
    await page.waitForSelector(card);
    const story = await page.locator('.preci-auth-story-content').innerText();
    assert.match(story, /Your E-Approval Platform/i);
    assert.match(story, /A step away from paper trails\.\s*A step toward tangible approvals\./);
    const expected: Record<string, string> = {
      Submitted: 'An employee submits a request.',
      'In review': 'Assigned approvers review and sign.',
      Complete: 'Signing is complete. The signed request stays on record.',
    };
    const boxes = new Set<string>();
    const geometry = async () => JSON.stringify(await page.evaluate((card: string) => {
      const root = document.querySelector(card)!;
      const r = (el: Element | null) => { const b = el!.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
      return { card: r(root), labels: [...root.querySelectorAll('.auth-flow-label')].map(r), description: r(root.querySelector('.auth-flow-description')) };
    }, card));
    await waitForStage(page, 'Submitted');
    const stageTimes: Record<string, number> = {};
    const loopStart = Date.now();
    for (const [label, file] of [['In review', '02-in-review'], ['Complete', '03-complete'], ['Submitted', '01-submitted']] as const) {
      await waitForStage(page, label);
      stageTimes[label] = Date.now() - loopStart;
      await page.waitForTimeout(label === 'In review' ? 1300 : 700); // let the marker, pen stroke and description settle
      assert.equal(await activeDescription(page), expected[label]);
      boxes.add(await geometry());
      await page.locator('.preci-auth-story').screenshot({ path: join(OUT, `desktop-${file}.png`) });
    }
    findings.loopMs = stageTimes.Submitted;
    findings.stageStartMs = stageTimes;
    assert.ok(stageTimes.Submitted > 5000 && stageTimes.Submitted < 7500, `loop ${stageTimes.Submitted}ms`);
    findings.geometryStableAcrossStages = boxes.size === 1;
    assert.equal(boxes.size, 1, 'labels, description and card must not move or resize');
    // A finished step keeps its check and filled connector while Complete holds.
    await waitForStage(page, 'Complete');
    await page.waitForTimeout(500);
    const doneState = await page.locator(`${card} .auth-flow-marker`).evaluateAll((markers: Element[]) => markers.map(m => m.getAttribute('data-state')));
    const filled = await page.locator(`${card} .auth-flow-connector > span[data-filled]`).count();
    assert.deepEqual(doneState, ['done', 'done', 'active']);
    assert.equal(filled, 2);
    findings.completeState = { markers: doneState, filledConnectors: filled };

    // Recording substitute (no ffmpeg): one loop of card frames assembled into an animated WebP.
    await waitForStage(page, 'Submitted');
    const frames: Buffer[] = [];
    const delays: number[] = [];
    let last = Date.now();
    const recordStart = last;
    while (Date.now() - recordStart < 6400) {
      frames.push(await page.locator(card).screenshot());
      const now = Date.now();
      delays.push(now - last); last = now;
    }
    delays.shift(); delays.push(delays[delays.length - 1] ?? 100);
    await sharp(frames, { join: { animated: true } }).webp({ delay: delays, loop: 0, quality: 85 }).toFile(join(OUT, 'loop.webp'));
    findings.recording = { frames: frames.length, ms: Date.now() - recordStart, file: 'loop.webp' };

    // 2. Pause and resume from the keyboard.
    const toggle = page.getByRole('button', { name: 'Pause animation' });
    await toggle.focus();
    await page.keyboard.press('Enter');
    const pausedLabel = await activeLabel(page);
    await page.waitForTimeout(3500);
    assert.equal(await activeLabel(page), pausedLabel, 'stage must not change while paused');
    const playButton = page.getByRole('button', { name: 'Play animation' });
    assert.equal(await playButton.getAttribute('aria-pressed'), 'true');
    await page.locator('.preci-auth-story').screenshot({ path: join(OUT, 'desktop-paused.png') });
    await page.keyboard.press('Space');
    await page.getByRole('button', { name: 'Pause animation' }).waitFor();
    await page.waitForFunction(({ card, label }: { card: string; label: string }) =>
      !document.querySelector(`${card} li[aria-current="step"] .auth-flow-label`)?.textContent?.startsWith(label), { card, label: pausedLabel.split(',')[0] }, { timeout: 4000 });
    findings.pauseResume = { pausedOn: pausedLabel.split('\n')[0], heldFor: '3.5 s', resumedByKeyboard: true };

    // 3. Sign-in still works while the loop runs.
    await page.fill('input[type="email"]', reqEmail);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');
    await page.locator('.preci-shell').waitFor({ timeout: 15000 });
    findings.signInWhileAnimating = true;
    await page.close();
    await desktop.close();

    // 4. Reduced motion: static list with all labels and descriptions, no pause control.
    const reduced = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: 'reduce' });
    await reduced.addInitScript('globalThis.__name = globalThis.__name || (f => f)');
    const rPage = await reduced.newPage();
    rPage.on('pageerror', (e: Error) => errors.push(e.message));
    await rPage.goto(`${origin}/`);
    await rPage.waitForSelector(`${card} .auth-flow-static`);
    const staticText = await rPage.locator(card).innerText();
    for (const [label, description] of Object.entries(expected)) {
      assert.ok(staticText.includes(label) && staticText.includes(description), `reduced motion shows ${label}`);
    }
    assert.equal(await rPage.getByRole('button', { name: /animation/ }).count(), 0);
    await rPage.locator('.preci-auth-story').screenshot({ path: join(OUT, 'desktop-reduced-motion.png') });
    await reduced.close();

    // 5. Phone: compact card above a usable form, no horizontal scroll.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await phone.addInitScript('globalThis.__name = globalThis.__name || (f => f)');
    const pPage = await phone.newPage();
    pPage.on('pageerror', (e: Error) => errors.push(e.message));
    await pPage.goto(`${origin}/`);
    await pPage.waitForSelector(card);
    for (const [label, file] of [['Submitted', '01-submitted'], ['In review', '02-in-review'], ['Complete', '03-complete']] as const) {
      await waitForStage(pPage, label);
      await pPage.waitForTimeout(label === 'In review' ? 1300 : 700);
      await pPage.screenshot({ path: join(OUT, `phone-${file}.png`) });
    }
    const phoneLayout = await pPage.evaluate((card: string) => {
      const c = document.querySelector(card)!.getBoundingClientRect();
      const submit = document.querySelector('button[type="submit"]')!.getBoundingClientRect();
      const labels = [...document.querySelectorAll(`${card} .auth-flow-label`)].map(el => { const b = el.getBoundingClientRect(); return [b.left, b.right]; });
      return { cardHeight: Math.round(c.height), submitBottom: Math.round(submit.bottom), viewport: innerHeight,
        horizontalScroll: document.documentElement.scrollWidth > innerWidth, labelsOverlap: labels.some((l, i) => i > 0 && l[0] < labels[i - 1][1]) };
    }, card);
    findings.phone = phoneLayout;
    assert.equal(phoneLayout.horizontalScroll, false);
    assert.equal(phoneLayout.labelsOverlap, false);
    await pPage.fill('input[type="email"]', gmEmail);
    await pPage.fill('input[type="password"]', password);
    await pPage.locator('button[type="submit"]').tap();
    await pPage.locator('.preci-shell').waitFor({ timeout: 15000 });
    findings.phoneSignIn = true;
    await phone.close();

    findings.pageErrors = errors;
    assert.deepEqual(errors, []);
    writeFileSync(join(OUT, 'findings.json'), JSON.stringify(findings, null, 2));
    console.log('SIGNIN FINDINGS', JSON.stringify(findings));
  } finally {
    try { await browser?.close(); } catch {}
    try { if (server) await new Promise(resolve => server.close(resolve)); } catch {}
    try { db?.close(); } catch {}
    try { rmSync(tempDbPath, { force: true }); } catch {}
    try { rmSync(tempOutDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch(error => { console.error(error); process.exit(1); });
