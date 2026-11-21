/** Company password rule, shared by the sign-in screens and the server. */
export const PASSWORD_MIN = 5;
export const PASSWORD_MAX = 1024;

const sameAsEmail = (password: string, email?: string) => {
  if (!email) return false;
  const value = password.trim().toLowerCase();
  const address = email.trim().toLowerCase();
  return value === address || (address.includes('@') && value === address.split('@')[0]);
};

/**
 * Each check the screens show as a checklist. The email rule is listed only when the screen knows
 * the account's email (sign-up and first sign-in); on a reset link the server enforces it instead.
 */
export function passwordChecks(password: string, email?: string) {
  const checks = [{ id: 'length', label: `At least ${PASSWORD_MIN} characters`, ok: password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX }];
  if (email) checks.push({ id: 'email', label: 'Not your email address', ok: password.length > 0 && !sameAsEmail(password, email) });
  return checks;
}

/** Null when the password is acceptable, otherwise a plain-language reason. */
export function passwordProblem(password: unknown, email?: string): string | null {
  if (typeof password !== 'string' || password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (sameAsEmail(password, email)) return 'Don’t use your email address as your password.';
  return null;
}
