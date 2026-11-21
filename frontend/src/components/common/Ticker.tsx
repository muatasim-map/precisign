import { useEffect, useRef } from 'react';

/** A count that rolls up into place when it changes after first paint (tabular digits, no layout shift). */
export function Ticker({ value, className = '' }: { value: number; className?: string }) {
  const previous = useRef(value);
  const changed = previous.current !== value;
  useEffect(() => { previous.current = value; }, [value]);
  return <span key={value} className={`ticker ${className}`} data-changed={changed}>{value}</span>;
}
