import React, { useId, useState, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';

export function useFieldErrors() {
  const prefix = useId();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const focusField = useCallback((key: string) => {
    const targetId = prefix + '-' + key;
    let attempts = 0;
    const tryFocus = () => {
      const el = document.getElementById(targetId);
      if (el) {
        // If element is inside a group or custom container, check if it or an interactive child is displayed
        const isVisible = el.offsetParent !== null || el.getClientRects().length > 0;
        if (isVisible) {
          // If element is a container (e.g. role="group"), focus either the first button/input inside or the container
          const target = (el.matches('input, select, textarea, button') ? el : el.querySelector('button, input, [tabindex="0"]')) || el;
          (target as HTMLElement).focus({ preventScroll: false });
          if (document.activeElement === target || document.activeElement === el) return;
        }
      }
      if (attempts++ < 10) {
        requestAnimationFrame(tryFocus);
      } else {
        // If the invalid field cannot be focused after layout renders, focus the accessible error summary
        const summary = document.getElementById(prefix + '-summary');
        summary?.focus();
      }
    };
    requestAnimationFrame(tryFocus);
  }, [prefix]);

  const validate = useCallback((rules: [string, boolean, string][]) => {
    const next = Object.fromEntries(rules.filter(([, valid]) => !valid).map(([key, , message]) => [key, message]));
    setErrors(next);
    const first = Object.keys(next)[0];
    if (first) {
      focusField(first);
    }
    return !first;
  }, [focusField]);

  const clear = useCallback(() => {
    setErrors({});
  }, []);

  function checkField(key: string, valid: boolean, error: string) {
    setErrors(current => {
      if (!valid) return current[key] === error ? current : { ...current, [key]: error };
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  const props = (key: string) => ({
    id: prefix + '-' + key,
    'aria-invalid': !!errors[key],
    'aria-describedby': errors[key] ? prefix + '-' + key + '-error' : undefined,
  });

  const message = (key: string) =>
    errors[key] ? (
      <p id={prefix + '-' + key + '-error'} role="alert" className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-rose-700">
        <AlertCircle className="size-3.5 shrink-0 text-rose-600" aria-hidden="true" />
        <span>{errors[key]}</span>
      </p>
    ) : null;

  const summary = () => {
    const keys = Object.keys(errors);
    if (!keys.length) return null;
    return (
      <div
        id={prefix + '-summary'}
        role="alert"
        aria-live="assertive"
        tabIndex={-1}
        className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 space-y-1.5 focus:outline-none focus:ring-2 focus:ring-rose-500"
      >
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="size-4 shrink-0 text-rose-600" aria-hidden="true" />
          <span>Please correct the {keys.length} highlighted error{keys.length > 1 ? 's' : ''} before submitting:</span>
        </div>
        <ul className="list-disc list-inside ps-5 text-[11px] text-rose-700 space-y-0.5">
          {keys.map(key => (
            <li key={key}>
              <button
                type="button"
                onClick={() => focusField(key)}
                className="underline hover:text-rose-900 cursor-pointer text-left"
              >
                {errors[key]}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return { validate, clear, checkField, props, message, summary, focusField, errors, hasErrors: Object.keys(errors).length > 0 };
}
