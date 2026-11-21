import { useMemo, useRef, useState } from 'react';
import { cleanSignature, imageCorners, rectifySignature, validSignatureCrop, type CropPoint } from './signatureImage';

const cornerNames = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
const clamp = (value: number) => Math.min(1, Math.max(0, value));

export function SignatureCropEditor({ source, onSelect }: { source: string; onSelect: (image: string | null) => void }) {
  const image = useRef<HTMLImageElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const [corners, setCorners] = useState(imageCorners);
  const [crop, setCrop] = useState<HTMLCanvasElement | null>(null);
  const [darkness, setDarkness] = useState(1.6);
  const [selected, setSelected] = useState<'original' | 'cleaned'>('original');
  const [error, setError] = useState('');
  const original = useMemo(() => crop?.toDataURL('image/png'), [crop]);
  const cleaned = useMemo(() => crop && cleanSignature(crop, darkness), [crop, darkness]);

  function moveCorner(index: number, point: CropPoint) {
    setCorners(current => {
      const next = current.map((corner, i) => i === index ? { x: clamp(point.x), y: clamp(point.y) } : corner);
      return validSignatureCrop(next) ? next : current;
    });
  }

  if (crop && original) return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {([{ id: 'original', label: 'Original crop', src: original }, { id: 'cleaned', label: 'Cleaned signature', src: cleaned }] as const).map(option => (
          <label key={option.id} className="min-w-0 rounded-xl border border-workspace-line p-3 text-sm font-semibold has-[:checked]:border-workspace-teal">
            <span className="flex items-center gap-2">
              <input type="radio" name="signature-result" disabled={!option.src} checked={selected === option.id} onChange={() => {
                if (!option.src) return;
                setSelected(option.id);
                onSelect(option.src);
              }} />
              {option.label}
            </span>
            <span className="mt-2 grid h-24 place-items-center rounded-lg bg-slate-50 p-2">
              {option.src ? <img src={option.src} alt="" className="max-h-full max-w-full object-contain" /> : <span className="font-normal">No ink detected</span>}
            </span>
          </label>
        ))}
      </div>
      <p className="text-sm text-workspace-muted">If part of your signature is missing, choose <strong>Original crop</strong>.</p>
      <label className="block text-sm font-semibold">
        Ink darkness
        <input className="mt-1 block w-full accent-teal-700" type="range" min="0.6" max="4" step="0.1" value={darkness} onChange={event => {
          const nextDarkness = Number(event.target.value);
          setDarkness(nextDarkness);
          if (selected === 'cleaned') {
            const nextImage = cleanSignature(crop, nextDarkness);
            if (!nextImage) setSelected('original');
            onSelect(nextImage || original);
          }
        }} />
      </label>
      <div className="rounded-lg border border-workspace-line bg-white p-3">
        <p className="text-xs font-semibold text-workspace-muted">Signature box preview</p>
        <div className="mt-2 grid h-16 max-w-56 place-items-center border-b border-slate-400">
          <img src={selected === 'cleaned' && cleaned ? cleaned : original} alt="Selected signature" className="max-h-14 max-w-full object-contain" />
        </div>
      </div>
      <button type="button" className="workspace-control min-h-10 px-3 text-sm" onClick={() => { setCrop(null); onSelect(null); }}>Back to crop</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-workspace-muted">Move the corners around your signature. Use arrow keys when a corner has focus.</p>
      <div className="rounded-xl bg-slate-100 p-6">
        <div ref={surface} className="relative mx-auto w-fit max-w-full">
          <img ref={image} src={source} alt="Photo to crop" draggable={false} className="block max-h-[50vh] max-w-full select-none object-contain" />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className="pointer-events-none absolute inset-0 size-full">
            <polygon points={corners.map(point => `${point.x * 100},${point.y * 100}`).join(' ')} fill="none" stroke="#0f766e" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
          {corners.map((point, index) => (
            <button key={cornerNames[index]} type="button" aria-label={`${cornerNames[index]} crop corner`}
              className="absolute grid size-11 -translate-x-1/2 -translate-y-1/2 touch-none place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-teal-800"
              style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
              onPointerDown={event => {
                if (!event.isPrimary || event.button !== 0 || pointer.current !== null) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                pointer.current = event.pointerId;
              }}
              onPointerMove={event => {
                if (pointer.current !== event.pointerId || !surface.current) return;
                const bounds = surface.current.getBoundingClientRect();
                moveCorner(index, { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height });
              }}
              onLostPointerCapture={event => { if (pointer.current === event.pointerId) pointer.current = null; }}
              onKeyDown={event => {
                const directions: Record<string, CropPoint> = {
                  ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 }, ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
                };
                const direction = directions[event.key];
                if (!direction) return;
                event.preventDefault();
                const step = event.shiftKey ? 0.05 : 0.01;
                moveCorner(index, { x: point.x + direction.x * step, y: point.y + direction.y * step });
              }}>
              <span className="size-4 rounded-full border-2 border-white bg-teal-700 shadow ring-1 ring-teal-800" />
            </button>
          ))}
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
      <button type="button" className="workspace-primary min-h-11 px-4 text-sm font-semibold" onClick={() => {
        if (!image.current?.naturalWidth) return;
        try {
          const result = rectifySignature(image.current, corners);
          const cleanedImage = cleanSignature(result, darkness);
          setSelected(cleanedImage ? 'cleaned' : 'original');
          setCrop(result);
          onSelect(cleanedImage || result.toDataURL('image/png'));
          setError('');
        } catch (failure) {
          setError(failure instanceof Error ? failure.message : 'Could not crop this image.');
        }
      }}>Preview crop</button>
    </div>
  );
}
