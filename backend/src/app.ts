import express from 'express';
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { readRoutes } from './reads';
import { companyBrandingRoutes } from './companyBranding';
import { accessRoleRoutes } from './accessRoles';
import { accountAdminRoutes } from './accountAdmin';
import { requestRoutes } from './requestRoutes';
import { workflowRoutes } from './workflows';
import { draftRoutes } from './drafts';
import { isDatabaseBusy } from './db';
import { ownSignature, profileRoutes } from './profile';
import type { AttachmentStorage } from './attachmentStorage';
import { fields, RequestError, text } from './requestValidation';
import { changePassword, changePasswordAsync, hashPassword, resetPassword, resetPasswordAsync, revokeSession, sessionUser, sessionUserAsync, signIn, signInAsync, sessionLifetime, tokenHash, sessionExpiry } from './auth';
import type { AsyncDatabase, AsyncQueryConnection } from './asyncDatabase';
import { ownSignatureAsync } from './profile';
import { MockEmailTransport, ResendEmailTransport, OutboxProcessor, type IEmailTransport } from './email';
import { captureBackendError } from './sentry';

export interface ServerConfig {
  origin: string;
  secureCookies: boolean;
  now?: () => number;
  loginLimit?: number;
  emailTransport?: IEmailTransport;
  outboxProcessor?: OutboxProcessor;
  autoStartWorker?: boolean;
  trustProxy?: boolean | number | string;
}

const requestErrorMessages: Partial<Record<number, string>> = {
  400: 'Invalid request data or missing workflow.',
  401: 'Authentication required.',
  403: 'Action not permitted.',
  404: 'Request or action not found.',
  409: 'Request changed. Refresh and review again.',
  413: 'Request is too large.',
  415: 'Unsupported request encoding.',
  503: 'Storage is temporarily unavailable. Try again shortly.',
};

export async function createApp(db: DatabaseSync | AsyncDatabase, config: ServerConfig, attachmentStorage?: AttachmentStorage) {
  const origin = new URL(config.origin).origin;
  const transport = config.emailTransport ?? ((process.env.NODE_ENV === 'test' || process.env.PRECISIGN_EMAIL_MODE === 'mock')
    ? new MockEmailTransport()
    : new ResendEmailTransport());
  if (config.secureCookies && !origin.startsWith('https://')) throw new Error('Secure mode requires an HTTPS origin.');
  const app = express();
  if (config.trustProxy !== undefined) {
    app.set('trust proxy', config.trustProxy);
  }
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  const now = config.now ?? Date.now;
  const attempts = new Map<string, { count: number; until: number }>();
  const dummyHash = await hashPassword('non-account-placeholder-password');
  const cookie = (value: string, maxAge: number) => `precisign_session=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.secureCookies ? '; Secure' : ''}`;
  const token = (raw?: string) => {
    const matches = raw?.split(';').map(item => item.trim()).filter(item => item.startsWith('precisign_session=')) ?? [];
    return matches.length === 1 ? matches[0].slice('precisign_session='.length) : undefined;
  };
  const isAllowedOrigin = (reqOrigin?: string) => {
    if (!reqOrigin) return false;
    if (reqOrigin === origin) return true;
    if (!config.secureCookies) {
      try {
        const parsedReq = new URL(reqOrigin);
        const parsedConfig = new URL(origin);
        const isLoopbackReq = parsedReq.hostname === 'localhost' || parsedReq.hostname === '127.0.0.1' || parsedReq.hostname === '[::1]';
        const isLoopbackConfig = parsedConfig.hostname === 'localhost' || parsedConfig.hostname === '127.0.0.1' || parsedConfig.hostname === '[::1]';
        if (isLoopbackReq && isLoopbackConfig && parsedReq.port === parsedConfig.port && parsedReq.protocol === parsedConfig.protocol) {
          return true;
        }
      } catch {}
    }
    return false;
  };
  app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }); });
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && (!isAllowedOrigin(req.get('Origin')) || req.get('Sec-Fetch-Site') === 'cross-site')) {
      res.status(403).json({ error: 'Cross-origin request rejected.' }); return;
    }
    next();
  });
  const limitAuthAttempts = (login: boolean): express.RequestHandler => (req, res, next) => {
    const time = now();
    for (const [key, entry] of attempts) if (entry.until <= time) attempts.delete(key);
    const key = `${req.path}:${req.ip || 'unknown'}`;
    const entry = attempts.get(key) ?? { count: 0, until: time + 15 * 60 * 1000 };
    // Deliberately loose (owner decision): enough for a busy shared office IP, still stops scripted guessing.
    if ((!attempts.has(key) && attempts.size >= 10000) || entry.count >= (config.loginLimit ?? 30)) {
      const minutes = Math.max(1, Math.ceil((entry.until - time) / 60000));
      res.setHeader('Retry-After', String(minutes * 60));
      res.status(429).json({ error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
      return;
    }
    entry.count++;
    attempts.set(key, entry);
    // Successful sign-ins must not exhaust the shared office IP's failure budget.
    if (login) {
      res.on('finish', () => {
        if (res.statusCode === 200 && attempts.get(key) === entry) entry.count = Math.max(0, entry.count - 1);
      });
    }
    next();
  };
  app.post('/api/auth/signup', (_req, res) => {
    res.status(403).json({ error: 'Account creation is managed by your administrator.' });
  });
  app.post('/api/auth/login', express.json({ limit: '16kb' }), limitAuthAttempts(true), async (req, res, next) => {
    try {
      const { email, password } = req.body ?? {};
      if (typeof email !== 'string' || email.length > 254 || typeof password !== 'string' || password.length > 1024) { res.status(401).json({ error: 'Invalid email or password.' }); return; }
      const session = await ('prepare' in db ? signIn(db, email, password, dummyHash, token(req.get('Cookie')), now) : signInAsync(db, email, password, dummyHash, token(req.get('Cookie')), now));
      if (!session) { res.status(401).json({ error: 'Invalid email or password.' }); return; }
      res.setHeader('Set-Cookie', cookie(session.token, sessionLifetime / 1000));
      res.json({ user: session.user });
    } catch (error) { next(error); }
  });
  app.post('/api/auth/forgot-password', limitAuthAttempts(false), express.json({ limit: '16kb' }), async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    res.status(202).json({ message: 'If this email belongs to an active super admin, check your inbox for a reset link.' });
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    // Sandbox delivers to a substituted address and must never receive reset tokens.
    if (transport instanceof ResendEmailTransport && transport.getMode() !== 'live') return;
    const resetToken = randomBytes(32).toString('hex');
    const hash = tokenHash(resetToken);
    const issuedAt = now();
    const insert = `INSERT INTO password_resets (user_id, token_hash, expires_at)
      SELECT id, ?, ? FROM account_profiles
      WHERE lower(email)=? AND is_super_admin=1 AND coalesce(is_disabled,0)=0
      ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at
      WHERE password_resets.expires_at <= ?`;
    const args = [hash, issuedAt + 30 * 60 * 1000, email, issuedAt] as const;
    try {
      const changes = 'prepare' in db ? db.prepare(insert).run(...args).changes : (await db.execute(insert, [...args])).rowsAffected;
      if (!changes) return;
      const link = `${origin}/#reset=${resetToken}`;
      const result = await transport.send({
        to: email,
        subject: 'Reset your PreciSign password',
        html: `<p><a href="${link}">Reset your PreciSign password</a> within 30 minutes.</p><p>If you did not request this, you can ignore this email.</p>`,
        text: `To reset your PreciSign password, open this link within 30 minutes: ${link}\n\nIf you did not request this, you can ignore this email.`,
        idempotencyKey: `password-reset-${hash}`,
      });
      if (!result.accepted && !result.uncertain) {
        const remove = 'DELETE FROM password_resets WHERE token_hash=?';
        if ('prepare' in db) db.prepare(remove).run(hash);
        else await db.execute(remove, [hash]);
      }
    } catch {
      console.error('Password reset delivery could not be completed.');
    }
  });
  app.post('/api/auth/reset-password', limitAuthAttempts(false), express.json({ limit: '16kb' }), async (req, res, next) => {
    try {
      fields(req.body, ['token', 'newPassword']);
      if ('prepare' in db) await resetPassword(db, text(req.body.token, 64, false), text(req.body.newPassword, 1024, false), now);
      else await resetPasswordAsync(db, text(req.body.token, 64, false), text(req.body.newPassword, 1024, false), now);
      res.setHeader('Set-Cookie', cookie('', 0));
      res.status(204).end();
    } catch (error) { next(error); }
  });
  app.use('/api', async (req, res, next) => {
    try {
    const sessionToken = token(req.get('Cookie'));
    const user = 'prepare' in db ? sessionUser(db, sessionToken, now()) : await sessionUserAsync(db, sessionToken, now());
    if (!user) { res.status(401).json({ error: 'Authentication required.' }); return; }
    // A shared browser cookie may switch accounts in another tab. Never apply old editor data to that account.
    if (req.get('X-PreciSign-User') && req.get('X-PreciSign-User') !== user.id) { res.status(401).json({ error: 'Session identity changed.' }); return; }
    if (user.mustChangePassword && !((req.method === 'GET' && req.path === '/auth/me') || (req.method === 'POST' && ['/auth/logout', '/auth/change-password'].includes(req.path)))) {
      res.status(403).json({ error: 'Change your password to continue.' }); return;
    }
    res.locals.user = user;
    if ('prepare' in db) res.locals.requireCurrentUser = () => {
      const current = sessionUser(db, sessionToken, now());
      if (!current || current.id !== user.id) throw new RequestError(401, 'Authentication required.');
      return current;
    };
    else res.locals.requireCurrentUserAsync = async (tx: AsyncQueryConnection) => {
      const current = await sessionUserAsync(tx, sessionToken, now());
      if (!current || current.id !== user.id) throw new RequestError(401, 'Authentication required.');
      return current;
    };
    next();
    } catch (error) { next(error); }
  });
  // Only authenticated routes need the larger limit for signatures and attachments.
  app.use('/api', express.json({ limit: '18mb' }));
  app.get('/api/auth/me', async (_req, res, next) => { try { const signature = 'prepare' in db ? ownSignature(db, res.locals.user.id) : await ownSignatureAsync(db, res.locals.user.id); res.json({ user: { ...res.locals.user, ...signature }, sessionExpiresAt: await sessionExpiry(db, token(_req.get('Cookie'))) }); } catch (error) { next(error); } });
  app.post('/api/auth/change-password', async (req, res, next) => {
    try {
      fields(req.body, ['currentPassword', 'newPassword']);
      const currentPassword = text(req.body.currentPassword, 1024, false);
      const newPassword = text(req.body.newPassword, 1024, false);
      if ('prepare' in db) await changePassword(db, res.locals.user.id, currentPassword, newPassword, res.locals.requireCurrentUser);
      else await changePasswordAsync(db, res.locals.user.id, currentPassword, newPassword, res.locals.requireCurrentUserAsync);
      res.setHeader('Set-Cookie', cookie('', 0));
      res.status(204).end();
    } catch (error) { next(error); }
  });
  app.post('/api/auth/logout', async (req, res, next) => {
    try { if ('prepare' in db) revokeSession(db, token(req.get('Cookie'))!);
    else await db.execute('DELETE FROM sessions WHERE token_hash=?', [tokenHash(token(req.get('Cookie'))!)]);
    res.setHeader('Set-Cookie', cookie('', 0)); res.status(204).end();
    } catch (error) { next(error); }
  });
  app.use('/api', readRoutes(db, origin, req => token(req.get('Cookie')), attachmentStorage));
  app.use('/api', profileRoutes(db));
  app.use('/api', accountAdminRoutes(db, origin, now));
  app.use('/api', accessRoleRoutes(db));
  app.use('/api', workflowRoutes(db));
  app.use('/api', draftRoutes(db));
  app.use('/api', companyBrandingRoutes(db));
  const outboxProcessor = config.outboxProcessor ?? new OutboxProcessor(db, transport, { now });
  (app as any).outboxProcessor = outboxProcessor;
  if (config.autoStartWorker) {
    outboxProcessor.start();
  }
  app.use('/api', requestRoutes(db, outboxProcessor, now, attachmentStorage));
  app.use((_req, res) => { res.status(404).json({ error: 'Not found.' }); });
  app.use((error: { status?: number; code?: string; message?: string }, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) { next(error); return; }
    if (isDatabaseBusy(error)) {
      res.setHeader('Retry-After', '1');
      res.status(503).json({ error: 'Storage is temporarily busy. Try again shortly.' });
      return;
    }
    const status = typeof error.status === 'number' ? error.status : 500;
    if (status >= 500) {
      captureBackendError(error, { route: _req.path, status, code: error.code });
    }
    const message = requestErrorMessages[status];
    const processorError = error.status === 400 || error.status === 409;
    const expose = (processorError && ['PROCESSOR_SETUP', 'PROCESSOR_SELECTION', 'PROCESSOR_REASSIGNMENT'].includes(error.code ?? '')) || (error.status === 400 && error.code === 'PASSWORD_POLICY');
    const payload: { error: string; code?: string } = { error: (expose ? error.message : message) ?? 'Could not complete request.' };
    if (typeof error.code === 'string') {
      payload.code = error.code;
    }
    res.status(message ? status : 500).json(payload);
  });
  return app;
}
