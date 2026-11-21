import { createRequire } from 'node:module';
const require = createRequire('C:/Users/HP/Desktop/new-precisign/package.json');
const { chromium } = require('playwright-core');

const BASE_URL = process.env.APP_ORIGIN || 'http://localhost:3000';

const viewports = [
  { name: 'Mobile Compact (iPhone SE)', width: 375, height: 667 },
  { name: 'Mobile Standard (iPhone 14)', width: 390, height: 844 },
  { name: 'Tablet Portrait (iPad)', width: 768, height: 1024 },
  { name: 'Tablet Landscape (iPad)', width: 1024, height: 768 },
  { name: 'Desktop Standard (1080p)', width: 1440, height: 900 }
];

async function runAudit() {
  console.log('================================================================');
  console.log('Mobile Responsive Layout & Overflow Audit (Non-Destructive)');
  console.log(`Target: ${BASE_URL}`);
  console.log('================================================================\n');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  let failed = false;

  for (const vp of viewports) {
    console.log(`[Testing ${vp.name} (${vp.width}x${vp.height})]`);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
      const innerWidth = window.innerWidth;
      return {
        scrollWidth,
        innerWidth,
        overflowPixels: scrollWidth - innerWidth,
        hasOverflow: scrollWidth > innerWidth
      };
    });

    if (metrics.hasOverflow) {
      console.error(`  ❌ FAIL: Page has horizontal overflow of ${metrics.overflowPixels}px (scrollWidth: ${metrics.scrollWidth} > innerWidth: ${metrics.innerWidth})`);
      failed = true;
    } else {
      console.log(`  ✓ PASS: Zero horizontal overflow (scrollWidth: ${metrics.scrollWidth} <= innerWidth: ${metrics.innerWidth})`);
    }

    // Touch targets check on mobile viewports (< 768px)
    if (vp.width < 768) {
      const smallTargets = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button:not([hidden]), a:not([hidden])'));
        const subStandard = [];
        for (const b of buttons) {
          const rect = b.getBoundingClientRect();
          // Filter visible buttons that are substantially interactive
          if (rect.width > 0 && rect.height > 0 && (rect.width < 32 || rect.height < 32)) {
            const text = (b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 30);
            if (text) subStandard.push({ text, width: Math.round(rect.width), height: Math.round(rect.height) });
          }
        }
        return subStandard.slice(0, 5); // report first 5 if any
      });

      if (smallTargets.length > 0) {
        console.warn(`  ⚠️ Notice: Found ${smallTargets.length} compact clickable targets (<32px):`, smallTargets.map(t => `"${t.text}" (${t.width}x${t.height}px)`).join(', '));
      } else {
        console.log(`  ✓ Touch targets conform to mobile ergonomic boundaries`);
      }
    }
  }

  await browser.close();

  if (failed) {
    console.error('\nLayout audit FAILED: Unintended horizontal page overflow detected.');
    process.exit(1);
  } else {
    console.log('\n================================================================');
    console.log('ALL VIEWPORTS PASSED: Layout is responsive with zero page overflow.');
    console.log('================================================================\n');
  }
}

runAudit().catch(err => {
  console.error('[AUDIT ERROR]', err);
  process.exit(1);
});
