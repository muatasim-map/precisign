// Compares the legacy signature cleanup with the current one on identical synthetic phone-photo fixtures.
// Usage: node --import tsx scripts/signature-cleanup-eval.ts [--baseline-only]
// Writes PNG evidence and metrics.json to .artifacts/signature-qa/cleanup/.
import sharp from 'sharp';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fixtureSpecs, largeFixtureSpec, legacyCleanSignatureAlpha, renderFixture, scoreCleanup, type Fixture,
} from '../frontend/src/components/profile/signatureCleanup.fixtures';

const OUT = join(process.cwd(), '.artifacts', 'signature-qa', 'cleanup');
const baselineOnly = process.argv.includes('--baseline-only');
const LEGACY_INK = [24, 43, 69] as const;
const DARKNESS = 1.6;

async function jpegRoundTrip(fixture: Fixture, quality = 72): Promise<Fixture> {
  const { data } = await sharp(Buffer.from(fixture.rgba), { raw: { width: fixture.width, height: fixture.height, channels: 4 } })
    .jpeg({ quality, chromaSubsampling: '4:2:0' }).toBuffer().then(jpeg => sharp(jpeg).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  return { ...fixture, rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** Composite an alpha + colour result onto a white form background, like the signature box. */
function onWhite(alpha: Uint8ClampedArray, colorAt: (i: number) => readonly [number, number, number], width: number, height: number) {
  const out = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const a = alpha[i] / 255, c = colorAt(i);
    for (let k = 0; k < 3; k++) out[i * 3 + k] = Math.round(255 * (1 - a) + c[k] * a);
  }
  return sharp(out, { raw: { width, height, channels: 3 } }).png();
}

async function main() {
  mkdirSync(join(OUT, 'fixtures'), { recursive: true });
  mkdirSync(join(OUT, 'baseline'), { recursive: true });
  mkdirSync(join(OUT, 'after'), { recursive: true });
  mkdirSync(join(OUT, 'comparison'), { recursive: true });
  const current = baselineOnly ? undefined : await import('../frontend/src/components/profile/signatureImage');
  const report: Record<string, unknown> = { darkness: DARKNESS, generatedAt: new Date().toISOString(), fixtures: {} };
  for (const spec of [...fixtureSpecs, largeFixtureSpec]) {
    const fixture = await jpegRoundTrip(renderFixture(spec));
    const { width, height, rgba } = fixture;
    await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } }).png().toFile(join(OUT, 'fixtures', `${spec.name}.png`));
    await sharp(Buffer.from(rgba), { raw: { width, height, channels: 4 } }).jpeg({ quality: 72 }).toFile(join(OUT, 'fixtures', `${spec.name}.jpg`));
    const legacyStart = performance.now();
    const legacy = legacyCleanSignatureAlpha(rgba, width, height, DARKNESS);
    const legacyMs = performance.now() - legacyStart;
    await onWhite(legacy, () => LEGACY_INK, width, height).toFile(join(OUT, 'baseline', `${spec.name}.png`));
    const entry: Record<string, unknown> = { description: spec.description, legacy: { ...scoreCleanup(fixture, legacy), ms: +legacyMs.toFixed(1) } };
    if (current) {
      const analyzeStart = performance.now();
      const analysis = current.analyzeSignaturePixels(rgba, width, height);
      const analyzeMs = performance.now() - analyzeStart;
      const renderStart = performance.now();
      const alpha = analysis ? current.renderSignatureAlpha(analysis, DARKNESS) : new Uint8ClampedArray(width * height);
      const renderMs = performance.now() - renderStart;
      const color = analysis?.color ?? current.fallbackInkColor;
      await onWhite(alpha, () => color, width, height).toFile(join(OUT, 'after', `${spec.name}.png`));
      const sweep = analysis ? [0.6, 1, 1.6, 2.5, 4].map(d => {
        const a = current.renderSignatureAlpha(analysis, d);
        let sum = 0; for (const v of a) sum += v;
        return { darkness: d, meanAlpha: +(sum / a.length).toFixed(3) };
      }) : [];
      entry.after = {
        ...scoreCleanup(fixture, alpha), cleanedResult: !!analysis, ink: analysis?.inkKind ?? null, color,
        lines: analysis?.lines.map(l => ({ orientation: l.orientation, offset: +l.offset.toFixed(1), slope: +l.slope.toFixed(4), removed: l.removed, reason: l.reason })) ?? [],
        analyzeMs: +analyzeMs.toFixed(1), renderMs: +renderMs.toFixed(1), darknessSweep: sweep,
      };
    }
    if (current) {
      // Photo | before | after, stacked, for eyeballing.
      const label = (text: string) => Buffer.from(`<svg width="${width}" height="22"><rect width="100%" height="100%" fill="#e2e8f0"/><text x="6" y="16" font-family="Arial" font-size="14" fill="#0f172a">${text}</text></svg>`);
      const panels = [
        { text: `${spec.name}: photo input`, file: join(OUT, 'fixtures', `${spec.name}.png`) },
        { text: 'before (legacy cleanup)', file: join(OUT, 'baseline', `${spec.name}.png`) },
        { text: 'after (new cleanup)', file: join(OUT, 'after', `${spec.name}.png`) },
      ];
      const composite = panels.flatMap((panel, k) => [
        { input: label(panel.text), top: k * (height + 22), left: 0 },
        { input: panel.file, top: k * (height + 22) + 22, left: 0 },
      ]);
      await sharp({ create: { width, height: 3 * (height + 22), channels: 3, background: '#ffffff' } }).composite(composite).png().toFile(join(OUT, 'comparison', `${spec.name}.png`));
    }
    (report.fixtures as Record<string, unknown>)[spec.name] = entry;
    console.log(spec.name, JSON.stringify(entry));
  }
  writeFileSync(join(OUT, baselineOnly ? 'metrics.baseline.json' : 'metrics.json'), JSON.stringify(report, null, 2));
}

main().catch(error => { console.error(error); process.exit(1); });
