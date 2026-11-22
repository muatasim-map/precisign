import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Response } from 'express';
import type { AsyncDatabase } from './asyncDatabase';
import { normalizeEmail, tokenHash, verifyPassword } from './auth';
import { transaction } from './db';
import { ResendEmailTransport, type IEmailTransport } from './email';
import { fields, RequestError, text } from './requestValidation';

type Database = DatabaseSync | AsyncDatabase;
type Statement = [string, (string | number)[]];

export function accountChangeAudit(userId: string, actorId: string, field: 'name' | 'email', before: string, after: string, now: number): Statement {
  return ['INSERT INTO account_identity_changes (user_id,actor_id,field,old_value,new_value,changed_at) VALUES (?,?,?,?,?,?)',
    [userId, actorId, field, before, after, new Date(now).toISOString()]];
}

export function emailChangeStatements(userId: string, actorId: string, before: string, after: string, now: number): Statement[] {
  return [
    ['UPDATE users SET email=? WHERE id=?', [after, userId]],
    ['DELETE FROM sessions WHERE user_id=?', [userId]],
    ['DELETE FROM password_resets WHERE user_id=?', [userId]],
    ['DELETE FROM account_email_pending WHERE user_id=?', [userId]],
    [`UPDATE email_outbox SET recipient_email=? WHERE recipient_user_id=? AND recipient_email=? COLLATE NOCASE
      AND status='pending' AND attempts=0
      AND COALESCE(json_extract(payload_json, '$.usesSignInEmail'), 1)=1 AND NOT EXISTS (
        SELECT 1 FROM account_access WHERE user_id=? AND COALESCE(notification_email,'')<>''
      )`, [after, userId, before, userId]],
    accountChangeAudit(userId, actorId, 'email', before, after, now),
  ];
}

function liveDelivery(transport: IEmailTransport) {
  return !(transport instanceof ResendEmailTransport) || transport.getMode() === 'live';
}

export async function notifyPreviousEmail(transport: IEmailTransport, email: string) {
  if (!liveDelivery(transport)) return;
  const message = 'Your PreciSign sign-in email has changed. Contact your administrator immediately if you did not request or expect this change.';
  try {
    await transport.send({ to: email, subject: 'PreciSign sign-in email changed', text: message, html: '<p>' + message + '</p>', idempotencyKey: 'account-email-notice-' + randomBytes(16).toString('hex') });
  } catch {
    // The email change is already committed.
  }
}

export async function requestOwnEmailChange(db: Database, res: Response, body: unknown, origin: string, now: () => number, transport: IEmailTransport) {
  fields(body, ['email', 'currentPassword']);
  const input = body as Record<string, unknown>;
  const email = normalizeEmail(text(input.email, 254));
  const currentPassword = text(input.currentPassword, 1024);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RequestError(400, 'Enter a valid email address.');
  if (!liveDelivery(transport)) throw new RequestError(503, 'Email verification is unavailable.');
  const userId = String(res.locals.user.id);
  const lookup = 'SELECT password_hash FROM users WHERE id=?';
  const credentials = 'prepare' in db ? db.prepare(lookup).get(userId) : (await db.execute(lookup, [userId])).rows[0];
  if (!credentials || !await verifyPassword(currentPassword, String(credentials.password_hash))) throw new RequestError(403, 'Current password is incorrect.');

  const token = randomBytes(32).toString('hex');
  const hash = tokenHash(token);
  const write = `INSERT INTO account_email_pending (user_id,email,token_hash,expires_at)
    SELECT id,?,?,? FROM users WHERE id=? AND password_hash=? AND email<>?
      AND NOT EXISTS (SELECT 1 FROM users WHERE email=?)
    ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,token_hash=excluded.token_hash,expires_at=excluded.expires_at`;
  const args = [email, hash, now() + 30 * 60 * 1000, userId, String(credentials.password_hash), email, email] as const;
  const saved = 'prepare' in db ? transaction(db, () => {
    res.locals.requireCurrentUser();
    return db.prepare(write).run(...args).changes;
  }) : await db.transaction(async tx => {
    await res.locals.requireCurrentUserAsync(tx);
    return (await tx.execute(write, [...args])).rowsAffected;
  });
  if (!saved) throw new RequestError(409, 'Choose an unused email address different from your current address, or sign in again if your password changed.');

  const link = origin + '/#confirm-email=' + token;
  try {
    const result = await transport.send({
      to: email,
      subject: 'Confirm your new PreciSign email',
      text: 'Confirm your new sign-in email within 30 minutes: ' + link,
      html: '<p><a href="' + link + '">Confirm your new PreciSign sign-in email</a> within 30 minutes.</p>',
      idempotencyKey: 'account-email-confirm-' + hash,
    });
    if (result.accepted || result.uncertain) return;
  } catch {
    // Handle a failed delivery like a transport rejection.
  }
  const remove = 'DELETE FROM account_email_pending WHERE token_hash=?';
  if ('prepare' in db) db.prepare(remove).run(hash);
  else await db.execute(remove, [hash]);
  throw new RequestError(503, 'Could not send the verification email. Try again.');
}

export async function confirmOwnEmailChange(db: Database, body: unknown, now: () => number, transport: IEmailTransport) {
  fields(body, ['token']);
  const token = text((body as Record<string, unknown>).token, 64);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new RequestError(400, 'Invalid or expired email confirmation link.');
  const read = `SELECT pending.user_id, pending.email AS new_email, account.email AS old_email
    FROM account_email_pending pending JOIN account_profiles account ON account.id=pending.user_id
    WHERE pending.token_hash=? AND pending.expires_at>? AND COALESCE(account.is_disabled,0)=0
      AND COALESCE(account.must_change_password,0)=0
      AND NOT EXISTS (SELECT 1 FROM users WHERE email=pending.email)`;
  const time = now();
  const hash = tokenHash(token);
  const statements = (row: Record<string, unknown> | undefined) => {
    if (!row) throw new RequestError(400, 'This email confirmation link expired, was replaced, or the address is already in use.');
    return emailChangeStatements(String(row.user_id), String(row.user_id), String(row.old_email), String(row.new_email), time);
  };
  const previous = 'prepare' in db ? transaction(db, () => {
    const row = db.prepare(read).get(hash, time);
    for (const [sql, args] of statements(row)) db.prepare(sql).run(...args);
    return String(row?.old_email);
  }) : await db.transaction(async tx => {
    const row = (await tx.execute(read, [hash, time])).rows[0];
    for (const [sql, args] of statements(row)) await tx.execute(sql, args);
    return String(row?.old_email);
  });
  await notifyPreviousEmail(transport, previous);
}
