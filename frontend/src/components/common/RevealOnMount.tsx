import { useEffect, useState, type ReactNode } from 'react';

/**
 * Opens its content by growing from zero height (grid-rows 0fr→1fr) with a short fade, so expanding
 * a row pushes the content below smoothly instead of jumping. Closing is instant: exits are faster.
 */
export function RevealOnMount({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const frame = requestAnimationFrame(() => setOpen(true)); return () => cancelAnimationFrame(frame); }, []);
  return <div id={id} className={`reveal ${className}`} data-open={open}><div>{children}</div></div>;
}
