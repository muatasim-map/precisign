import { chromium } from 'playwright-core';
import path from 'node:path';

const base = process.env.VITE_URL || 'http://localhost:3000';
const outDir = 'C:/Users/HP/.gemini/antigravity/brain/9ac211da-967d-47b4-a57e-c70df96b53c7/qa-artifacts';

async function main() {
  const browser = await chromium.launch({
    channel: process.platform === 'win32' ? 'msedge' : undefined,
    headless: true
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);

  console.log('Logging in...');
  await page.goto(base + '/');
  await page.getByLabel('Email', { exact: true }).fill('anzar@test.com');
  await page.locator('input[type="password"]').first().fill('PreciSign-a0b1c52b19');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.preci-shell').waitFor({ timeout: 10000 });
  console.log('Logged in successfully!');

  console.log('Capturing after-it-request.png...');
  await page.goto(base + '/forms/it-request/new');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'after-it-request.png'), fullPage: true });

  console.log('Capturing after-admin-payment.png...');
  await page.goto(base + '/forms/admin-payment/new');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'after-admin-payment.png'), fullPage: true });

  console.log('Capturing after-cash-voucher.png...');
  await page.goto(base + '/forms/cash-voucher/new');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'after-cash-voucher.png'), fullPage: true });

  console.log('Capturing after-expense-claim.png...');
  await page.goto(base + '/forms/expense-claim/new');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'after-expense-claim.png'), fullPage: true });

  console.log('Capturing after-rnd.png...');
  await page.goto(base + '/forms/rnd/new');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'after-rnd.png'), fullPage: true });

  console.log('Capturing after-dashboard.png...');
  await page.goto(base + '/dashboard');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'after-dashboard.png'), fullPage: true });

  // Tablet responsiveness check (width 768px)
  console.log('Capturing tablet viewports...');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(base + '/forms/it-request/new');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'after-it-request-tablet.png'), fullPage: true });

  await page.goto(base + '/forms/admin-payment/new');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'after-admin-payment-tablet.png'), fullPage: true });

  await browser.close();
  console.log('All after screenshots captured successfully.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
