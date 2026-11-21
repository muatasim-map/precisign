export type CropPoint = { x: number; y: number };

// Coordinates are relative to the image, in clockwise order from the top left.
export const imageCorners: readonly CropPoint[] = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 },
];

export function validSignatureCrop(corners: readonly CropPoint[]) {
  return corners.length === 4 && corners.every((a, i) => {
    const b = corners[(i + 1) % 4], c = corners[(i + 2) % 4];
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x) > 0.001;
  });
}

export function rectifySignature(image: HTMLImageElement, corners: readonly CropPoint[]) {
  if (!validSignatureCrop(corners)) throw new Error('Move the corners apart to select a valid crop.');
  const source = document.createElement('canvas');
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
  source.width = Math.max(1, Math.round(image.naturalWidth * scale));
  source.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const sourceContext = source.getContext('2d', { willReadFrequently: true })!;
  sourceContext.drawImage(image, 0, 0, source.width, source.height);
  const sourcePixels = sourceContext.getImageData(0, 0, source.width, source.height);
  const [a, b, c, d] = corners.map(({ x, y }) => ({ x: x * (source.width - 1), y: y * (source.height - 1) }));
  const distance = (first: CropPoint, second: CropPoint) => Math.hypot(first.x - second.x, first.y - second.y);
  const width = Math.max(distance(a, b), distance(d, c));
  const height = Math.max(distance(a, d), distance(b, c));
  const outputScale = Math.min(1, 720 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(width * outputScale));
  canvas.height = Math.max(2, Math.round(height * outputScale));
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const result = context.createImageData(canvas.width, canvas.height);

  // Project the output rectangle into the selected quadrilateral.
  const bx = b.x - c.x, dx = d.x - c.x, kx = a.x - b.x + c.x - d.x;
  const by = b.y - c.y, dy = d.y - c.y, ky = a.y - b.y + c.y - d.y;
  const determinant = bx * dy - dx * by;
  if (Math.abs(determinant) < 0.01) throw new Error('The selected area is too small.');
  const g = (kx * dy - dx * ky) / determinant;
  const h = (bx * ky - kx * by) / determinant;
  for (let row = 0; row < canvas.height; row++) {
    const v = row / (canvas.height - 1);
    for (let col = 0; col < canvas.width; col++) {
      const u = col / (canvas.width - 1);
      const weight = 1 + g * u + h * v;
      const x = Math.max(0, Math.min(source.width - 1, Math.round((a.x + (b.x * (1 + g) - a.x) * u + (d.x * (1 + h) - a.x) * v) / weight)));
      const y = Math.max(0, Math.min(source.height - 1, Math.round((a.y + (b.y * (1 + g) - a.y) * u + (d.y * (1 + h) - a.y) * v) / weight)));
      const from = (y * source.width + x) * 4;
      result.data.set(sourcePixels.data.subarray(from, from + 4), (row * canvas.width + col) * 4);
    }
  }
  context.putImageData(result, 0, 0);
  return canvas;
}

// ---------------------------------------------------------------------------
// Signature cleanup
//
// Photos of a signature have uneven lighting, paper texture, JPEG noise and often ruled lines.
// The cleanup models the paper locally, measures each pixel's darkness relative to that paper,
// removes only the modelled contribution of detected ruled lines (so ink crossing a rule survives),
// drops isolated specks, and renders a graded alpha in a natural pen colour.
// The heavy analysis runs once per crop; the Ink darkness slider only remaps alpha.
// ---------------------------------------------------------------------------

export type InkColor = readonly [number, number, number];
export type InkKind = 'blue' | 'black' | 'red' | 'unclear';
/** Pen colours used for the cleaned result. `unclear` keeps the colour used before ink detection. */
export const inkColors: Record<InkKind, InkColor> = {
  blue: [27, 47, 128],
  black: [30, 32, 40],
  red: [150, 32, 38],
  unclear: [24, 43, 69],
};
export const fallbackInkColor = inkColors.unclear;
/** Ink darkness value at which strokes of typical strength become fully opaque. */
export const defaultInkDarkness = 1.6;

export type DetectedLine = {
  orientation: 'horizontal' | 'vertical';
  offset: number;
  slope: number;
  thickness: number;
  coverage: number;
  darkness: number;
  removed: boolean;
  reason: string;
};

export type SignatureAnalysis = {
  width: number;
  height: number;
  /** Ink strength per pixel (0..1) after paper normalisation, rule removal and despeckling. */
  strength: Float32Array;
  /** Source opacity per pixel (0..1). */
  opacity: Float32Array;
  floor: number;
  reference: number;
  inkKind: InkKind;
  color: InkColor;
  /** True when ink and paper were too close to tell apart, so no ruled lines were removed. */
  conservative: boolean;
  lines: DetectedLine[];
};

const clamp01 = (value: number) => value < 0 ? 0 : value > 1 ? 1 : value;

function percentile(values: Float32Array | number[], fraction: number) {
  if (!values.length) return 0;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))))];
}

/** 3x3 binomial blur with clamped edges. */
function blur3(src: Float32Array, width: number, height: number) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const l = src[row + (x > 0 ? x - 1 : x)], r = src[row + (x < width - 1 ? x + 1 : x)];
      tmp[row + x] = (l + 2 * src[row + x] + r) / 4;
    }
  }
  for (let y = 0; y < height; y++) {
    const up = (y > 0 ? y - 1 : y) * width, down = (y < height - 1 ? y + 1 : y) * width, row = y * width;
    for (let x = 0; x < width; x++) out[row + x] = (tmp[up + x] + 2 * tmp[row + x] + tmp[down + x]) / 4;
  }
  return out;
}

/** Sliding-window max or min along rows (step 1) or columns (step width), radius r, using a monotonic deque. */
function slide(src: Float32Array, width: number, height: number, radius: number, vertical: boolean, max: boolean) {
  const out = new Float32Array(src.length);
  const lines = vertical ? width : height, length = vertical ? height : width;
  const line = new Float32Array(length);
  const deque = new Int32Array(length);
  for (let l = 0; l < lines; l++) {
    const start = vertical ? l : l * width, step = vertical ? width : 1;
    for (let k = 0; k < length; k++) line[k] = src[start + k * step];
    let head = 0, tail = 0, next = 0;
    for (let k = 0; k < length; k++) {
      const until = Math.min(length - 1, k + radius);
      for (; next <= until; next++) {
        const value = line[next];
        while (tail > head && (max ? line[deque[tail - 1]] <= value : line[deque[tail - 1]] >= value)) tail--;
        deque[tail++] = next;
      }
      while (deque[head] < k - radius) head++;
      out[start + k * step] = line[deque[head]];
    }
  }
  return out;
}

/** Paper brightness map: a grayscale closing removes thin dark strokes but keeps shadow edges sharp. */
function estimatePaper(luma: Float32Array, width: number, height: number) {
  const radius = Math.max(5, Math.min(14, Math.round(Math.min(width, height) * 0.04)));
  // Edge-replicate padding (applied once, before the closing) so a shadow edge that meets the crop border
  // is restored as it would be inside the crop.
  const pad = 2 * radius, pw = width + 2 * pad, ph = height + 2 * pad;
  const padded = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(height - 1, Math.max(0, y - pad)) * width;
    for (let x = 0; x < pw; x++) padded[y * pw + x] = luma[sy + Math.min(width - 1, Math.max(0, x - pad))];
  }
  let closed = slide(slide(padded, pw, ph, radius, false, true), pw, ph, radius, true, true);
  closed = slide(slide(closed, pw, ph, radius, false, false), pw, ph, radius, true, false);
  let paper = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) paper[y * width + x] = closed[(y + pad) * pw + x + pad];
  // A coarse high-percentile grid guards against wide ink blobs that the closing would treat as paper.
  const cell = Math.max(8, Math.ceil(Math.max(width, height) / 32));
  const gw = Math.ceil(width / cell), gh = Math.ceil(height / cell);
  const grid = new Float32Array(gw * gh);
  const histogram = new Uint32Array(256);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    histogram.fill(0);
    let count = 0;
    for (let y = gy * cell; y < Math.min(height, (gy + 1) * cell); y++) for (let x = gx * cell; x < Math.min(width, (gx + 1) * cell); x++) {
      histogram[Math.min(255, Math.max(0, Math.round(luma[y * width + x])))]++; count++;
    }
    let seen = 0, level = 255;
    for (; level > 0; level--) { seen += histogram[level]; if (seen >= count * 0.2) break; }
    grid[gy * gw + gx] = level;
  }
  const smoothGrid = blur3(blur3(grid, gw, gh), gw, gh);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5)), y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5)), x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const coarse = (smoothGrid[y0 * gw + x0] * (1 - tx) + smoothGrid[y0 * gw + x1] * tx) * (1 - ty)
        + (smoothGrid[y1 * gw + x0] * (1 - tx) + smoothGrid[y1 * gw + x1] * tx) * ty;
      const i = y * width + x;
      if (paper[i] < coarse * 0.55) paper[i] = coarse;
    }
  }
  paper = blur3(paper, width, height);
  for (let i = 0; i < paper.length; i++) paper[i] = Math.max(paper[i], luma[i], 24);
  return paper;
}

type LineView = { length: number; across: number; index: (along: number, across: number) => number; orientation: DetectedLine['orientation'] };

/** Absorbance chromaticity of a transmittance triple: separates blue, black and red pens. */
function chroma(t: readonly number[]) {
  const a = t.map(v => -Math.log(Math.min(1, Math.max(0.03, v))));
  const sum = a[0] + a[1] + a[2] || 1;
  return [a[0] / sum, a[1] / sum, a[2] / sum];
}
const chromaDistance = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

type Candidate = { center: number; slope: number; half: number; coverage: number; longestRun: number };

/** Finds long, thin, nearly straight lines (rules) in one orientation. */
function findLines(mask: Uint8Array, view: LineView): Candidate[] {
  const { length, across } = view;
  const slopes: number[] = [];
  for (let s = -0.07; s <= 0.0701; s += 0.0035) slopes.push(+s.toFixed(4));
  const pad = Math.ceil(0.07 * length) + 2;
  const bins = across + 2 * pad;
  const points: number[] = [];
  for (let v = 0; v < across; v++) for (let u = 0; u < length; u++) if (mask[view.index(u, v)]) points.push(u, v);
  if (!points.length) return [];
  let best: { slope: number; profile: Float32Array; score: number } | null = null;
  const hits = new Float32Array(bins);
  for (const slope of slopes) {
    hits.fill(0);
    for (let p = 0; p < points.length; p += 2) {
      const r = Math.round(points[p + 1] - slope * points[p]) + pad;
      if (r >= 0 && r < bins) hits[r]++;
    }
    const profile = new Float32Array(bins);
    let score = 0;
    for (let r = 0; r < bins; r++) {
      const offset = r - pad;
      // Length of the line inside the image at this offset.
      let lo = 0, hi = length - 1;
      if (slope > 0) { lo = Math.max(lo, Math.ceil(-offset / slope)); hi = Math.min(hi, Math.floor((across - 1 - offset) / slope)); }
      else if (slope < 0) { lo = Math.max(lo, Math.ceil((across - 1 - offset) / slope)); hi = Math.min(hi, Math.floor(-offset / slope)); }
      else if (offset < 0 || offset > across - 1) hi = -1;
      const span = hi - lo + 1;
      profile[r] = span > length * 0.5 ? hits[r] / span : 0;
      if (profile[r] > 0.3) score += (profile[r] - 0.3) ** 2;
    }
    if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && Math.abs(slope) < Math.abs(best.slope))) best = { slope, profile, score };
  }
  if (!best || best.score <= 0) return [];
  const { slope, profile } = best;
  const maxHalf = Math.max(3, Math.round(across * 0.02));
  const found: Candidate[] = [];
  for (let r = 1; r < bins - 1; r++) {
    const peak = profile[r];
    if (peak < 0.42 || peak < profile[r - 1] || peak < profile[r + 1]) continue;
    if (found.length && Math.abs(found[found.length - 1].center + pad - r) <= 2) continue;
    let r0 = r, r1 = r;
    while (r0 > 0 && profile[r0 - 1] >= peak * 0.45 && r - r0 < maxHalf * 2) r0--;
    while (r1 < bins - 1 && profile[r1 + 1] >= peak * 0.45 && r1 - r < maxHalf * 2) r1++;
    const outside = Math.max(profile[Math.max(0, r0 - 4)] ?? 0, profile[Math.min(bins - 1, r1 + 4)] ?? 0);
    const half = (r1 - r0) / 2 + 0.5;
    if (half > maxHalf + 0.5 || peak - outside < 0.25) continue; // too thick or not a sharp ridge: not a rule
    // Longest run of consecutive covered positions along the line.
    const center = (r0 + r1) / 2 - pad;
    let run = 0, longest = 0;
    for (let u = 0; u < length; u++) {
      let hit = false;
      for (let o = Math.floor(-half); o <= Math.ceil(half) && !hit; o++) {
        const v = Math.round(center + slope * u + o);
        if (v >= 0 && v < across && mask[view.index(u, v)]) hit = true;
      }
      run = hit ? run + 1 : 0;
      if (run > longest) longest = run;
    }
    if (longest < length * 0.2 && peak < 0.6) continue;
    found.push({ center, slope, half, coverage: peak, longestRun: longest / length });
  }
  return found;
}

type LineStats = { candidate: Candidate; darkness: number; chroma: number[] };

function measureLine(candidate: Candidate, view: LineView, strength: Float32Array, transmit: Float32Array[], floor: number): LineStats {
  const { length, across, index } = view;
  const columnPeaks: number[] = [];
  const tSum = [0, 0, 0];
  let tWeight = 0;
  for (let u = 0; u < length; u++) {
    const c = candidate.center + candidate.slope * u;
    let peak = 0, peakIndex = -1;
    for (let o = Math.floor(-candidate.half); o <= Math.ceil(candidate.half); o++) {
      const v = Math.round(c + o);
      if (v < 0 || v >= across) continue;
      const i = index(u, v);
      if (strength[i] > peak) { peak = strength[i]; peakIndex = i; }
    }
    // Skip columns where ink touches the band from outside, so the line's own colour is measured.
    const above = Math.round(c - candidate.half - 2), below = Math.round(c + candidate.half + 2);
    const inkNearby = (above >= 0 && strength[index(u, above)] > floor) || (below < across && strength[index(u, below)] > floor);
    if (peakIndex >= 0 && peak > floor && !inkNearby) {
      columnPeaks.push(peak);
      for (let k = 0; k < 3; k++) tSum[k] += transmit[k][peakIndex] * peak;
      tWeight += peak;
    }
  }
  const darkness = percentile(columnPeaks, 0.5);
  return { candidate, darkness, chroma: chroma(tWeight ? tSum.map(v => v / tWeight) : [1, 1, 1]) };
}

/** Removes a ruled line's modelled darkness (multiplicatively) so ink crossing it keeps its own strength. */
type LineTemplate = { profile: number[]; peak: number; cap: number };

function subtractLine(stats: LineStats, view: LineView, strength: Float32Array, floor: number, template?: LineTemplate): LineTemplate {
  const { candidate } = stats;
  const { length, across, index } = view;
  const reach = Math.ceil(candidate.half) + 1;
  const offsets = 2 * reach + 1;
  // Cross-section profile of the rule: median across all positions (ink crossings are a minority).
  const samples: number[][] = Array.from({ length: offsets }, () => []);
  for (let u = 0; u < length; u += 1) {
    const c = candidate.center + candidate.slope * u;
    const base = Math.round(c);
    for (let o = -reach; o <= reach; o++) {
      const v = base + o;
      if (v >= 0 && v < across) samples[o + reach].push(strength[index(u, v)]);
    }
  }
  // A line predicted from rule spacing (hidden under ink) uses a neighbouring rule's profile instead.
  const profile = template && template.profile.length === offsets ? template.profile : samples.map(values => percentile(values, 0.5));
  const peak = template && template.profile.length === offsets ? template.peak : Math.max(...profile, 1e-6);
  const cap = template ? template.cap : peak * 1.6;
  // Local rule strength along its length, robust to crossings (moving median of column peaks).
  const columnPeak = new Float32Array(length);
  for (let u = 0; u < length; u++) {
    const base = Math.round(candidate.center + candidate.slope * u);
    let m = 0;
    for (let o = -reach; o <= reach; o++) { const v = base + o; if (v >= 0 && v < across) m = Math.max(m, strength[index(u, v)]); }
    columnPeak[u] = m;
  }
  const window = Math.max(15, Math.round(length * 0.06));
  const level = new Float32Array(length);
  for (let u = 0; u < length; u += 4) {
    const lo = Math.max(0, u - window), hi = Math.min(length, u + window + 1);
    const local = Math.min(cap, percentile(columnPeak.subarray(lo, hi), 0.4));
    for (let k = u; k < Math.min(length, u + 4); k++) level[k] = local;
  }
  for (let u = 0; u < length; u++) {
    const base = Math.round(candidate.center + candidate.slope * u);
    const outside = (o: number) => { const v = base + o; return v >= 0 && v < across ? strength[index(u, v)] : 0; };
    const above = Math.max(outside(-reach - 1), outside(-reach - 2));
    const below = Math.max(outside(reach + 1), outside(reach + 2));
    const bridge = Math.min(above, below);
    for (let o = -reach; o <= reach; o++) {
      const v = base + o;
      if (v < 0 || v >= across) continue;
      const i = index(u, v);
      const expected = Math.min(0.97, (profile[o + reach] / peak) * level[u]);
      const observed = strength[i];
      let residual = clamp01(1 - (1 - observed) / (1 - expected));
      // A stroke entering and leaving the band is bridged if the band is visibly darker than the rule alone.
      if (bridge > floor * 1.5 && observed - expected >= 0.35 * bridge * (1 - expected)) residual = Math.max(residual, Math.min(observed, bridge * 0.9));
      strength[i] = residual;
    }
  }
  return { profile, peak, cap };
}

function transpose<T extends Float32Array | Uint8Array>(src: T, width: number, height: number, make: (n: number) => T) {
  const out = make(src.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) out[x * height + y] = src[y * width + x];
  return out;
}

/**
 * Analyses a rectified crop (RGBA, row-major). Returns null when no ink can be told apart from the paper.
 * Pure and DOM-free so it can be tested in Node and reused by the slider without re-analysis.
 */
export function analyzeSignaturePixels(rgba: Uint8ClampedArray, width: number, height: number): SignatureAnalysis | null {
  const n = width * height;
  if (n < 16) return null;
  const luma = new Float32Array(n), opacity = new Float32Array(n);
  const channels = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    opacity[i] = a > 0.25 ? a : 0;
    // Transparent pixels are treated as white paper.
    for (let k = 0; k < 3; k++) channels[k][i] = rgba[i * 4 + k] * a + 255 * (1 - a);
    luma[i] = channels[0][i] * 0.299 + channels[1][i] * 0.587 + channels[2][i] * 0.114;
  }
  const smoothLuma = blur3(luma, width, height);
  const paper = estimatePaper(smoothLuma, width, height);

  // Darkness relative to local paper: shadows lower paper and ink together, so they cancel out.
  const fine = new Float32Array(n), smooth = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    fine[i] = clamp01((paper[i] - luma[i]) / paper[i]);
    smooth[i] = clamp01((paper[i] - smoothLuma[i]) / paper[i]);
  }
  const strength = new Float32Array(n);
  for (let i = 0; i < n; i++) strength[i] = 0.35 * fine[i] + 0.65 * smooth[i];

  // Paper colour (for colour cast) and per-channel transmittance.
  const paperColor = [0, 0, 0];
  let paperCount = 0;
  for (let i = 0; i < n; i += 3) if (smooth[i] < 0.03) { for (let k = 0; k < 3; k++) paperColor[k] += channels[k][i] / paper[i]; paperCount++; }
  for (let k = 0; k < 3; k++) paperColor[k] = paperCount ? paperColor[k] / paperCount : 1;
  const transmit = channels.map((channel, k) => {
    const t = new Float32Array(n);
    for (let i = 0; i < n; i++) t[i] = Math.min(1.2, channel[i] / Math.max(1, paper[i] * paperColor[k]));
    return t;
  });

  // Noise floor from the paper-dominated distribution (median + robust spread).
  const sample: number[] = [];
  const stride = Math.max(1, Math.floor(n / 40000));
  for (let i = 0; i < n; i += stride) sample.push(strength[i]);
  const median = percentile(sample, 0.5);
  const mad = percentile(sample.map(v => Math.abs(v - median)), 0.5);
  const floor = Math.min(0.2, median + Math.max(0.035, 4.5 * 1.4826 * mad));

  const candidateMask = new Uint8Array(n);
  let candidates = 0;
  for (let i = 0; i < n; i++) if (strength[i] > floor) { candidateMask[i] = 1; candidates++; }
  if (candidates < Math.max(12, n * 0.0003)) return null;

  // Ruled-line detection in both orientations (notebook rules, margin lines, grid paper).
  const horizontal: LineView = { orientation: 'horizontal', length: width, across: height, index: (u, v) => v * width + u };
  const vertical: LineView = { orientation: 'vertical', length: height, across: width, index: (u, v) => u * width + v };
  const found = [
    ...findLines(candidateMask, horizontal).map(candidate => ({ candidate, view: horizontal })),
    ...findLines(candidateMask, vertical).map(candidate => ({ candidate, view: vertical })),
  ];
  const inBand = new Uint8Array(n);
  for (const { candidate, view } of found) {
    for (let u = 0; u < view.length; u++) {
      const base = Math.round(candidate.center + candidate.slope * u);
      for (let o = -Math.ceil(candidate.half) - 1; o <= Math.ceil(candidate.half) + 1; o++) {
        const v = base + o;
        if (v >= 0 && v < view.across) inBand[view.index(u, v)] = 1;
      }
    }
  }
  // Ink reference outside any line band: its strength and colour.
  const inkValues: number[] = [];
  for (let i = 0; i < n; i++) if (candidateMask[i] && !inBand[i]) inkValues.push(strength[i]);
  const inkReference = percentile(inkValues, 0.8);
  const strongInk = percentile(inkValues, 0.5);
  const inkT = [0, 0, 0];
  let inkWeight = 0;
  for (let i = 0; i < n; i++) if (candidateMask[i] && !inBand[i] && strength[i] >= strongInk) {
    for (let k = 0; k < 3; k++) inkT[k] += transmit[k][i] * strength[i];
    inkWeight += strength[i];
  }
  const inkChroma = chroma(inkWeight ? inkT.map(v => v / inkWeight) : [1, 1, 1]);
  const hasInkOutsideLines = inkValues.length >= Math.max(12, n * 0.0005);
  const conservative = hasInkOutsideLines && inkReference - floor < 0.07;

  const lines: DetectedLine[] = [];
  const byOrientation = { horizontal: [] as LineStats[], vertical: [] as LineStats[] };
  for (const { candidate, view } of found) byOrientation[view.orientation].push(measureLine(candidate, view, strength, transmit, floor));
  for (const orientation of ['horizontal', 'vertical'] as const) {
    const view = orientation === 'horizontal' ? horizontal : vertical;
    const group = byOrientation[orientation].sort((a, b) => a.candidate.center - b.candidate.center);
    // Repeated spacing: consecutive gaps roughly equal (allowing a missing rule).
    const gaps = group.slice(1).map((stats, i) => stats.candidate.center - group[i].candidate.center);
    const gap = percentile(gaps, 0.5);
    const periodic = group.length >= 3 && gap > 4 && gaps.filter(g => {
      const ratio = g / gap;
      return Math.abs(ratio - Math.round(ratio)) < 0.2 && Math.round(ratio) >= 1;
    }).length >= gaps.length * 0.7;
    const groupDarkness = percentile(group.map(s => s.darkness), 0.5);
    const groupChroma = [0, 1, 2].map(k => percentile(group.map(s => s.chroma[k]), 0.5));
    let template: LineTemplate | undefined;
    for (const stats of group) {
      const inkColorMatch = chromaDistance(stats.chroma, inkChroma) < 0.12;
      const inkLike = hasInkOutsideLines && inkColorMatch && stats.darkness >= 0.7 * inkReference;
      let removed = false, reason = '';
      if (conservative) {
        reason = 'kept: ink and paper too close to separate safely';
      } else if (periodic) {
        const outlier = stats.darkness > groupDarkness * 1.6 && chromaDistance(stats.chroma, groupChroma) > 0.06;
        if (outlier && inkLike) reason = 'kept: darker ink-coloured line among rules (underline)';
        else { removed = true; reason = 'removed: evenly spaced thin lines'; }
      } else if (!hasInkOutsideLines) {
        removed = true; reason = 'removed: only line-like marks on the page';
      } else if (inkLike) {
        reason = 'kept: single line with ink colour and strength (underline)';
      } else if (!inkColorMatch || stats.darkness < 0.6 * inkReference) {
        removed = true; reason = !inkColorMatch ? 'removed: thin line in a different colour from the ink' : 'removed: thin line much lighter than the ink';
      } else {
        reason = 'kept: could be part of the signature';
      }
      if (removed && periodic && !template) template = subtractLine(stats, view, strength, floor);
      else if (removed) subtractLine(stats, view, strength, floor);
      lines.push({
        orientation, offset: stats.candidate.center, slope: stats.candidate.slope, thickness: stats.candidate.half * 2,
        coverage: stats.candidate.coverage, darkness: stats.darkness, removed, reason,
      });
    }
    // Rules hidden under ink (an underline or a dense stroke run along one) break the spacing; predict them.
    if (periodic && template && !conservative) {
      const first = group[0].candidate, half = percentile(group.map(s => s.candidate.half), 0.5);
      const capped: LineTemplate = { ...template, cap: groupDarkness * 1.25 };
      for (let c = first.center - Math.floor((first.center + half) / gap) * gap; c < view.across + half; c += gap) {
        if (group.some(s => Math.abs(s.candidate.center - c) < gap * 0.3)) continue;
        const predicted: Candidate = { center: c, slope: first.slope, half, coverage: 0, longestRun: 0 };
        const stats = measureLine(predicted, view, strength, transmit, -1);
        const evidence: number[] = [];
        for (let u = 0; u < view.length; u += 2) {
          let m = 0;
          for (let o = -Math.ceil(half); o <= Math.ceil(half); o++) {
            const v = Math.round(c + first.slope * u + o);
            if (v >= 0 && v < view.across) m = Math.max(m, strength[view.index(u, v)]);
          }
          evidence.push(m);
        }
        if (percentile(evidence, 0.5) < groupDarkness * 0.5) continue;
        subtractLine({ ...stats, candidate: predicted }, view, strength, floor, capped);
        lines.push({ orientation, offset: c, slope: first.slope, thickness: half * 2, coverage: 0, darkness: groupDarkness, removed: true, reason: 'removed: predicted from rule spacing (partly hidden under ink)' });
      }
    }
  }

  // Despeckle: keep connected ink components that look like pen strokes.
  const strokeValues: number[] = [];
  for (let i = 0; i < n; i++) if (strength[i] > floor + 0.02) strokeValues.push(strength[i]);
  const reference = Math.max(floor + 0.06, percentile(strokeValues, 0.8));
  const low = floor + 0.22 * (reference - floor);
  const mask = new Uint8Array(n);
  let area = 0, boundary = 0;
  for (let i = 0; i < n; i++) if (strength[i] > low) { mask[i] = 1; area++; }
  if (!area) return null;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (mask[i] && (x === 0 || y === 0 || x === width - 1 || y === height - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - width] || !mask[i + width])) boundary++;
  }
  const strokeWidth = Math.max(1.5, Math.min(12, (2 * area) / Math.max(1, boundary)));
  const minArea = Math.max(5, Math.round(0.4 * strokeWidth * strokeWidth));
  const labels = new Int32Array(n).fill(-1);
  const keep: boolean[] = [];
  const stack: number[] = [];
  const pixels: number[] = [];
  for (let start = 0; start < n; start++) {
    if (!mask[start] || labels[start] >= 0) continue;
    const label = keep.length;
    labels[start] = label; stack.push(start); pixels.length = 0;
    let peak = 0, minX = width, maxX = 0, minY = height, maxY = 0;
    while (stack.length) {
      const i = stack.pop()!;
      pixels.push(i);
      const x = i % width, y = (i - x) / width;
      if (strength[i] > peak) peak = strength[i];
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const j = yy * width + xx;
        if (mask[j] && labels[j] < 0) { labels[j] = label; stack.push(j); }
      }
    }
    const size = pixels.length;
    const boxArea = (maxX - minX + 1) * (maxY - minY + 1);
    const touchesEdge = minX === 0 || minY === 0 || maxX === width - 1 || maxY === height - 1;
    const weak = peak < floor + 0.5 * (reference - floor);
    let kept = size >= minArea && !(weak && size < 6 * minArea);
    // A large solid region against the crop edge is the table or a shadow, not a stroke.
    if (touchesEdge && size > n * 0.03 && size / boxArea > 0.45) kept = false;
    // Weak marks against the crop edge are shadow or paper-edge remnants; real strokes there are strong.
    if (touchesEdge && peak < floor + 0.6 * (reference - floor)) kept = false;
    keep.push(kept);
  }
  // Keep soft anti-aliased edges next to kept strokes; drop everything else (grain, JPEG halos).
  const near = new Uint8Array(n);
  let keptArea = 0;
  for (let i = 0; i < n; i++) {
    if (labels[i] < 0 || !keep[labels[i]]) continue;
    keptArea++;
    const x = i % width, y = (i - x) / width;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height) near[yy * width + xx] = 1;
    }
  }
  if (keptArea < Math.max(20, n * 0.0004)) return null;
  for (let i = 0; i < n; i++) if (!near[i]) strength[i] = 0;
  // Fill pinholes inside strokes (paper fibre or JPEG speckle within ink).
  const filled = Float32Array.from(strength);
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x;
    if (strength[i] >= low) continue;
    const around = [strength[i - 1], strength[i + 1], strength[i - width], strength[i + width]];
    if (around.filter(v => v >= low).length >= 3) filled[i] = Math.max(strength[i], (around[0] + around[1] + around[2] + around[3]) / 4);
  }

  // Pen colour from the strongest kept ink.
  const keptStrength: number[] = [];
  for (let i = 0; i < n; i++) if (labels[i] >= 0 && keep[labels[i]]) keptStrength.push(filled[i]);
  const strongCut = percentile(keptStrength, 0.5);
  const penT = [0, 0, 0];
  let penWeight = 0;
  for (let i = 0; i < n; i++) if (labels[i] >= 0 && keep[labels[i]] && filled[i] >= strongCut) {
    for (let k = 0; k < 3; k++) penT[k] += transmit[k][i] * filled[i];
    penWeight += filled[i];
  }
  const [cr, cg, cb] = chroma(penWeight ? penT.map(v => v / penWeight) : [1, 1, 1]);
  const inkKind: InkKind = cb < 0.25 && cr > 0.37 ? 'blue'
    : cr < 0.2 && cg > 0.38 ? 'red'
      : Math.max(cr, cg, cb) - Math.min(cr, cg, cb) < 0.1 ? 'black'
        : 'unclear';
  const finalReference = Math.max(floor + 0.06, percentile(keptStrength, 0.75));
  return { width, height, strength: filled, opacity, floor, reference: finalReference, inkKind, color: inkColors[inkKind], conservative, lines };
}

/**
 * Maps analysed ink strength to alpha (0..255). The same global curve applies to the whole crop,
 * so Ink darkness changes every stroke the same way. At the default darkness, typical strokes are opaque.
 */
export function renderSignatureAlpha(analysis: SignatureAnalysis, darkness: number) {
  const { strength, opacity, floor, reference } = analysis;
  const alpha = new Uint8ClampedArray(strength.length);
  const gain = Math.max(0.1, darkness) / defaultInkDarkness / (reference - floor);
  const knee = 0.2, norm = 1 - knee / 2;
  for (let i = 0; i < strength.length; i++) {
    const t = (strength[i] - floor) * gain;
    if (t <= 0) continue;
    const curved = t < knee ? (t * t) / (2 * knee) : t - knee / 2; // soft start avoids hard grain edges
    alpha[i] = Math.round(Math.min(1, curved / norm) * opacity[i] * 255);
  }
  return alpha;
}

export function signatureBounds(alpha: Uint8ClampedArray, width: number, height: number) {
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (alpha[y * width + x] > 6) {
      if (x < left) left = x; if (x > right) right = x;
      if (y < top) top = y; if (y > bottom) bottom = y;
    }
  }
  return right < left ? null : { left, top, right, bottom };
}

const analyses = new WeakMap<HTMLCanvasElement, SignatureAnalysis | null>();

/** Analysis is cached per crop canvas, so moving the Ink darkness slider only remaps alpha. */
export function analyzeSignature(crop: HTMLCanvasElement) {
  if (!analyses.has(crop)) {
    const { width, height } = crop;
    const pixels = crop.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height);
    analyses.set(crop, analyzeSignaturePixels(pixels.data, width, height));
  }
  return analyses.get(crop)!;
}

const lastResult = new WeakMap<HTMLCanvasElement, { darkness: number; url: string | null }>();

/** The editor asks for the same crop and darkness from render and from the slider handler; encode once. */
export function cleanSignature(crop: HTMLCanvasElement, darkness: number) {
  const last = lastResult.get(crop);
  if (last && last.darkness === darkness) return last.url;
  const url = encodeCleaned(crop, darkness);
  lastResult.set(crop, { darkness, url });
  return url;
}

function encodeCleaned(crop: HTMLCanvasElement, darkness: number) {
  const analysis = analyzeSignature(crop);
  if (!analysis) return null;
  const { width, height, color } = analysis;
  const alpha = renderSignatureAlpha(analysis, darkness);
  const bounds = signatureBounds(alpha, width, height);
  if (!bounds) return null;
  const { left, top, right, bottom } = bounds;
  const result = document.createElement('canvas');
  result.width = right - left + 7;
  result.height = bottom - top + 7;
  const context = result.getContext('2d')!;
  const pixels = context.createImageData(result.width, result.height);
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
    const to = ((y - top + 3) * result.width + (x - left + 3)) * 4;
    pixels.data[to] = color[0];
    pixels.data[to + 1] = color[1];
    pixels.data[to + 2] = color[2];
    pixels.data[to + 3] = alpha[y * width + x];
  }
  context.putImageData(pixels, 0, 0);
  return result.toDataURL('image/png');
}
