import { useId } from 'react';

type MotifProps = { className?: string };

/** SVG ids must be valid url(#…) targets, so strip React's punctuation. */
function useSvgId(prefix: string) {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, '');
}

function RouteContours({ className = '', viewBox, preserveAspectRatio, contours, route, nodes, finish, finishKind = 'check' }: MotifProps & {
  viewBox: string;
  preserveAspectRatio: string;
  contours: readonly string[];
  route: string;
  nodes: readonly (readonly [number, number])[];
  /** Ends the route in a small node: a check (all caught up), a lock (no access) or a magnifier (no matches). */
  finish?: readonly [number, number];
  finishKind?: 'check' | 'lock' | 'search';
}) {
  const id = useSvgId('route');
  const [x, , width] = viewBox.split(' ').map(Number);
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={`route-decor no-print ${className}`}
      viewBox={viewBox}
      preserveAspectRatio={preserveAspectRatio}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <defs>
        {/* Contours dissolve toward both ends instead of stopping abruptly. */}
        <linearGradient id={id + '-fade'} gradientUnits="userSpaceOnUse" x1={x} x2={x + width} y1="0" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.28" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.82" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.15" />
        </linearGradient>
        <mask id={id + '-mask'} maskUnits="userSpaceOnUse" x={x - 50} y="-200" width={width + 100} height="600">
          <rect x={x - 50} y="-200" width={width + 100} height="600" fill={'url(#' + id + '-fade)'} />
        </mask>
        <linearGradient id={id + '-route'} gradientUnits="userSpaceOnUse" x1={x} x2={x + width} y1="0" y2="0">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.25" />
          <stop offset="0.6" stopColor="currentColor" stopOpacity="1" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.85" />
        </linearGradient>
      </defs>
      <g mask={'url(#' + id + '-mask)'}>
        {contours.map((d, index) => (
          <path key={d} d={d} opacity={0.62 - index * 0.11} strokeWidth={index === 0 ? 1.15 : 1} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      <path className="route-decor-path" d={route} stroke={'url(#' + id + '-route)'} strokeWidth="1.25" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      {nodes.map(([cx, cy], index) => (
        <g key={cx}>
          <circle cx={cx} cy={cy} r={index === 1 ? 7 : 5.5} fill="currentColor" stroke="none" opacity={index === 1 ? 0.14 : 0.08} />
          <circle
            cx={cx}
            cy={cy}
            r="3"
            fill={index === 1 ? 'currentColor' : 'var(--decor-node-fill, white)'}
            strokeWidth="1.25"
            vectorEffect="non-scaling-stroke"
          />
          {index === 1 && <circle cx={cx - 0.8} cy={cy - 0.9} r="0.9" fill="#fff" stroke="none" opacity="0.7" />}
        </g>
      ))}
      {finish && <g>
        <circle cx={finish[0]} cy={finish[1]} r="9" fill="currentColor" stroke="none" opacity="0.12" />
        <circle cx={finish[0]} cy={finish[1]} r="5.5" fill="currentColor" stroke="none" />
        {finishKind === 'check' && <path d={`M${finish[0] - 2.4} ${finish[1]} l1.7 1.7 l3.1 -3.3`} stroke="#fff" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />}
        {finishKind === 'lock' && <>
          <rect x={finish[0] - 2.2} y={finish[1] - 0.6} width="4.4" height="3.2" rx="0.6" fill="#fff" stroke="none" />
          <path d={`M${finish[0] - 1.3} ${finish[1] - 0.6} v-1.1 a1.3 1.3 0 0 1 2.6 0 v1.1`} stroke="#fff" strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
        </>}
        {finishKind === 'search' && <>
          <circle cx={finish[0] - 0.6} cy={finish[1] - 0.6} r="1.9" stroke="#fff" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
          <path d={`M${finish[0] + 0.8} ${finish[1] + 0.8} l1.5 1.5`} stroke="#fff" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
        </>}
      </g>}
    </svg>
  );
}

// Contours run from innermost to outermost so the field fades toward its edges.
const headerContours = [
  'M330 46 C360 46 371 64 401 70 C432 77 450 69 467 51',
  'M300 39 C342 28 370 41 396 55 C420 68 449 56 467 36',
  'M274 30 C328 12 365 20 398 41 C420 55 448 40 466 21',
  'M248 21 C304 -3 357 0 398 25 C422 39 444 25 465 6',
  'M227 13 C283 -17 355 -19 400 10 C423 24 446 9 463 -8',
];

const railContours = [
  'M-16 122 C22 88 53 96 82 123 C107 146 122 166 161 184',
  'M-22 107 C23 70 60 81 93 110 C123 137 143 158 183 181',
  'M-29 91 C21 52 66 62 105 96 C137 124 166 153 204 178',
  'M-34 74 C20 29 74 44 118 82 C152 111 183 144 230 176',
  'M-40 54 C18 8 82 27 130 68 C169 101 202 136 252 172',
];

const emptyContours = [
  'M79 50 C75 43 84 34 101 31 C122 26 145 35 148 45 C152 55 133 64 114 65 C94 66 83 58 79 50Z',
  'M64 51 C60 39 73 28 98 23 C128 17 158 29 163 43 C171 58 144 71 114 73 C89 74 69 64 64 51Z',
  'M48 52 C42 36 63 22 95 15 C131 7 172 22 179 40 C188 60 157 79 114 81 C82 83 55 70 48 52Z',
  'M33 52 C26 34 53 15 92 8 C137 -1 184 14 194 37 C207 63 167 86 114 89 C77 91 40 75 33 52Z',
];

export function RouteHeaderMotif({ className }: MotifProps) {
  return (
    <RouteContours className={className} viewBox="220 0 224 104" preserveAspectRatio="xMaxYMid meet"
      contours={headerContours} route="M285 80 C305 77 319 65 337 57 S374 37 397 39 S421 39 432 31 S444 24 450 21"
      nodes={[[337, 57], [397, 39], [432, 31]]} />
  );
}

export function RouteCornerMotif({ className }: MotifProps) {
  // Two soft layers and a hairline crest, filled from the card's tone (currentColor).
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={`route-decor no-print ${className ?? ''}`}
      viewBox="0 0 120 30"
      preserveAspectRatio="none"
      fill="currentColor"
    >
      <path d="M0 30C26 14 62 4 120 9V30Z" opacity="0.06" />
      <path d="M8 30C36 15 78 10 120 17V30Z" opacity="0.1" />
      <path d="M8 30C36 15 78 10 120 17" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.32" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function RouteRailMotif({ className }: MotifProps) {
  return (
    <RouteContours className={className} viewBox="0 20 256 148" preserveAspectRatio="xMinYMax slice"
      contours={railContours} route="M-8 133 C17 131 31 117 50 107 S81 95 103 96 S146 108 167 99 S192 85 213 83"
      nodes={[[50, 107], [103, 96], [167, 99]]} />
  );
}

export function RouteEmptyMotif({ className, done, end }: MotifProps & { done?: boolean; end?: 'check' | 'lock' | 'search' }) {
  return (
    <RouteContours className={className} viewBox="0 0 228 94" preserveAspectRatio="xMidYMid meet"
      contours={emptyContours} route="M20 67 C41 64 53 62 71 56 S96 43 116 44 S141 49 158 42 S180 25 208 24"
      nodes={[[71, 56], [116, 44], [158, 42]]} finish={done || end ? [208, 24] : undefined} finishKind={end ?? 'check'} />
  );
}
