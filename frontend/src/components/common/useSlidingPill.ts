import { useLayoutEffect, useRef } from 'react';

/**
 * One pill that slides behind the pressed button of a segmented control. It is measured from
 * the DOM and moved with transform (its width follows the pressed button), so switching reads
 * as one surface moving instead of two backgrounds swapping. Returns refs for the group and pill.
 */
export function useSlidingPill<T extends HTMLElement = HTMLDivElement>() {
  const group = useRef<T>(null);
  const pill = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const place = () => {
      const pressed = group.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
      const element = pill.current;
      if (!element) return;
      if (!pressed) { element.style.opacity = '0'; return; }
      element.style.opacity = '1';
      element.style.width = pressed.offsetWidth + 'px';
      element.style.height = pressed.offsetHeight + 'px';
      element.style.transform = `translate(${pressed.offsetLeft}px, ${pressed.offsetTop}px)`;
    };
    place();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    if (group.current) observer?.observe(group.current);
    return () => observer?.disconnect();
  });
  return { group, pill };
}
