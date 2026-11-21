import { useId, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Check, Eye, EyeOff, KeyRound, TriangleAlert } from 'lucide-react';
import { passwordChecks } from '../../../../shared/utils/passwordPolicy';

/**
 * Password input used by every sign-in screen: show/hide, a Caps Lock warning, and (for new
 * passwords) a live checklist of the company rule. The checklist is advisory; the server
 * enforces the same rule from `shared/utils/passwordPolicy.ts`.
 */
export function PasswordField({ label, value, onChange, autoComplete, email, showRules = false, id, describedBy, required = true }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  /** Used to reject the email as a password in the checklist. */
  email?: string;
  showRules?: boolean;
  id?: string;
  describedBy?: string;
  required?: boolean;
}) {
  const generated = useId();
  const fieldId = id ?? generated;
  const [visible, setVisible] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const checks = passwordChecks(value, email);
  const track = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState('CapsLock'));
  return (
    <div>
      <label htmlFor={fieldId} className="preci-field">{label}</label>
      <div className="preci-auth-input">
        <KeyRound aria-hidden="true" />
        <input id={fieldId} type={visible ? 'text' : 'password'} autoComplete={autoComplete} maxLength={1024} required={required}
          aria-describedby={[showRules ? fieldId + '-rules' : '', capsLock ? fieldId + '-caps' : '', describedBy ?? ''].filter(Boolean).join(' ') || undefined}
          value={value}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
          onKeyDown={track} onKeyUp={track} onBlur={() => setCapsLock(false)} />
        <button type="button" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} className="preci-icon-button preci-press" onClick={() => setVisible(current => !current)}>
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
      {capsLock && <p id={fieldId + '-caps'} role="status" className="auth-caps mt-1.5 flex items-center gap-1.5 text-xs font-medium text-amber-800">
        <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" /> Caps Lock is on
      </p>}
      {showRules && <ul id={fieldId + '-rules'} aria-label="Password rules" className="mt-2 space-y-1">
        {checks.map(check => <li key={check.id} className="auth-rule flex items-center gap-2 text-xs" data-ok={check.ok}>
          <span className="auth-rule-dot" aria-hidden="true">{check.ok && <Check className="size-2.5" strokeWidth={3} />}</span>
          <span>{check.label}<span className="sr-only">{check.ok ? ' — done' : ' — not yet'}</span></span>
        </li>)}
      </ul>}
    </div>
  );
}
