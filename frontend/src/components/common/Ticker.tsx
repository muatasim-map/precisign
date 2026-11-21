import { useEffect, useRef } from 'react';

/**
 * A count that rolls into place when it changes after first paint (tabular digits, no layout shift).
 * It rolls up when the number grows and down when it shrinks, so the direction matches the change.
 */
export function Ticker({ value, className = '' }: { value: number; className?: string }) {
  const previous = useRef(value);
  const direction = value > previous.current ? 'up' : value < previous.current ? 'down' : undefined;
  useEffect(() => { previous.current = value; }, [value]);
  return <span key={value} className={`ticker ${className}`} data-changed={!!direction} data-direction={direction}>{value}</span>;
}
