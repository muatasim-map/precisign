import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import {
  analyzeSignaturePixels, defaultInkDarkness, renderSignatureAlpha, signatureBounds, type SignatureAnalysis,
} from './signatureImage';
import {
  fixtureSpecs, largeFixtureSpec, legacyCleanSignatureAlpha, renderFixture, scoreCleanup, type Fixture,
} from './signatureCleanup.fixtures';

// Every fixture goes through a real JPEG encode/decode, like a phone photo upload.
async function photo(name: string): Promise<Fixture> {
  const spec = [...fixtureSpecs, largeFixtureSpec].find(item => item.name === name);
  assert.ok(spec, `unknown fixture ${name}`);
  const fixture = renderFixture(spec);
  const { data } = await sharp(Buffer.from(fixture.rgba), { raw: { width: fixture.width, height: fixture.height, channels: 4 } })
    .jpeg({ quality: 72 }).toBuffer()
    .then(jpeg => sharp(jpeg).ensureAlpha().raw().toBuffer({ resolveWithObject: true }));
  return { ...fixture, rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

function run(fixture: Fixture) {
  const analysis = analyzeSignaturePixels(fixture.rgba, fixture.width, fixture.height);
  const alpha = analysis ? renderSignatureAlpha(analysis, defaultInkDarkness) : new Uint8ClampedArray(fixture.width * fixture.height);
  const legacy = legacyCleanSignatureAlpha(fixture.rgba, fixture.width, fixture.height, defaultInkDarkness);
  return { analysis, after: scoreCleanup(fixture, alpha), before: scoreCleanup(fixture, legacy), alpha };
}

const inkFixtures = fixtureSpecs.filter(spec => spec.ink).map(spec => spec.name);

test('keeps signature ink and removes paper texture on every photo fixture', async () => {
  for (const name of inkFixtures) {
    const { analysis, after } = run(await photo(name));
    assert.ok(analysis, `${name}: cleaned result expected`);
    assert.ok(after.inkVisible >= 0.98, `${name}: ink kept ${after.inkVisible}`);
    assert.ok(after.paperLeak <= 0.002, `${name}: paper leak ${after.paperLeak}`);
    assert.ok(after.specks <= 1, `${name}: specks ${after.specks}`);
    assert.ok(after.softEdgeShare > 0.2, `${name}: edges should be anti-aliased, got ${after.softEdgeShare}`);
  }
});

test('faint and dark ink crossing a ruled line is kept (legacy erased faint crossings)', async () => {
  for (const name of ['faint-crossing', 'dark-crossing', 'pencil-gray-rules', 'small-low-res']) {
    const { after, before } = run(await photo(name));
    assert.ok(after.crossingVisible >= 0.95, `${name}: crossing kept ${after.crossingVisible}`);
    assert.ok(after.crossingVisible >= before.crossingVisible, `${name}: no regression vs legacy`);
  }
  const faint = run(await photo('faint-crossing'));
  assert.ok(faint.before.crossingVisible < 0.1, 'baseline reproduces the erased faint crossing');
});

test('removes more ruled-line pixels than the legacy row-coverage filter', async () => {
  for (const name of ['blue-rules', 'gray-rules', 'slanted-rules', 'grid-paper', 'notebook-margin', 'yellow-legal-pad', 'large-720']) {
    const { after, before } = run(await photo(name));
    assert.ok(after.ruleResidue <= 0.01, `${name}: rule residue ${after.ruleResidue}`);
    assert.ok(after.ruleResidue <= before.ruleResidue, `${name}: no more residue than legacy`);
  }
  const slanted = run(await photo('slanted-rules'));
  assert.ok(slanted.before.ruleResidue > 0.5, 'baseline reproduces slanted rules left behind');
});

test('uneven lighting: shadows do not become ink and shadowed strokes are not lost', async () => {
  const side = run(await photo('shadow-side'));
  assert.ok(side.before.inkVisible < 0.7, 'baseline loses ink under a side shadow');
  assert.ok(side.after.inkVisible >= 0.99);
  const hard = run(await photo('shadow-hard'));
  assert.ok(hard.before.paperLeak > 0.2, 'baseline turns a hard shadow into ink');
  assert.ok(hard.after.paperLeak <= 0.001);
});

test('a genuine signature underline is kept, on plain and ruled paper', async () => {
  for (const name of ['underline-clean', 'underline-ruled']) {
    const fixture = await photo(name);
    const { analysis, alpha } = run(fixture);
    assert.ok(analysis);
    // Underline ground truth: core ink below the signature body.
    let core = 0, visible = 0;
    for (let y = Math.round(fixture.height * 0.78); y < fixture.height; y++) for (let x = 0; x < fixture.width; x++) {
      const i = y * fixture.width + x;
      if (fixture.ink[i] >= 0.7) { core++; if (alpha[i] >= 64) visible++; }
    }
    assert.ok(core > 500, `${name}: fixture has an underline`);
    assert.ok(visible / core >= 0.98, `${name}: underline kept ${visible / core}`);
  }
});

test('blank paper, with or without rules or shadow, has no cleaned result', async () => {
  for (const name of ['blank-paper', 'blank-ruled']) assert.equal(run(await photo(name)).analysis, null, name);
  const transparent = new Uint8ClampedArray(200 * 80 * 4);
  assert.equal(analyzeSignaturePixels(transparent, 200, 80), null, 'fully transparent crop');
});

test('ink colour follows the pen: blue stays blue, black stays neutral', async () => {
  for (const name of ['blue-rules', 'shadow-side', 'yellow-legal-pad', 'faint-crossing']) assert.equal(run(await photo(name)).analysis?.inkKind, 'blue', name);
  for (const name of ['clean-white', 'gray-rules', 'thick-marker']) assert.equal(run(await photo(name)).analysis?.inkKind, 'black', name);
});

function meanAlpha(analysis: SignatureAnalysis, darkness: number, mask?: (x: number) => boolean) {
  const alpha = renderSignatureAlpha(analysis, darkness);
  let sum = 0, count = 0;
  for (let i = 0; i < alpha.length; i++) if (analysis.strength[i] > analysis.floor && (!mask || mask(i % analysis.width))) { sum += alpha[i]; count++; }
  return sum / Math.max(1, count);
}

test('Ink darkness is monotonic and acts the same on both sides of a shadowed photo', async () => {
  const fixture = await photo('shadow-side');
  const { analysis } = run(fixture);
  assert.ok(analysis);
  let previous = -1;
  for (let darkness = 0.6; darkness <= 4.0001; darkness += 0.1) {
    const value = meanAlpha(analysis, darkness);
    assert.ok(value >= previous, `darkness ${darkness.toFixed(1)} should not lighten (${value} < ${previous})`);
    previous = value;
  }
  // Ink in the bright left third and shadowed right third should respond alike.
  for (const darkness of [0.8, defaultInkDarkness, 3]) {
    const left = meanAlpha(analysis, darkness, x => x < fixture.width / 3);
    const right = meanAlpha(analysis, darkness, x => x > (fixture.width * 2) / 3);
    assert.ok(Math.abs(left - right) / 255 < 0.15, `darkness ${darkness}: left ${left} vs right ${right}`);
  }
});

test('near the size limit the slider re-render stays fast because analysis is reused', async () => {
  const fixture = await photo('large-720');
  const started = performance.now();
  const analysis = analyzeSignaturePixels(fixture.rgba, fixture.width, fixture.height);
  const analyzeMs = performance.now() - started;
  assert.ok(analysis);
  let slowest = 0;
  for (let darkness = 0.6; darkness <= 4.0001; darkness += 0.2) {
    const t = performance.now();
    renderSignatureAlpha(analysis, darkness);
    slowest = Math.max(slowest, performance.now() - t);
  }
  assert.ok(analyzeMs < 3000, `analysis ${analyzeMs}ms`);
  assert.ok(slowest < 60, `slider re-render ${slowest}ms`);
});

test('bounds trim to visible ink only (proportional fit unchanged)', () => {
  const alpha = new Uint8ClampedArray(10 * 6);
  alpha[2 * 10 + 3] = 200; alpha[4 * 10 + 7] = 7; alpha[1 * 10 + 1] = 5;
  assert.deepEqual(signatureBounds(alpha, 10, 6), { left: 3, top: 2, right: 7, bottom: 4 });
  assert.equal(signatureBounds(new Uint8ClampedArray(60), 10, 6), null);
});

test('crop editor keeps Original crop, the fallback tip and a single Ink darkness slider', () => {
  const source = readFileSync(new URL('./SignatureCropEditor.tsx', import.meta.url), 'utf8');
  assert.match(source, /label: 'Original crop'/);
  assert.match(source, /If part of your signature is missing, choose <strong>Original crop<\/strong>\./);
  assert.equal(source.match(/type="range"/g)?.length, 1);
  assert.match(source, /No ink detected/);
});
