import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * Mobile bottom sheet: slides up on the iOS-style drawer curve and is dismissed by Escape, the
 * backdrop, the close button, or a downward drag. A quick flick (velocity > 0.11px/ms) is enough;
 * dragging up past the top meets increasing resistance instead of a hard stop. Only the first
 * pointer drives the drag, and the sheet captures it so the drag survives leaving the element.
 */
export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; at: number; id: number } | null>(null);
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = window.setTimeout(() => setMounted(false), 380);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    sheet.current?.querySelector<HTMLElement>('select, input, button:not([data-sheet-close])')?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  return createPortal(
    <>
      <div className="sheet-backdrop no-print" data-open={shown} onClick={onClose} />
      <div ref={sheet} role="dialog" aria-modal="true" aria-label={title} className="sheet no-print" data-open={shown}
        onPointerDown={event => {
          if (drag.current || !(event.target as HTMLElement).closest('[data-sheet-drag]') || (event.target as HTMLElement).closest('button')) return;
          drag.current = { y: event.clientY, at: Date.now(), id: event.pointerId };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={event => {
          if (!drag.current || event.pointerId !== drag.current.id || !sheet.current) return;
          const raw = event.clientY - drag.current.y;
          const offset = raw >= 0 ? raw : -Math.sqrt(-raw) * 2; // friction above the top
          sheet.current.style.transition = 'none';
          sheet.current.style.transform = `translateY(${offset}px)`;
        }}
        onPointerUp={event => {
          if (!drag.current || event.pointerId !== drag.current.id || !sheet.current) return;
          const distance = event.clientY - drag.current.y;
          const velocity = Math.abs(distance) / Math.max(1, Date.now() - drag.current.at);
          drag.current = null;
          sheet.current.style.transition = '';
          sheet.current.style.transform = '';
          if (distance > 0 && (distance > 120 || velocity > 0.11)) onClose();
        }}>
        <div data-sheet-drag className="sheet-drag">
        <div className="sheet-handle" aria-hidden="true" />
        <div className="flex items-center justify-between px-4 pb-2">
          <h2 className="text-sm font-semibold text-workspace-ink">{title}</h2>
          <button type="button" data-sheet-close aria-label="Close" className="preci-press grid size-9 place-items-center rounded-md text-workspace-muted" onClick={onClose}><X aria-hidden="true" className="size-4" /></button>
        </div>
        </div>
        <div className="overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </>,
    document.body,
  );
}
