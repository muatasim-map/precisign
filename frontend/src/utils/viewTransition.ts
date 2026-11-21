import { flushSync } from 'react-dom';

/**
 * Opens a request with a shared-element transition: the clicked row's title glides into the
 * request page heading (both carry view-transition-name "request-title" for the swap).
 * Falls back to an instant change without support or with reduced motion.
 */
export function openWithTitleTransition(source: Element | null, open: () => void) {
  const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
  const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const title = source?.closest('[data-request-row]')?.querySelector<HTMLElement>('[data-request-title]');
  if (!doc.startViewTransition || reduce || !title) { open(); return; }
  title.style.viewTransitionName = 'request-title';
  doc.startViewTransition(() => {
    title.style.viewTransitionName = '';
    flushSync(open);
  });
}
