import { useLayoutEffect, useRef } from 'react';

/**
 * Moves a pill element onto a target without animating when `animate` is false (first paint,
 * resize): the transition is switched off for one frame, the position is applied and flushed,
 * then the stylesheet transition is restored. Only a real change of selection slides.
 */
export function placePill(element: HTMLElement, apply: () => void, animate: boolean) {
  if (animate) { apply(); return; }
  element.style.transition = 'none';
  apply();
  void element.offsetWidth; // flush so the snapped position is committed before transitions return
  element.style.transition = '';
}

/**
 * One pill that slides behind the pressed button of a segmented control. It is measured from
 * the DOM and moved with transform (its width follows the pressed button), so switching reads
 * as one surface moving instead of two backgrounds swapping. It appears in place on first paint
 * and follows resizes instantly; only a change of the pressed button animates.
 */
export function useSlidingPill<T extends HTMLElement = HTMLDivElement>({ underline = false }: { underline?: boolean } = {}) {
  const group = useRef<T>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const placed = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const place = (fromResize: boolean) => {
      const pressed = group.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
      const element = pill.current;
      if (!element) return;
      if (!pressed) { element.style.opacity = '0'; placed.current = null; return; }
      const animate = !fromResize && placed.current !== null && placed.current !== pressed;
      placed.current = pressed;
      placePill(element, () => {
        element.style.opacity = '1';
        element.style.width = pressed.offsetWidth + 'px';
        // Underline tabs get a 2px bar along the pressed tab's bottom edge instead of a full pill.
        const height = underline ? 2 : pressed.offsetHeight;
        element.style.height = height + 'px';
        element.style.transform = `translate(${pressed.offsetLeft}px, ${pressed.offsetTop + pressed.offsetHeight - height}px)`;
      }, animate);
    };
    place(false);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => place(true));
    if (group.current) observer?.observe(group.current);
    return () => observer?.disconnect();
  });
  return { group, pill };
}
