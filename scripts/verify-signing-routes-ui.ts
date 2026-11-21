import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
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
  const tempOutDir = mkdtempSync(join(tmpdir(), `precisign-routes-build-${runId}-`));
  const tempDbPath = join(tmpdir(), `precisign-routes-${runId}.sqlite`);

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

    const password = 'Synthetic-routes-1234!';
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

    // ---- Signing routes UI verification (synthetic data only) ----
    const OUT = join(process.cwd(), '.artifacts', 'signing-routes-ui');
    mkdirSync(OUT, { recursive: true });
    const findings: Record<string, unknown> = {};
    const people: Record<string, string> = {};
    for (const [key, name, role] of [['sami', 'Sami Rahman', 'General Manager'], ['farhan', 'Farhan Ali', 'Finance'], ['fariha', 'Fariha Khan', 'Director'], ['noor', 'Noor Hasan', 'HR']] as const) {
      people[key] = `usr-${key}-${runId}`;
      insertUser(people[key], `${key}-${runId}@example.test`, name, role);
    }
    // An employee who lost PEW access: assigned on a saved route to exercise eligibility feedback.
    people.former = `usr-former-${runId}`;
    db.prepare('INSERT INTO users (id, email, name, role, department, company_id, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)').run(people.former, `former-${runId}@example.test`, 'Former Signer', 'Finance', 'Finance', 'ICCL', passwordHash);
    db.prepare('INSERT INTO account_access (user_id, company_grants, form_grants, is_super_admin, is_disabled, must_change_password) VALUES (?, ?, ?, 0, 0, 0)').run(people.former, JSON.stringify(['ICCL']), JSON.stringify({}));
    const stage = (id: string, name: string, final: boolean, assignedUserId?: string, backupSignerIds: string[] = [], slot?: 'department-head') => ({
      id, stageNumber: 1, name, isFinalApproval: final, mapsToDocumentSignature: final, documentSlot: slot, canReject: true, canReturnForCorrection: true,
      requiredOnSubmit: final, mustSign: false, assignedUserId, backupSignerIds,
    });
    const route = (formType: string, stages: ReturnType<typeof stage>[]) => ({
      id: `wf-${formType}-${runId}`, companyId: 'PEW', formType, version: 1, signerSelection: 'company-directory', allowFinalBypass: true,
      preventSelfApproval: true, allowDirectorOverride: false, reminderDays: 0, escalationDays: 0, rejectionBehavior: 'archive', returnBehavior: 'restart_workflow',
      stages: stages.map((item, index) => ({ ...item, stageNumber: index + 1 })),
    });
    const insertRoute = (config: ReturnType<typeof route>) => db!.prepare('INSERT INTO workflows (company_id, form_type, version, config) VALUES (?, ?, ?, ?)').run('PEW', config.formType, 1, JSON.stringify(config));
    insertRoute(route('Administrative & Payment Request', [
      stage('dept', 'Department Head Signature', false, people.sami, [], 'department-head'),
      stage('finance', 'Finance check', false, people.noor, []),
      stage('final', 'Approver Signature', true, people.fariha, [people.farhan]),
    ]));
    insertRoute(route('IT Request', [stage('itreview', 'Department Review', false, people.sami), stage('itfinal', 'Approval Authority Signature', true, people.fariha)]));
    insertRoute(route('Cash Voucher', [stage('cvfinal', 'Approved by', true, people.former)]));

    const executablePath = process.env.PRECISIGN_PDF_CHROMIUM;
    browser = await chromium.launch({
      executablePath,
      channel: !executablePath && !existsSync(chromium.executablePath()) && process.platform === 'win32' ? 'msedge' : undefined,
      headless: true, timeout: 25000,
    });
    const errors: string[] = [];
    const open = async (viewport: { width: number; height: number }, mobile = false) => {
      const context = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { deviceScaleFactor: 1 }) });
      await context.addInitScript('globalThis.__name = globalThis.__name || (f => f)');
      const page = await context.newPage();
      page.on('pageerror', (e: Error) => errors.push(e.message));
      await page.goto(`${origin}/`);
      await page.fill('input[type="email"]', dirEmail);
      await page.fill('input[type="password"]', password);
      await page.click('button[type="submit"]');
      await page.locator('.preci-shell').waitFor({ timeout: 15000 });
      await page.goto(`${origin}/settings/signing-routes`);
      await page.getByRole('heading', { name: 'Signing routes', exact: true }).waitFor();
      const company = page.getByRole('combobox', { name: /^Company/ });
      if ((await company.inputValue()) !== 'PEW') await company.selectOption('PEW');
      return { context, page };
    };
    const shot = (page: any, name: string, full = true) => page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full });
    const selectForm = (page: any, name: string) => page.getByRole('combobox', { name: /^Form/ }).selectOption(name);
    const stepCard = (page: any, label: string) => page.getByRole('group', { name: new RegExp(`^Step \\d+: ${label}$`) });
    const backup = async (page: any, step: string, name: string) => { const card = stepCard(page, step); const box = card.locator('details.route-backups'); if (!(await box.evaluate((el: any) => el.open))) await box.locator('summary').click(); return card.getByLabel(name); };
    const summary = (page: any) => page.getByRole('list', { name: 'Changes' });

    const { context: desk, page } = await open({ width: 1366, height: 900 });

    // 1. Review mode, multiple intermediate steps.
    await selectForm(page, 'Administrative & Payment Request');
    await page.getByRole('heading', { name: 'Saved route' }).waitFor();
    const reviewText = await page.locator('.route-rail').innerText();
    for (const name of ['Sami Rahman', 'Noor Hasan', 'Fariha Khan', 'Farhan Ali', 'Required step']) assert.ok(reviewText.includes(name), `review shows ${name}`);
    assert.match(await page.locator('#route-skip-title + p').innerText(), /If Department Head Signature is skipped, the request goes to Finance check\./);
    await shot(page, 'desktop-01-review-multiple-steps');

    // 2. Empty state and suggested defaults.
    await selectForm(page, 'Expense Claim');
    await page.getByText('No saved signing route for this form').waitFor();
    await shot(page, 'desktop-02-empty-state');
    await page.getByRole('button', { name: 'Set up route' }).click();
    await page.getByRole('heading', { name: 'Set up route' }).waitFor();
    assert.ok(await page.getByText('Suggestion until saved').first().isVisible(), 'defaults are labelled as suggestions');
    await shot(page, 'desktop-03-setup-suggested-defaults');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByText('No saved signing route for this form').waitFor();
    findings.emptyState = 'shown; Set up route opens suggestions; untouched Cancel returns without a prompt';

    // 3. Edit, keyboard and pointer reordering.
    await selectForm(page, 'Administrative & Payment Request');
    await page.getByRole('button', { name: 'Edit route' }).click();
    await page.getByRole('heading', { name: 'Edit route' }).waitFor();
    const earlier = page.getByRole('button', { name: 'Move Finance check earlier' });
    const later = page.getByRole('button', { name: 'Move Finance check later' });
    assert.equal(await page.getByRole('button', { name: 'Move Department Head Signature earlier' }).isDisabled(), true, 'first intermediate cannot move earlier');
    assert.equal(await later.isDisabled(), true, 'last intermediate cannot pass the final approval');
    assert.equal(await page.getByRole('button', { name: /Move Approver Signature/ }).count(), 0, 'final approval has no arrows');
    await earlier.focus();
    await page.keyboard.press('Enter');
    const order = async () => page.locator('.route-rail-edit h3').allInnerTexts();
    assert.deepEqual(await order(), ['Finance check', 'Department Head Signature', 'Approver Signature']);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    assert.equal(focused, 'Move Finance check later', 'focus stays with the moved step');
    const announced = await page.locator('[aria-live="polite"]').first().innerText();
    assert.equal(announced, 'Finance check moved to step 2 of 4.');
    // Signer and backups moved with the step.
    assert.equal(await stepCard(page, 'Finance check').getByLabel('Suggested signer').inputValue(), people.noor);
    await shot(page, 'desktop-04-edit-after-keyboard-move');
    await page.getByRole('button', { name: 'Move Finance check later' }).click(); // pointer move back
    assert.deepEqual(await order(), ['Department Head Signature', 'Finance check', 'Approver Signature']);
    findings.reorder = { keyboardFocus: focused, announced, pointerMoveBack: true };

    // 4. Before-save summary.
    await (await backup(page, 'Department Head Signature', 'Farhan Ali')).check();
    await stepCard(page, 'Approver Signature').getByLabel('Suggested final approver').selectOption(people.sami);
    const changesText = await summary(page).innerText();
    assert.match(changesText, /Backup added: Farhan Ali/);
    assert.match(changesText, /Final approver changed from Fariha Khan to Sami Rahman/);
    assert.match(await page.locator('.route-summary').innerText(), /Applies to new requests for this company and form/);
    await shot(page, 'desktop-05-change-summary');
    findings.summary = changesText.split('\n').filter(Boolean);

    // 5. Discard: switching form, then Cancel.
    await selectForm(page, 'IT Request');
    await page.getByRole('alertdialog').waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Keep editing');
    await shot(page, 'desktop-06-discard-prompt');
    await page.getByRole('button', { name: 'Keep editing' }).click();
    assert.equal(await page.getByRole('combobox', { name: /^Form/ }).inputValue(), 'Administrative & Payment Request', 'keep editing keeps the selection');
    assert.match(await summary(page).innerText(), /Backup added: Farhan Ali/, 'draft kept');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Discard changes' }).click();
    await page.getByRole('heading', { name: 'Saved route' }).waitFor();
    assert.ok((await page.locator('.route-rail').innerText()).includes('Fariha Khan'), 'saved route unchanged after discard');

    // 6. One intermediate step: both arrows disabled.
    await selectForm(page, 'IT Request');
    await page.getByRole('button', { name: 'Edit route' }).click();
    assert.equal(await page.getByRole('button', { name: 'Move Department Review earlier' }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Move Department Review later' }).isDisabled(), true);
    await shot(page, 'desktop-07-one-intermediate-step');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    // 7. Eligibility feedback beside the control.
    await selectForm(page, 'Cash Voucher');
    await page.getByRole('button', { name: 'Edit route' }).click();
    const issue = stepCard(page, 'Approved by').locator('.route-issue');
    await issue.waitFor();
    assert.match(await issue.innerText(), /can no longer sign for/);
    assert.ok(await stepCard(page, 'Approved by').getByLabel('Suggested final approver').getAttribute('aria-describedby'));
    await stepCard(page, 'Approved by').screenshot({ path: join(OUT, 'desktop-08-eligibility-feedback.png') });
    await stepCard(page, 'Approved by').getByLabel('Suggested final approver').selectOption(people.fariha);
    assert.equal(await issue.count(), 0, 'issue clears once a valid signer is chosen');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Discard changes' }).click();

    // 8. Successful save returns to review for the same selection.
    await selectForm(page, 'Administrative & Payment Request');
    await page.getByRole('button', { name: 'Edit route' }).click();
    await (await backup(page, 'Department Head Signature', 'Farhan Ali')).check();
    await page.getByRole('button', { name: 'Save route' }).click();
    await page.getByRole('heading', { name: 'Saved route' }).waitFor();
    assert.match(await page.getByRole('status').first().innerText(), /Signing route saved for .* Administrative & Payment Request/);
    assert.equal(await page.getByRole('combobox', { name: /^Form/ }).inputValue(), 'Administrative & Payment Request');
    const dbVersion = () => Number((db!.prepare('SELECT version FROM workflows WHERE company_id=? AND form_type=?').get('PEW', 'Administrative & Payment Request') as any).version);
    assert.equal(dbVersion(), 2);
    await shot(page, 'desktop-09-saved-review');

    // 9. Conflict between two admin sessions.
    const { context: second, page: other } = await open({ width: 1366, height: 900 });
    await selectForm(other, 'Administrative & Payment Request');
    await other.getByRole('button', { name: 'Edit route' }).click();
    await (await backup(other, 'Finance check', 'Fariha Khan')).check();
    await page.getByRole('button', { name: 'Edit route' }).click();
    await stepCard(page, 'Approver Signature').getByLabel('Suggested final approver').selectOption(people.sami);
    await page.getByRole('button', { name: 'Save route' }).click();
    await page.getByRole('heading', { name: 'Saved route' }).waitFor();
    assert.equal(dbVersion(), 3);
    await other.getByRole('button', { name: 'Save route' }).click();
    await other.getByRole('heading', { name: /Another administrator saved this route/ }).waitFor();
    assert.equal(dbVersion(), 3, 'no silent overwrite');
    assert.match(await other.locator('.route-conflict').innerText(), /Final approver changed from Sami Rahman to Fariha Khan/);
    assert.ok(await (await backup(other, 'Finance check', 'Fariha Khan')).isChecked(), 'local draft preserved');
    await shot(other, 'desktop-10-conflict');
    await other.getByRole('button', { name: 'Keep my draft and compare' }).click();
    assert.match(await summary(other).innerText(), /Final approver changed from Sami Rahman to Fariha Khan/);
    await stepCard(other, 'Approver Signature').getByLabel('Suggested final approver').selectOption(people.sami); // reconcile: keep the other admin's change
    const reconciled = await summary(other).innerText();
    assert.doesNotMatch(reconciled, /Final approver changed/);
    await other.getByRole('button', { name: 'Save route' }).click();
    await other.getByRole('heading', { name: 'Saved route' }).waitFor();
    assert.equal(dbVersion(), 4);
    const finalConfig = JSON.parse((db!.prepare('SELECT config FROM workflows WHERE company_id=? AND form_type=?').get('PEW', 'Administrative & Payment Request') as any).config);
    assert.equal(finalConfig.stages.at(-1).assignedUserId, people.sami, 'other admin change kept');
    assert.ok(finalConfig.stages.find((item: any) => item.id === 'finance').backupSignerIds.includes(people.fariha), 'reconciled draft change saved');
    findings.conflict = { versionsSeen: [2, 3, 3, 4], reconciledSummary: reconciled.split('\n').filter(Boolean) };
    await second.close();
    await desk.close();

    // 10. Phone: stacking order and touch reordering.
    const { context: phone, page: mobile } = await open({ width: 390, height: 844 }, true);
    await selectForm(mobile, 'Administrative & Payment Request');
    await mobile.getByRole('heading', { name: 'Saved route' }).waitFor();
    await shot(mobile, 'mobile-01-review');
    await mobile.getByRole('button', { name: 'Edit route' }).tap();
    await mobile.getByRole('button', { name: 'Move Finance check earlier' }).tap();
    assert.deepEqual(await mobile.locator('.route-rail-edit h3').allInnerTexts(), ['Finance check', 'Department Head Signature', 'Approver Signature']);
    const layout = await mobile.evaluate(() => {
      const top = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().top + scrollY;
      const save = [...document.querySelectorAll('button')].find(button => button.textContent === 'Save route')!;
      const box = (document.querySelector('.route-move-button') as HTMLElement).getBoundingClientRect();
      return { selectors: top('fieldset.workspace-panel'), route: top('.route-rail-edit'), summary: top('.route-summary'), save: save.getBoundingClientRect().top + scrollY,
        arrow: [Math.round(box.width), Math.round(box.height)], horizontalScroll: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(layout.selectors < layout.route && layout.route < layout.summary && layout.summary < layout.save, `phone order ${JSON.stringify(layout)}`);
    assert.equal(layout.horizontalScroll, false);
    assert.ok(layout.arrow[0] >= 44 && layout.arrow[1] >= 44, 'arrow targets at least 44px');
    findings.phone = layout;
    await shot(mobile, 'mobile-02-edit-after-touch-move');
    await mobile.locator('.route-summary').scrollIntoViewIfNeeded();
    await mobile.screenshot({ path: join(OUT, 'mobile-03-summary-above-save.png') });
    await phone.close();

    findings.pageErrors = errors;
    assert.deepEqual(errors, []);
    writeFileSync(join(OUT, 'findings.json'), JSON.stringify(findings, null, 2));
    console.log('ROUTES FINDINGS', JSON.stringify(findings));
  } finally {
    try { await browser?.close(); } catch {}
    try { if (server) await new Promise(resolve => server.close(resolve)); } catch {}
    try { db?.close(); } catch {}
    try { rmSync(tempDbPath, { force: true }); } catch {}
    try { rmSync(tempOutDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch(error => { console.error(error); process.exit(1); });
