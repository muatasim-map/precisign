// Test-only synthetic "phone photo" fixtures for signature cleanup. Not imported by the app.
// Every fixture keeps its ground-truth layers (ink coverage, rule mask) so cleanup can be scored exactly.

export type Rgb = readonly [number, number, number];
export type RuleSpec = { offset: number; slope: number; thickness: number; transmit: Rgb; vertical?: boolean };
export type FixtureSpec = {
  name: string;
  description: string;
  width: number;
  height: number;
  ink?: { transmit: Rgb; opacity: number; width: number };
  underline?: boolean;
  rules?: RuleSpec[];
  paper?: Rgb;
  shadow?: 'none' | 'side' | 'hard';
  noise?: number;
  seed?: number;
};
export type Fixture = {
  spec: FixtureSpec;
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  /** Ink coverage 0..1 per pixel (ground truth). */
  ink: Float32Array;
  /** Rule coverage 0..1 per pixel (ground truth). */
  rule: Float32Array;
};

export const BLUE_PEN: Rgb = [0.22, 0.3, 0.66];
export const BLACK_PEN: Rgb = [0.13, 0.13, 0.15];
const LIGHT_BLUE_RULE: Rgb = [0.6, 0.79, 0.99];
const GRAY_RULE: Rgb = [0.68, 0.68, 0.7];
const RED_MARGIN: Rgb = [0.95, 0.55, 0.58];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number) {
  const u = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

function ruledLines(height: number, spacing: number, first: number, slope: number, thickness: number, transmit: Rgb) {
  const lines: RuleSpec[] = [];
  for (let y = first; y < height + Math.abs(slope) * 2000; y += spacing) lines.push({ offset: y, slope, thickness, transmit });
  return lines;
}

/** A cursive-like synthetic signature with pressure variation, as centre-line samples. */
function signaturePath(width: number, height: number, underline: boolean, weight = 1) {
  const points: { x: number; y: number; r: number }[] = [];
  const left = width * 0.1, span = width * 0.8, mid = height * 0.5, amp = height * 0.24;
  const steps = 5200;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = left + span * t + width * 0.035 * Math.sin(2 * Math.PI * 8.5 * t);
    const y = mid - amp * Math.sin(2 * Math.PI * 4.25 * t) * (0.55 + 0.45 * Math.sin(Math.PI * t)) + height * 0.06 * Math.cos(2 * Math.PI * 1.3 * t);
    const r = weight * (width / 640) * (1.1 + 0.9 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.6));
    points.push({ x, y, r });
  }
  // An i-dot.
  for (let i = 0; i < 30; i++) points.push({ x: left + span * 0.62, y: mid - amp * 1.25, r: (width / 640) * 2.1 });
  if (underline) {
    const y0 = mid + amp * 1.32;
    for (let i = 0; i <= 2400; i++) {
      const t = i / 2400;
      points.push({ x: left + span * (0.02 + 0.95 * t), y: y0 + height * 0.015 * Math.sin(Math.PI * t), r: (width / 640) * (1.0 + 0.5 * Math.sin(Math.PI * t)) });
    }
  }
  return points;
}

function stampInk(coverage: Float32Array, width: number, height: number, points: { x: number; y: number; r: number }[]) {
  for (const { x, y, r } of points) {
    const reach = Math.ceil(r + 1);
    for (let py = Math.max(0, Math.floor(y - reach)); py <= Math.min(height - 1, Math.ceil(y + reach)); py++) {
      for (let px = Math.max(0, Math.floor(x - reach)); px <= Math.min(width - 1, Math.ceil(x + reach)); px++) {
        const c = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(px - x, py - y)));
        const i = py * width + px;
        if (c > coverage[i]) coverage[i] = c;
      }
    }
  }
}

export function renderFixture(spec: FixtureSpec): Fixture {
  const { width, height } = spec;
  const random = mulberry32(spec.seed ?? 7);
  const ink = new Float32Array(width * height);
  const rule = new Float32Array(width * height);
  const ruleTransmit = new Float32Array(width * height * 3).fill(1);
  if (spec.ink) stampInk(ink, width, height, signaturePath(width, height, !!spec.underline, spec.ink.width));
  for (const line of spec.rules ?? []) {
    const half = line.thickness / 2;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const along = line.vertical ? y : x, across = line.vertical ? x : y;
        const c = Math.min(1, Math.max(0, half + 0.5 - Math.abs(across - (line.offset + line.slope * along))));
        if (c <= 0) continue;
        const i = y * width + x;
        rule[i] = Math.max(rule[i], c);
        for (let k = 0; k < 3; k++) ruleTransmit[i * 3 + k] *= 1 - c * (1 - line.transmit[k]);
      }
    }
  }
  const paper = spec.paper ?? [246, 243, 236];
  const rgba = new Uint8ClampedArray(width * height * 4);
  const lowFreq = Array.from({ length: 6 }, () => ({ fx: random() * 0.04, fy: random() * 0.04, phase: random() * 6.28 }));
  const light = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const u = x / width, v = y / height;
      let l = 1 - 0.08 * ((u - 0.5) ** 2 + (v - 0.5) ** 2) * 2; // mild vignette
      if (spec.shadow === 'side') l *= 1 - 0.5 * Math.min(1, Math.max(0, (u - 0.25) / 0.75)) ** 1.2;
      if (spec.shadow === 'hard') l *= u + 0.18 * v > 0.62 ? 0.62 : 1; // sharp phone shadow edge
      light[y * width + x] = l;
    }
  }
  const sigma = spec.noise ?? 3.2;
  const raw = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let grain = 0;
      for (const wave of lowFreq) grain += Math.sin(x * wave.fx * 6.28 + y * wave.fy * 6.28 + wave.phase);
      grain = grain * 0.6 + gaussian(random) * 1.1; // paper fibre texture
      const inkT = spec.ink ? spec.ink.transmit : [1, 1, 1];
      const a = ink[i] * (spec.ink?.opacity ?? 0);
      for (let k = 0; k < 3; k++) {
        const t = (1 - a * (1 - inkT[k])) * ruleTransmit[i * 3 + k];
        raw[i * 3 + k] = (paper[k] + grain) * light[i] * t;
      }
    }
  }
  // Slight optical blur, then sensor noise (as a phone camera would add).
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      for (let k = 0; k < 3; k++) {
        let sum = 0, weight = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = Math.min(width - 1, Math.max(0, x + dx)), yy = Math.min(height - 1, Math.max(0, y + dy));
          const w = (dx ? 1 : 2) * (dy ? 1 : 2);
          sum += raw[(yy * width + xx) * 3 + k] * w; weight += w;
        }
        rgba[i * 4 + k] = sum / weight + gaussian(random) * sigma;
      }
      rgba[i * 4 + 3] = 255;
    }
  }
  return { spec, width, height, rgba, ink, rule };
}

export const fixtureSpecs: FixtureSpec[] = [
  { name: 'clean-white', description: 'Black pen on clean white paper', width: 640, height: 240, ink: { transmit: BLACK_PEN, opacity: 0.95, width: 1 } },
  { name: 'shadow-side', description: 'Blue pen; lighting falls to 50% across the photo', width: 640, height: 240, ink: { transmit: BLUE_PEN, opacity: 0.8, width: 1 }, shadow: 'side' },
  { name: 'shadow-hard', description: 'Blue pen; sharp phone shadow over the lower right', width: 640, height: 240, ink: { transmit: BLUE_PEN, opacity: 0.85, width: 1 }, shadow: 'hard' },
  { name: 'blue-rules', description: 'Blue pen on light-blue ruled notebook paper', width: 640, height: 240, ink: { transmit: BLUE_PEN, opacity: 0.9, width: 1 }, rules: ruledLines(240, 34, 22, 0, 2.2, LIGHT_BLUE_RULE) },
  { name: 'gray-rules', description: 'Black pen on gray ruled paper', width: 640, height: 240, ink: { transmit: BLACK_PEN, opacity: 0.9, width: 1 }, rules: ruledLines(240, 30, 18, 0, 2, GRAY_RULE) },
  { name: 'slanted-rules', description: 'Blue pen; blue rules slanted about 2 degrees (rotated photo)', width: 640, height: 240, ink: { transmit: BLUE_PEN, opacity: 0.9, width: 1 }, rules: ruledLines(240, 34, 4, 0.035, 2.2, LIGHT_BLUE_RULE) },
  { name: 'faint-crossing', description: 'Faint blue ink crossing light-blue rules', width: 640, height: 240, ink: { transmit: BLUE_PEN, opacity: 0.38, width: 1 }, rules: ruledLines(240, 34, 22, 0, 2.2, LIGHT_BLUE_RULE) },
  { name: 'dark-crossing', description: 'Dark black ink crossing darker gray rules', width: 640, height: 240, ink: { transmit: BLACK_PEN, opacity: 1, width: 1 }, rules: ruledLines(240, 30, 18, 0, 2.6, [0.5, 0.5, 0.52]) },
  { name: 'underline-clean', description: 'Black pen signature with a genuine underline, plain paper', width: 640, height: 240, ink: { transmit: BLACK_PEN, opacity: 0.95, width: 1 }, underline: true },
  { name: 'underline-ruled', description: 'Blue pen signature with underline on blue ruled paper', width: 640, height: 240, ink: { transmit: BLUE_PEN, opacity: 0.9, width: 1 }, underline: true, rules: ruledLines(240, 34, 22, 0, 2.2, LIGHT_BLUE_RULE) },
  { name: 'notebook-margin', description: 'Blue pen; blue rules plus a red vertical margin line', width: 640, height: 240, ink: { transmit: BLUE_PEN, opacity: 0.9, width: 1 }, rules: [...ruledLines(240, 34, 22, 0, 2.2, LIGHT_BLUE_RULE), { offset: 40, slope: 0, thickness: 2.4, transmit: RED_MARGIN, vertical: true }] },
  { name: 'grid-paper', description: 'Blue pen on light-blue grid paper (rules in both directions)', width: 640, height: 240, ink: { transmit: BLUE_PEN, opacity: 0.9, width: 1 }, rules: [...ruledLines(240, 24, 10, 0, 1.6, LIGHT_BLUE_RULE), ...ruledLines(640, 24, 14, 0, 1.6, LIGHT_BLUE_RULE).map(r => ({ ...r, vertical: true }))] },
  { name: 'yellow-legal-pad', description: 'Blue pen on a yellow legal pad with blue rules and red margin', width: 640, height: 240, paper: [250, 238, 160], ink: { transmit: BLUE_PEN, opacity: 0.9, width: 1 }, rules: [...ruledLines(240, 32, 20, 0, 2, [0.55, 0.72, 0.95]), { offset: 52, slope: 0, thickness: 2.4, transmit: RED_MARGIN, vertical: true }] },
  { name: 'pencil-gray-rules', description: 'Gray pencil-like stroke on gray rules (same colour family, conservative case)', width: 640, height: 240, ink: { transmit: [0.5, 0.5, 0.52], opacity: 0.85, width: 1 }, rules: ruledLines(240, 30, 18, 0, 2, GRAY_RULE) },
  { name: 'thick-marker', description: 'Thick black marker signature', width: 640, height: 240, ink: { transmit: BLACK_PEN, opacity: 1, width: 3.2 } },
  { name: 'small-low-res', description: 'Small, noisy crop (320x120) of a blue pen signature on rules', width: 320, height: 120, noise: 5, ink: { transmit: BLUE_PEN, opacity: 0.85, width: 1.4 }, rules: ruledLines(120, 18, 8, 0, 1.4, LIGHT_BLUE_RULE) },
  { name: 'blank-paper', description: 'Blank paper with side shadow and noise', width: 640, height: 240, shadow: 'side' },
  { name: 'blank-ruled', description: 'Blank blue ruled paper, no ink', width: 640, height: 240, rules: ruledLines(240, 34, 22, 0, 2.2, LIGHT_BLUE_RULE) },
];

export const largeFixtureSpec: FixtureSpec = {
  name: 'large-720', description: 'Near the 720px rectified crop limit: blue pen on ruled paper with side shadow',
  width: 720, height: 540, ink: { transmit: BLUE_PEN, opacity: 0.85, width: 1 }, shadow: 'side', rules: ruledLines(540, 38, 20, 0.01, 2.4, LIGHT_BLUE_RULE),
};

/** Verbatim pixel logic of the cleanup filter that shipped before this change (baseline). */
export function legacyCleanSignatureAlpha(rgba: Uint8ClampedArray, width: number, height: number, darkness: number) {
  const covered = new Uint32Array(height);
  const threshold = 235;
  for (let i = 0; i < rgba.length; i += 4) {
    const gray = rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
    if (gray < threshold && rgba[i + 3] > 64) covered[Math.floor(i / (width * 4))]++;
  }
  const alpha = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const gray = rgba[i] * 0.299 + rgba[i + 1] * 0.587 + rgba[i + 2] * 0.114;
      const likelyRule = covered[y] > width * 0.72 && gray > 110;
      alpha[y * width + x] = likelyRule ? 0 : Math.round(Math.min(1, Math.max(0, (threshold - gray) * darkness / 155)) * rgba[i + 3]);
    }
  }
  return alpha;
}

export type CleanupScore = {
  inkVisible: number; crossingVisible: number; meanInkAlpha: number;
  paperLeak: number; ruleResidue: number; specks: number; softEdgeShare: number; detected: boolean;
};

/** Scores an alpha map (0..255) against the fixture's ground truth. */
export function scoreCleanup(fixture: Fixture, alpha: Uint8ClampedArray): CleanupScore {
  const { width, height, ink, rule } = fixture;
  const nearInk = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (ink[y * width + x] <= 0.02) continue;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height) nearInk[yy * width + xx] = 1;
    }
  }
  let core = 0, coreVisible = 0, coreAlpha = 0, crossing = 0, crossingVisible = 0;
  let paper = 0, paperLeak = 0, rules = 0, ruleResidue = 0, visible = 0, soft = 0;
  for (let i = 0; i < width * height; i++) {
    const a = alpha[i] / 255;
    if (a > 0.1) { visible++; if (a < 0.9) soft++; }
    if (ink[i] >= 0.7) {
      core++; coreAlpha += a; if (a >= 0.25) coreVisible++;
      if (rule[i] >= 0.3) { crossing++; if (a >= 0.25) crossingVisible++; }
    } else if (!nearInk[i]) {
      if (rule[i] >= 0.5) { rules++; if (a >= 0.1) ruleResidue++; }
      else if (rule[i] === 0) { paper++; if (a >= 0.1) paperLeak++; }
    }
  }
  // Specks: visible components that never touch true ink.
  const seen = new Uint8Array(width * height);
  let specks = 0;
  const stack: number[] = [];
  for (let start = 0; start < width * height; start++) {
    if (seen[start] || alpha[start] <= 25) continue;
    let touchesInk = false;
    seen[start] = 1; stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      if (nearInk[i]) touchesInk = true;
      const x = i % width, y = (i - x) / width;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const j = yy * width + xx;
        if (!seen[j] && alpha[j] > 25) { seen[j] = 1; stack.push(j); }
      }
    }
    if (!touchesInk) specks++;
  }
  return {
    inkVisible: core ? coreVisible / core : 0,
    crossingVisible: crossing ? crossingVisible / crossing : 1,
    meanInkAlpha: core ? coreAlpha / core : 0,
    paperLeak: paper ? paperLeak / paper : 0,
    ruleResidue: rules ? ruleResidue / rules : 0,
    specks,
    softEdgeShare: visible ? soft / visible : 0,
    detected: visible > 20,
  };
}
