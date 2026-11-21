import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

async function main() {
  const dir = join(process.cwd(), 'scratch', 'test-fixtures');
  mkdirSync(dir, { recursive: true });

  const executablePath = process.env.PRECISIGN_PDF_CHROMIUM;
  const browser = await chromium.launch({
    executablePath,
    channel: !executablePath && !existsSync(chromium.executablePath()) && process.platform === 'win32' ? 'msedge' : undefined,
    headless: true,
  });

  const page = await browser.newPage();

  // 1. Angled JPEG (paper photographed at an angle)
  const angledDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext('2d')!;

    // Desk background
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(0, 0, 800, 600);

    // Angled paper (perspective trapezoid)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(120, 100); // top-left
    ctx.lineTo(680, 80);  // top-right
    ctx.lineTo(750, 520); // bottom-right
    ctx.lineTo(80, 500);  // bottom-left
    ctx.closePath();
    ctx.fillStyle = '#f8fafc';
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 15;
    ctx.fill();

    // Draw signature on paper
    ctx.restore();
    ctx.save();
    ctx.translate(400, 300);
    ctx.rotate(0.04);
    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    // Synthetic signature loops
    ctx.moveTo(-150, 20);
    ctx.bezierCurveTo(-120, -60, -80, -70, -60, 10);
    ctx.bezierCurveTo(-40, 60, -20, -30, 20, -10);
    ctx.bezierCurveTo(60, 10, 80, -50, 120, -20);
    ctx.lineTo(150, 0);
    ctx.stroke();

    // Cross-stroke
    ctx.beginPath();
    ctx.moveTo(-100, -10);
    ctx.lineTo(130, -5);
    ctx.stroke();
    ctx.restore();

    return canvas.toDataURL('image/jpeg', 0.9);
  });
  const angledBuf = Buffer.from(angledDataUrl.split(',')[1], 'base64');
  writeFileSync(join(dir, 'angled-signature.jpg'), angledBuf);

  // 2. Normal PNG
  const normalDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 200;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 600, 200);

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 3.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(80, 110);
    ctx.bezierCurveTo(110, 40, 150, 30, 180, 110);
    ctx.bezierCurveTo(200, 160, 230, 70, 270, 90);
    ctx.bezierCurveTo(310, 110, 350, 50, 400, 80);
    ctx.lineTo(480, 100);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(100, 80);
    ctx.lineTo(450, 85);
    ctx.stroke();

    return canvas.toDataURL('image/png');
  });
  const normalBuf = Buffer.from(normalDataUrl.split(',')[1], 'base64');
  writeFileSync(join(dir, 'normal-signature.png'), normalBuf);

  // 3. Ruled paper PNG (horizontal notebook lines across)
  const ruledDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 250;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fdfdfd';
    ctx.fillRect(0, 0, 600, 250);

    // Horizontal ruled lines
    ctx.strokeStyle = '#93c5fd'; // light blue notebook lines
    ctx.lineWidth = 1.5;
    for (let y = 40; y < 250; y += 45) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(600, y);
      ctx.stroke();
    }

    // Signature across ruled lines
    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(80, 140);
    ctx.bezierCurveTo(120, 60, 160, 50, 200, 130);
    ctx.bezierCurveTo(230, 180, 260, 90, 310, 120);
    ctx.bezierCurveTo(360, 140, 410, 70, 480, 110);
    ctx.stroke();

    return canvas.toDataURL('image/png');
  });
  const ruledBuf = Buffer.from(ruledDataUrl.split(',')[1], 'base64');
  writeFileSync(join(dir, 'ruled-paper-signature.png'), ruledBuf);

  // 4. Faint ink PNG (very light strokes)
  const faintDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 200;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 600, 200);

    ctx.strokeStyle = '#d1d5db'; // faint light gray pencil strokes (gray ~ 210)
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(80, 110);
    ctx.bezierCurveTo(120, 50, 180, 40, 220, 120);
    ctx.bezierCurveTo(250, 170, 290, 80, 350, 100);
    ctx.lineTo(460, 110);
    ctx.stroke();

    return canvas.toDataURL('image/png');
  });
  const faintBuf = Buffer.from(faintDataUrl.split(',')[1], 'base64');
  writeFileSync(join(dir, 'faint-ink-signature.png'), faintBuf);

  // 5. Blank paper PNG (no ink at all)
  const blankDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 200;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, 600, 200);
    return canvas.toDataURL('image/png');
  });
  const blankBuf = Buffer.from(blankDataUrl.split(',')[1], 'base64');
  writeFileSync(join(dir, 'blank-paper.png'), blankBuf);

  // 6. Oversized file (> 2 MiB, 2.5 MiB)
  // We can write a valid PNG buffer padded to 2.5MB
  const paddedBuf = Buffer.alloc(2.5 * 1024 * 1024);
  normalBuf.copy(paddedBuf, 0);
  writeFileSync(join(dir, 'oversized-2.5mb.png'), paddedBuf);

  // 7. Invalid/corrupt file
  writeFileSync(join(dir, 'corrupt-image.png'), Buffer.from('NOT_A_VALID_PNG_OR_IMAGE_CONTENT'));

  await browser.close();
  console.log(`[Fixtures] All 7 synthetic test images generated in ${dir}`);
}

main().catch(console.error);
