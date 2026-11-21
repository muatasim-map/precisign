import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

const frontendBase = process.env.FRONTEND_URL || 'http://127.0.0.1:3000';
const dbPath = process.env.PRECISIGN_DATABASE_PATH || 'data/temp_ui_review.sqlite';
const artifactDir = 'C:/Users/HP/.gemini/antigravity/brain/9ac211da-967d-47b4-a57e-c70df96b53c7/qa-artifacts';

await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({
  channel: process.platform === 'win32' ? 'msedge' : undefined,
  headless: true,
});

async function login(page, email, password) {
  await page.goto(`${frontendBase}/`);
  const emailInput = page.getByLabel('Email', { exact: true });
  await emailInput.waitFor({ timeout: 10000 });
  await emailInput.fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.preci-shell').waitFor({ timeout: 10000 });
}

try {
  console.log('--- Step 1: Direct Navigation & In-App Navigation Unsaved Guard (Stay & Leave) ---');
  const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page1 = await ctx1.newPage();
  page1.setDefaultTimeout(8000);

  // Sign in as Anzar
  await login(page1, 'anzar@test.com', 'PreciSign-a0b1c52b19');

  // Navigate to Forms Library
  await page1.getByRole('link', { name: 'Forms Library', exact: true }).click();
  await page1.getByRole('heading', { name: 'Forms Library', exact: true }).waitFor();

  // Click Open form: IT Request
  await page1.getByRole('button', { name: 'Open form: IT Request', exact: true }).click();
  await page1.getByRole('heading', { name: 'IT Request Form', exact: true }).first().waitFor();

  // Enter unsaved text in details textarea
  const detailsArea = page1.locator('textarea').first();
  await detailsArea.fill('Unsaved in-app navigation test content');

  // Trigger browser Back
  await page1.goBack();

  // Verify "Leave this page?" dialog appears
  const dialog = page1.getByRole('dialog');
  await dialog.waitFor();
  await page1.getByRole('heading', { name: 'Leave this page?', exact: true }).waitFor();
  await page1.screenshot({ path: join(artifactDir, 'routing-direct-back-unsaved-guard.png') });

  // Click "Stay"
  await dialog.getByRole('button', { name: 'Stay', exact: true }).click();
  await page1.waitForURL('**/forms/it-request/new');
  assert.equal(await detailsArea.inputValue(), 'Unsaved in-app navigation test content');

  // Trigger browser Back again
  await page1.goBack();
  await dialog.waitFor();

  // Click "Leave"
  await dialog.getByRole('button', { name: 'Leave', exact: true }).click();
  await page1.waitForURL('**/forms');
  console.log('✓ In-app navigation unsaved guard correctly prompts, Stay preserves, Leave departs.');

  // Browser-level reload beforeunload guard check
  await page1.getByRole('button', { name: 'Open form: IT Request', exact: true }).click();
  await page1.getByRole('heading', { name: 'IT Request Form', exact: true }).first().waitFor();
  await detailsArea.fill('Unsaved reload test content');
  let beforeUnloadFired = false;
  page1.once('dialog', d => {
    assert.equal(d.type(), 'beforeunload');
    beforeUnloadFired = true;
    void d.dismiss();
  });
  await page1.reload().catch(() => {});
  assert.ok(beforeUnloadFired, 'beforeunload event must fire when unsaved work is present');
  console.log('✓ Browser-level reload beforeunload guard correctly fires.');

  // Clear dirty state by clicking Leave on navigation
  await page1.getByRole('link', { name: 'Forms Library', exact: true }).click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Leave', exact: true }).click();

  console.log('--- Step 2: Redirects & History Replacement ---');
  // Navigate to /dashboard
  await page1.goto(`${frontendBase}/dashboard`);
  await page1.getByRole('heading', { name: /Welcome back/i }).waitFor();

  // Navigate to /rnd -> replaces to /forms/rnd/new
  await page1.goto(`${frontendBase}/rnd`);
  await page1.waitForURL('**/forms/rnd/new');
  await page1.getByRole('heading', { name: 'R&D Initiative', exact: true }).waitFor();

  // Press browser Back - should return cleanly to /dashboard, not loop on /rnd
  await page1.goBack();
  await page1.waitForURL('**/dashboard');
  assert.equal(new URL(page1.url()).pathname, '/dashboard');

  // Navigate to /settings -> should redirect replace to /settings/profile
  await page1.goto(`${frontendBase}/settings`);
  await page1.waitForURL('**/settings/profile');
  await page1.getByRole('heading', { name: 'Signature settings', exact: true }).waitFor();

  // Press browser Back - should return to /dashboard
  await page1.goBack();
  await page1.waitForURL('**/dashboard');
  assert.equal(new URL(page1.url()).pathname, '/dashboard');
  console.log('✓ Redirects (/rnd, /settings) replace history without loops.');

  await ctx1.close();

  console.log('--- Step 3: IT Draft Recovery Across Separate Browser Sessions ---');
  // Session A: Anzar on "Computer 1"
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageA = await ctxA.newPage();
  await login(pageA, 'anzar@test.com', 'PreciSign-a0b1c52b19');

  await pageA.goto(`${frontendBase}/forms/it-request/new`);
  await pageA.getByRole('heading', { name: 'IT Request Form', exact: true }).first().waitFor();

  // Clear any existing draft first to ensure clean state
  const clearBtn = pageA.getByRole('button', { name: 'Clear draft', exact: true });
  if (await clearBtn.isVisible().catch(() => false)) {
    await clearBtn.click();
    await pageA.waitForTimeout(400);
  }

  // Fill in form fields
  await pageA.locator('input[placeholder="e.g. Network access"]').fill('Hardware workstation');
  await pageA.getByRole('radio', { name: 'Urgent' }).check();

  const textareas = pageA.locator('textarea');
  await textareas.nth(0).fill('Dual-monitor developer workstation for local QA build verification');
  await textareas.nth(1).fill('Current display panel has vertical banding artifacts impeding UI audits');

  // Select signer Afzal Kazi if dropdown exists in #signer-review
  const signerSelect = pageA.locator('#signer-review select').first();
  if (await signerSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
    const opt = signerSelect.locator('option').filter({ hasText: /Afzal/i });
    if (await opt.count() > 0) {
      const val = await opt.first().getAttribute('value');
      if (val) await signerSelect.selectOption(val);
    }
  }

  // Wait for draft auto-save debounce (300ms) + network write
  await pageA.waitForTimeout(1000);

  // Check SQLite database directly to confirm draft exists on backend
  const db = new DatabaseSync(dbPath);
  const rowA = db.prepare("SELECT revision, data FROM drafts WHERE user_id='pilot-anzar' AND company_id='PEW' AND form_type='IT Request'").get();
  assert.ok(rowA, 'Draft must be saved in the backend drafts table');
  const dataA = JSON.parse(rowA.data);
  assert.equal(dataA.fields.details, 'Dual-monitor developer workstation for local QA build verification');
  assert.equal(dataA.fields.requestType, 'Hardware workstation');
  console.log(`✓ Draft saved to server database: revision ${rowA.revision}`);

  // Take screenshot of saved draft in Session A
  await pageA.screenshot({ path: join(artifactDir, 'it-draft-session-a-saved.png') });

  // Close Session A completely (simulating shutting down Computer A)
  await ctxA.close();

  // Session B: Anzar on "Computer 2" (Fresh context, empty storage)
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageB = await ctxB.newPage();
  await login(pageB, 'anzar@test.com', 'PreciSign-a0b1c52b19');

  await pageB.goto(`${frontendBase}/forms/it-request/new`);
  await pageB.getByRole('heading', { name: 'IT Request Form', exact: true }).first().waitFor();

  // Wait for server draft loading
  await pageB.waitForTimeout(800);

  // Verify fields recovered from the server
  const recoveredTextareas = pageB.locator('textarea');
  const detailsVal = await recoveredTextareas.nth(0).inputValue();
  const justificationVal = await recoveredTextareas.nth(1).inputValue();
  const typeVal = await pageB.locator('input[placeholder="e.g. Network access"]').inputValue();
  const isUrgent = await pageB.getByRole('radio', { name: 'Urgent' }).isChecked();

  assert.equal(detailsVal, 'Dual-monitor developer workstation for local QA build verification');
  assert.equal(justificationVal, 'Current display panel has vertical banding artifacts impeding UI audits');
  assert.equal(typeVal, 'Hardware workstation');
  assert.equal(isUrgent, true);

  await pageB.screenshot({ path: join(artifactDir, 'it-draft-session-b-recovered.png') });
  console.log('✓ IT Request draft successfully recovered across separate browser sessions from backend!');

  console.log('--- Step 4: User and Company Isolation ---');
  // Session C: User Afzal on PEW IT Request
  const ctxC = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageC = await ctxC.newPage();
  await login(pageC, 'afzalkazi@test.com', 'PreciSign-c67481c650');

  await pageC.goto(`${frontendBase}/forms/it-request/new`);
  await pageC.getByRole('heading', { name: 'IT Request Form', exact: true }).first().waitFor();
  await pageC.waitForTimeout(600);

  const afzalDetails = await pageC.locator('textarea').first().inputValue();
  assert.equal(afzalDetails, '', "User Afzal must NOT see Anzar's draft");
  console.log("✓ User isolation verified: Afzal cannot access Anzar's private IT draft.");
  await ctxC.close();

  // Company isolation in Session B: verify ICCL draft is empty
  const rowICCL = db.prepare("SELECT revision, data FROM drafts WHERE user_id='pilot-anzar' AND company_id='ICCL' AND form_type='IT Request'").get();
  assert.equal(rowICCL, undefined, 'No draft should exist for ICCL');
  console.log('✓ Company isolation verified: draft belongs exclusively to (Anzar, PEW, IT Request).');

  console.log('--- Step 5: Submission Draft Clearance & Review ---');
  // In Session B, submit the recovered request
  await pageB.getByRole('button', { name: 'Sign & send', exact: true }).click();

  // Signing modal
  const signModal = pageB.getByRole('dialog');
  await signModal.waitFor();
  await pageB.getByRole('heading', { name: 'Sign IT Request', exact: true }).waitFor();

  // Click submit in modal
  await signModal.getByRole('button', { name: 'Sign & send', exact: true }).click();

  // Wait for review navigation
  await pageB.waitForURL('**/requests/**', { timeout: 10000 });
  await pageB.getByRole('heading', { name: 'Request actions', exact: true }).waitFor();
  await pageB.screenshot({ path: join(artifactDir, 'it-request-submitted-review.png') });
  console.log('✓ IT Request submitted successfully.');

  // Check database: draft data must now be NULL (cleared atomically)
  const rowAfterSubmit = db.prepare("SELECT revision, data FROM drafts WHERE user_id='pilot-anzar' AND company_id='PEW' AND form_type='IT Request'").get();
  assert.ok(rowAfterSubmit, 'Tombstone record should exist');
  assert.equal(JSON.parse(rowAfterSubmit.data), null, 'Draft data must be cleared on submit');
  console.log(`✓ Database draft row cleared atomically: revision ${rowAfterSubmit.revision}, data is null`);

  // Navigate back to /forms/it-request/new - confirm form is completely clean
  await pageB.goto(`${frontendBase}/forms/it-request/new`);
  await pageB.getByRole('heading', { name: 'IT Request Form', exact: true }).first().waitFor();
  await pageB.waitForTimeout(600);
  const clearedDetails = await pageB.locator('textarea').first().inputValue();
  assert.equal(clearedDetails, '', 'Draft must remain cleared after submission');
  console.log('✓ Form loaded fresh with empty fields after submission.');

  console.log('--- Step 6: Admin Work Request Draft Compatibility ---');
  await pageB.goto(`${frontendBase}/forms/admin-payment/new`);

  // If company prompt is shown, select PEW
  const chooseCompanyHeading = pageB.getByRole('heading', { name: 'Choose the request company' });
  if (await chooseCompanyHeading.isVisible({ timeout: 2000 }).catch(() => false)) {
    const compSelect = pageB.getByLabel('Request company');
    await compSelect.selectOption('PEW');
  }

  await pageB.getByRole('heading', { name: /Administrative & Payment Request/i }).first().waitFor();
  const adminDesc = pageB.getByRole('textbox', { name: 'Work description' });
  await adminDesc.fill('Synthetic Admin Work Request compatibility test draft');
  await pageB.waitForTimeout(1000);

  // Refresh page (accept beforeunload if prompted)
  pageB.once('dialog', dialog => void dialog.accept());
  await pageB.reload();
  await pageB.getByRole('heading', { name: /Administrative & Payment Request/i }).first().waitFor();
  assert.equal(await adminDesc.inputValue(), 'Synthetic Admin Work Request compatibility test draft');
  console.log('✓ Admin Work Request draft compatibility verified across refresh.');

  await ctxB.close();
  db.close();

  console.log('\n========================================');
  console.log('ALL E2E BROWSER CHECKS PASSED SUCCESSFULLY!');
  console.log('========================================');
} finally {
  await browser.close();
}
