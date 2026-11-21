import { forwardRef, useId, type ComponentProps, type ComponentType, type ReactNode } from 'react';
import { AlertCircle, ChevronDown, Loader2 } from 'lucide-react';

export interface FormFieldProps {
  id?: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  error?: string;
  className?: string;
  children: ReactNode;
}

export function FormField({
  id: explicitId,
  label,
  required,
  optional,
  hint,
  error,
  className = '',
  children,
}: FormFieldProps) {
  const generatedId = useId();
  const id = explicitId || generatedId;

  return (
    <div className={`space-y-1.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-semibold text-slate-800">
          {label}
          {required && <span className="ml-1 text-rose-600 font-bold" aria-hidden="true">*</span>}
        </label>
        {optional && (
          <span className="text-xs font-normal text-slate-500">Optional</span>
        )}
      </div>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-slate-500 leading-relaxed">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="flex items-center gap-1.5 text-xs font-semibold text-rose-700">
          <AlertCircle className="size-3.5 shrink-0 text-rose-600" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

export const EditorInput = forwardRef<HTMLInputElement, ComponentProps<'input'>>(function EditorInput(
  { className = '', type = 'text', ...props },
  ref
) {
  return (
    <input
      ref={ref}
      type={type}
      data-slot="input"
      className={`workspace-control block w-full min-w-0 rounded-lg border border-slate-300 bg-slate-50/80 px-3 py-2 text-sm text-[#16283a] shadow-xs transition-colors placeholder:text-slate-400 hover:bg-white hover:border-slate-400 focus-visible:bg-white focus-visible:border-teal-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-700 aria-invalid:border-rose-500 aria-invalid:bg-rose-50/60 aria-invalid:text-rose-900 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed read-only:bg-slate-100/80 read-only:border-slate-200 read-only:text-slate-700 read-only:cursor-default ${className}`}
      {...props}
    />
  );
});

export const EditorTextarea = forwardRef<HTMLTextAreaElement, ComponentProps<'textarea'>>(function EditorTextarea(
  { className = '', rows = 4, ...props },
  ref
) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      data-slot="textarea"
      className={`workspace-control block w-full min-w-0 rounded-lg border border-slate-300 bg-slate-50/80 px-3 py-2 text-sm text-[#16283a] shadow-xs transition-colors placeholder:text-slate-400 hover:bg-white hover:border-slate-400 focus-visible:bg-white focus-visible:border-teal-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-700 aria-invalid:border-rose-500 aria-invalid:bg-rose-50/60 aria-invalid:text-rose-900 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed resize-y ${className}`}
      {...props}
    />
  );
});

export interface EditorSelectProps extends ComponentProps<'select'> {
  containerClassName?: string;
}

export const EditorSelect = forwardRef<HTMLSelectElement, EditorSelectProps>(function EditorSelect(
  { className = '', containerClassName = '', children, ...props },
  ref
) {
  return (
    <div className={`relative w-full ${containerClassName}`}>
      <select
        ref={ref}
        data-slot="native-select"
        className={`workspace-control block w-full min-w-0 appearance-none rounded-lg border border-slate-300 bg-slate-50/80 pl-3 pr-10 py-2 text-sm text-[#16283a] shadow-xs transition-colors hover:bg-white hover:border-slate-400 focus-visible:bg-white focus-visible:border-teal-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-700 aria-invalid:border-rose-500 aria-invalid:bg-rose-50/60 aria-invalid:text-rose-900 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed truncate ${className}`}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 size-4 text-slate-500 shrink-0"
      />
    </div>
  );
});

export interface ActionButtonProps extends ComponentProps<'button'> {
  variant?: 'primary' | 'secondary' | 'quiet' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
  busyText?: string;
  icon?: ComponentType<{ className?: string; size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
  {
    type = 'button',
    variant = 'secondary',
    size = 'md',
    busy = false,
    busyText,
    icon: Icon,
    className = '',
    children,
    disabled,
    ...props
  },
  ref
) {
  const variantClass = {
    primary: 'workspace-btn-primary',
    secondary: 'workspace-btn-secondary',
    quiet: 'workspace-btn-quiet',
    danger: 'workspace-btn-danger',
  }[variant];

  const sizeClass = {
    sm: 'workspace-btn-sm',
    md: 'workspace-btn-md',
    lg: 'workspace-btn-lg',
  }[size];

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`workspace-btn preci-press ${variantClass} ${sizeClass} ${className}`}
      {...props}
    >
      {busy ? (
        <>
          <Loader2 className="size-4 animate-spin shrink-0 text-current" aria-hidden="true" />
          <span>{busyText ?? children}</span>
        </>
      ) : (
        <>
          {Icon && <Icon className="size-4 shrink-0 text-current" aria-hidden="true" />}
          {children}
        </>
      )}
    </button>
  );
});
