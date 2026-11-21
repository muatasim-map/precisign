import { forwardRef, useEffect, useRef, useState, type ComponentProps, type ComponentType, type ReactNode } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';

export type MorphState = 'idle' | 'busy' | 'done' | 'error';

/**
 * Derives a button's visual state from the caller's own busy flag: when busy ends without
 * a failure, show "done" briefly, then settle back to idle. Behaviour stays with the caller.
 */
export function useMorphState(busy: boolean, failed = false, doneMs = 1200): MorphState {
  const [done, setDone] = useState(false);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy && !failed) {
      setDone(true);
      const timer = window.setTimeout(() => setDone(false), doneMs);
      wasBusy.current = busy;
      return () => window.clearTimeout(timer);
    }
    wasBusy.current = busy;
    return undefined;
  }, [busy, failed, doneMs]);
  if (busy) return 'busy';
  if (failed) return 'error';
  return done ? 'done' : 'idle';
}

type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;

export interface MorphButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  state: MorphState;
  /** Idle label, which is also the button's accessible name. */
  children: ReactNode;
  busyLabel?: ReactNode;
  doneLabel?: ReactNode;
  errorLabel?: ReactNode;
  icon?: Icon;
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Button whose label and icon morph between idle → busy → done (or error) with a short blur
 * crossfade. All labels share one grid cell, so the button keeps the width of its widest label
 * and never jumps. Only opacity, transform and filter animate; reduced motion keeps the fade.
 */
export const MorphButton = forwardRef<HTMLButtonElement, MorphButtonProps>(function MorphButton(
  { state, children, busyLabel, doneLabel, errorLabel, icon: IdleIcon, variant = 'secondary', size = 'md', className = '', disabled, type = 'button', ...props },
  ref,
) {
  const variantClass = { primary: 'workspace-btn-primary', secondary: 'workspace-btn-secondary', quiet: 'workspace-btn-quiet', danger: 'workspace-btn-danger' }[variant];
  const sizeClass = { sm: 'workspace-btn-sm', md: 'workspace-btn-md', lg: 'workspace-btn-lg' }[size];
  const face = (key: MorphState, content: ReactNode, Glyph?: Icon, spin = false) => (
    <span className="morph-face" data-active={state === key} aria-hidden={state === key ? undefined : true}>
      {Glyph && <Glyph className={'size-4 shrink-0 text-current' + (spin ? ' animate-spin' : '')} aria-hidden="true" />}
      {content}
    </span>
  );
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || state === 'busy'}
      aria-busy={state === 'busy' || undefined}
      data-morph={state}
      className={`workspace-btn preci-press morph-button ${variantClass} ${sizeClass} ${className}`}
      {...props}
    >
      <span className="morph-stack">
        {face('idle', children, IdleIcon)}
        {face('busy', busyLabel ?? children, Loader2, true)}
        {face('done', doneLabel ?? children, Check)}
        {face('error', errorLabel ?? children, AlertCircle)}
      </span>
      {/* Outcomes are announced by each screen's existing status message, so the accessible name stays the idle label. */}
    </button>
  );
});
