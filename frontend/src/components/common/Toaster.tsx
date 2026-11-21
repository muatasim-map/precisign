import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CheckCircle2, Info, X, AlertTriangle } from 'lucide-react';

type Tone = 'success' | 'info' | 'error';
type ToastItem = { id: number; message: string; tone: Tone; leaving?: boolean };

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());

/** Show a short confirmation. Call from anywhere; the single <Toaster /> renders it. */
export function toast(message: string, tone: Tone = 'success') {
  items = [...items.slice(-2), { id: nextId++, message, tone }];
  emit();
}

function dismiss(id: number) {
  items = items.map(item => item.id === id ? { ...item, leaving: true } : item);
  emit();
  // Exit uses the same path it entered by, then the item is removed.
  window.setTimeout(() => { items = items.filter(item => item.id !== id); emit(); }, 260);
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

/**
 * Sonner-style stack: enters and leaves from the bottom edge, timers pause while hovered or
 * when the tab is hidden, and a quick downward flick dismisses on touch. Transitions, not
 * keyframes, so rapid toasts retarget smoothly. Announced through a polite live region.
 */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => items);
  const [paused, setPaused] = useState(false);
  return (
    <section aria-label="Notifications" className="preci-toaster no-print" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <ol role="status" aria-live="polite" className="preci-toast-list">
        {list.map((item, index) => <ToastCard key={item.id} item={item} depth={list.length - 1 - index} paused={paused} />)}
      </ol>
    </section>
  );
}

function ToastCard({ item, depth, paused }: { item: ToastItem; depth: number; paused: boolean }) {
  const [mounted, setMounted] = useState(false);
  const remaining = useRef(4000);
  const startedAt = useRef(0);
  const drag = useRef<{ y: number; at: number } | null>(null);
  const card = useRef<HTMLLIElement>(null);

  useEffect(() => { const frame = requestAnimationFrame(() => setMounted(true)); return () => cancelAnimationFrame(frame); }, []);
  useEffect(() => {
    if (item.leaving) return undefined;
    const hidden = () => document.visibilityState === 'hidden';
    if (paused || hidden()) return undefined;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => dismiss(item.id), remaining.current);
    const onVisibility = () => { if (hidden()) window.clearTimeout(timer); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      remaining.current = Math.max(800, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, item.id, item.leaving]);

  const Icon = item.tone === 'error' ? AlertTriangle : item.tone === 'info' ? Info : CheckCircle2;
  return (
    <li
      ref={card}
      className="preci-toast"
      data-tone={item.tone}
      data-mounted={mounted && !item.leaving}
      style={{ ['--toast-depth' as string]: depth }}
      onPointerDown={event => {
        if (drag.current || event.pointerType === 'mouse') return; // one finger at a time; mouse uses the close button
        drag.current = { y: event.clientY, at: Date.now() };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!drag.current || !card.current) return;
        const distance = Math.max(0, event.clientY - drag.current.y);
        card.current.style.transition = 'none';
        card.current.style.transform = `translateY(${distance}px)`;
      }}
      onPointerUp={event => {
        if (!drag.current || !card.current) return;
        const distance = Math.max(0, event.clientY - drag.current.y);
        const velocity = distance / Math.max(1, Date.now() - drag.current.at);
        drag.current = null;
        card.current.style.transition = '';
        card.current.style.transform = '';
        if (distance > 40 || velocity > 0.11) dismiss(item.id);
      }}
    >
      <Icon aria-hidden="true" className="preci-toast-icon size-4 shrink-0" />
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{item.message}</span>
      <button type="button" aria-label="Dismiss notification" className="preci-toast-close" onClick={() => dismiss(item.id)}><X aria-hidden="true" className="size-3.5" /></button>
    </li>
  );
}
