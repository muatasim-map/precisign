import express, { Router } from 'express';
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { normalizeEmail, tokenHash, registerAccount } from './auth';
import { transaction } from './db';
import { fields, RequestError, text } from './requestValidation';
import type { AsyncDatabase, AsyncQueryConnection } from './asyncDatabase';

import { accountChangeAudit, emailChangeStatements, notifyPreviousEmail } from './accountIdentity';
import type { IEmailTransport } from './email';
import { processorTaskLabels } from '../../shared/utils/processorHandoff';

const companies = ['PEW', 'ICCL', 'FSG'];
const forms = ['Administrative & Payment Request', 'IT Request', 'Cash Voucher', 'Expense Claim', 'R&D Initiative', 'Admin Work Request'];

export function accountAdminRoutes(db: DatabaseSync | AsyncDatabase, origin: string, now: () => number, transport?: IEmailTransport) {
  const router = Router();
  router.use('/admin/accounts', (_req, res, next) => {
    if (!res.locals.user.isSuperAdmin) { next(new RequestError(403, 'Administrator required.')); return; }
    next();
  });
  router.get('/admin/accounts', async (_req, res, next) => {
    try {
    const sql = `SELECT id,name,email,notification_email,department,COALESCE(role_override,role) AS effective_role,company_grants,form_grants,is_super_admin,is_disabled,group_admin,company_permissions,job_title,route_rights,company_id,allowed_companies,
      EXISTS(SELECT 1 FROM route_administrators WHERE user_id=account_profiles.id) AS is_route_admin,
      (SELECT json_group_array(json_object('id', id, 'oldName', old_name, 'newName', new_name, 'changedAt', changed_at))
       FROM (SELECT * FROM account_name_changes WHERE user_id = account_profiles.id ORDER BY id DESC)) AS name_history,
      (SELECT json_group_array(json_object('id', id, 'actorId', actor_id, 'field', field,
        'oldValue', old_value, 'newValue', new_value, 'changedAt', changed_at))
       FROM (SELECT * FROM account_identity_changes WHERE user_id=account_profiles.id ORDER BY id DESC)) AS identity_history
      FROM account_profiles ORDER BY name COLLATE NOCASE, id`;
    const accounts = 'prepare' in db ? db.prepare(sql).all() : (await db.execute(sql)).rows;
    res.json(accounts.map(row => ({
      id: row.id, name: row.name, email: row.email, notificationEmail: row.notification_email ? String(row.notification_email) : undefined, department: row.department, role: row.effective_role,
      jobTitle: row.job_title ?? undefined,
      routeRights: typeof row.route_rights === 'string' ? JSON.parse(row.route_rights) : undefined,
      companyId: row.company_id,
      allowedCompanyIds: JSON.parse(String(row.allowed_companies)),
      companyGrants: typeof row.company_grants === 'string' ? JSON.parse(row.company_grants) : null,
      formGrants: typeof row.form_grants === 'string' ? JSON.parse(row.form_grants) : null,
      companyPermissions: typeof row.company_permissions === 'string' ? JSON.parse(row.company_permissions) : undefined,
      isSuperAdmin: row.is_super_admin === 1,
      isDisabled: row.is_disabled === 1,
      isGroupAdmin: row.group_admin === 1,
      identityHistory: JSON.parse(String(row.identity_history)),
      nameHistory: JSON.parse(String(row.name_history)),
      isRouteAdmin: (row as any).is_route_admin === 1,
    })));
    } catch (error) { next(error); }
  });
  router.post('/admin/accounts', express.json({ limit: '3mb' }), async (req, res, next) => {
    try {
      fields(req.body, ['name', 'email', 'department', 'password', 'role', 'mustChangePassword', 'signatureDataUrl']);
      const { name, email, department, password, role, signatureDataUrl } = req.body ?? {};
      const staffRole = role === 'Admin' || role === 'IT' || role === 'Finance' ? role : 'Employee';
      const requireSuperAdmin = 'prepare' in db
        ? () => {
            const actor = res.locals.requireCurrentUser();
            if (!actor.isSuperAdmin) throw new RequestError(403, 'Administrator required.');
          }
        : async (tx: AsyncQueryConnection) => {
            const actor = await res.locals.requireCurrentUserAsync(tx);
            if (!actor.isSuperAdmin) throw new RequestError(403, 'Administrator required.');
          };
      const result = await registerAccount(db, { name, email, department, password, signatureDataUrl }, {
        role: staffRole,
        mustChangePassword: true,
        requireSuperAdmin,
      });
      res.status(201).json(result);
    } catch (error) { next(error); }
  });
  router.patch('/admin/accounts/:id', async (req, res, next) => {
    try {
      fields(req.body, ['name', 'email', 'isDisabled', 'role', 'notificationEmail']);
      const { name, email, isDisabled, role, notificationEmail } = req.body;
      if (role !== undefined && !['Employee', 'Admin', 'IT', 'Finance'].includes(role)) throw new RequestError(400, 'Invalid staff role.');
      if (name === undefined && email === undefined && isDisabled === undefined && role === undefined && notificationEmail === undefined) throw new RequestError(400, 'No change requested.');
      if (isDisabled !== undefined && typeof isDisabled !== 'boolean') throw new RequestError(400, 'Invalid account status.');
      const normalizedName = name === undefined ? undefined : text(name, 150).trim();
      let previousEmail: string | undefined;
      const normalizedEmail = email === undefined ? undefined : normalizeEmail(text(email, 254));
      if (normalizedEmail !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new RequestError(400, 'Invalid email.');
      const normalizedNotificationEmail = notificationEmail === undefined ? undefined : (notificationEmail === null ? null : normalizeEmail(text(notificationEmail, 254)));
      if (normalizedNotificationEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedNotificationEmail)) throw new RequestError(400, 'Invalid notification email.');
      if ('prepare' in db) transaction(db, () => {
        const actor = res.locals.requireCurrentUser();
        if (!actor.isSuperAdmin) throw new RequestError(403, 'Administrator required.');
        const target = db.prepare('SELECT id,name,email,is_super_admin,is_disabled,COALESCE(role_override,role) AS effective_role FROM account_profiles WHERE id=?').get(req.params.id);
        if (!target) throw new RequestError(404, 'Account not found.');
        if (target.is_disabled === null && (email !== undefined || isDisabled !== undefined || role !== undefined || notificationEmail !== undefined)) throw new RequestError(409, 'Legacy account access requires migration.');
        if (role !== undefined && role !== target.effective_role) {
          if (['Director', 'General Manager'].includes(String(target.effective_role))) throw new RequestError(403, 'Leadership roles cannot be changed here.');
          db.prepare('UPDATE users SET role=? WHERE id=?').run(role === 'Employee' ? 'Admin' : role, target.id!);
          db.prepare('UPDATE account_access SET role_override=? WHERE user_id=?').run(role === 'Employee' ? 'Employee' : null, target.id!);
        }
        if (isDisabled === true && target.is_super_admin === 1 && target.is_disabled !== 1) {
          const active = db.prepare('SELECT count(*) AS count FROM account_access WHERE is_super_admin=1 AND is_disabled=0').get()!;
          if (Number(active.count) <= 1) throw new RequestError(409, 'At least one active administrator is required.');
        }
        if (normalizedEmail !== undefined && normalizedEmail !== target.email) {
          const duplicate = db.prepare('SELECT id FROM users WHERE email=? AND id<>?').get(normalizedEmail, target.id!);
          if (duplicate) throw new RequestError(409, 'Email is already in use.');
          previousEmail = String(target.email);
          for (const [sql, args] of emailChangeStatements(String(target.id), actor.id, previousEmail, normalizedEmail, now())) db.prepare(sql).run(...args);
        }
        if (normalizedName !== undefined && normalizedName !== target.name) {
          db.prepare('UPDATE users SET name=? WHERE id=?').run(normalizedName, target.id!);
          const [sql, args] = accountChangeAudit(String(target.id), actor.id, 'name', String(target.name), normalizedName, now());
          db.prepare(sql).run(...args);
        }
        if (isDisabled !== undefined && Number(isDisabled) !== target.is_disabled) {
          if (isDisabled) {
            db.prepare('UPDATE users SET route_rights=NULL WHERE id=?').run(target.id!);
            db.prepare("UPDATE account_access SET is_disabled=1,company_grants='[]',form_grants='{}' WHERE user_id=?").run(target.id!);
            db.prepare('DELETE FROM account_email_pending WHERE user_id=?').run(target.id!);
            db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id!);
            db.prepare('DELETE FROM password_resets WHERE user_id=?').run(target.id!);
          } else {
            db.prepare("UPDATE account_access SET is_disabled=0,company_grants='[]',form_grants='{}' WHERE user_id=?").run(target.id!);
          }
        }
        if (normalizedNotificationEmail !== undefined) {
          db.prepare('UPDATE account_access SET notification_email=? WHERE user_id=?').run(normalizedNotificationEmail, target.id!);
        }
      });
      else await db.transaction(async tx => {
        const actor = await res.locals.requireCurrentUserAsync(tx);
        if (!actor.isSuperAdmin) throw new RequestError(403, 'Administrator required.');
        const target = (await tx.execute('SELECT id,name,email,is_super_admin,is_disabled,COALESCE(role_override,role) AS effective_role FROM account_profiles WHERE id=?', [req.params.id])).rows[0];
        if (!target) throw new RequestError(404, 'Account not found.');
        if (target.is_disabled === null && (email !== undefined || isDisabled !== undefined || role !== undefined || notificationEmail !== undefined)) throw new RequestError(409, 'Legacy account access requires migration.');
        const id = String(target.id);
        if (role !== undefined && role !== target.effective_role) {
          if (['Director', 'General Manager'].includes(String(target.effective_role))) throw new RequestError(403, 'Leadership roles cannot be changed here.');
          await tx.execute('UPDATE users SET role=? WHERE id=?', [role === 'Employee' ? 'Admin' : role, id]);
          await tx.execute('UPDATE account_access SET role_override=? WHERE user_id=?', [role === 'Employee' ? 'Employee' : null, id]);
        }
        if (isDisabled === true && target.is_super_admin === 1 && target.is_disabled !== 1) {
          const active = (await tx.execute('SELECT count(*) AS count FROM account_access WHERE is_super_admin=1 AND is_disabled=0')).rows[0];
          if (Number(active.count) <= 1) throw new RequestError(409, 'At least one active administrator is required.');
        }
        if (normalizedEmail !== undefined && normalizedEmail !== target.email) {
          if ((await tx.execute('SELECT id FROM users WHERE email=? AND id<>?', [normalizedEmail, id])).rows.length) throw new RequestError(409, 'Email is already in use.');
          previousEmail = String(target.email);
          for (const [sql, args] of emailChangeStatements(id, actor.id, previousEmail, normalizedEmail, now())) await tx.execute(sql, args);
        }
        if (normalizedName !== undefined && normalizedName !== target.name) {
          await tx.execute('UPDATE users SET name=? WHERE id=?', [normalizedName, id]);
          const [sql, args] = accountChangeAudit(id, actor.id, 'name', String(target.name), normalizedName, now());
          await tx.execute(sql, args);
        }
        if (isDisabled !== undefined && Number(isDisabled) !== target.is_disabled) {
          await tx.execute("UPDATE account_access SET is_disabled=?,company_grants='[]',form_grants='{}' WHERE user_id=?", [Number(isDisabled), id]);
          if (isDisabled) {
            await tx.execute('UPDATE users SET route_rights=NULL WHERE id=?', [id]);
            await tx.execute('DELETE FROM account_email_pending WHERE user_id=?', [id]);
            await tx.execute('DELETE FROM sessions WHERE user_id=?', [id]);
            await tx.execute('DELETE FROM password_resets WHERE user_id=?', [id]);
          }
        }
        if (normalizedNotificationEmail !== undefined) {
          await tx.execute('UPDATE account_access SET notification_email=? WHERE user_id=?', [normalizedNotificationEmail, id]);
        }
      });
      if (previousEmail && transport) await notifyPreviousEmail(transport, previousEmail);
      res.status(204).end();
    } catch (error) { next(error); }
  });
  router.post('/admin/accounts/:id/reset-link', async (req, res, next) => {
    try {
      const token = randomBytes(32).toString('hex');
      if ('prepare' in db) transaction(db, () => {
        if (!res.locals.requireCurrentUser().isSuperAdmin) throw new RequestError(403, 'Administrator required.');
        const target = db.prepare('SELECT id,is_disabled FROM account_profiles WHERE id=?').get(req.params.id);
        if (!target) throw new RequestError(404, 'Account not found.');
        if (target.is_disabled === 1) throw new RequestError(409, 'Account is disabled.');
        db.prepare(`INSERT INTO password_resets (user_id,token_hash,expires_at) VALUES (?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at`)
          .run(target.id!, tokenHash(token), now() + 30 * 60 * 1000);
      });
      else await db.transaction(async tx => {
        if (!(await res.locals.requireCurrentUserAsync(tx)).isSuperAdmin) throw new RequestError(403, 'Administrator required.');
        const target = (await tx.execute('SELECT id,is_disabled FROM account_profiles WHERE id=?', [req.params.id])).rows[0];
        if (!target) throw new RequestError(404, 'Account not found.');
        if (target.is_disabled === 1) throw new RequestError(409, 'Account is disabled.');
        await tx.execute(`INSERT INTO password_resets (user_id,token_hash,expires_at) VALUES (?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, expires_at=excluded.expires_at`, [String(target.id), tokenHash(token), now() + 30 * 60 * 1000]);
      });
      res.json({ link: `${origin}/#reset=${token}` });
    } catch (error) { next(error); }
  });
  router.put('/admin/accounts/:id/grants', async (req, res, next) => {
    try {
      fields(req.body, ['companyIds', 'formsByCompany', 'routeRights', 'jobTitle']);
      const { companyIds, formsByCompany, routeRights } = req.body;
      const title = req.body.jobTitle === undefined ? undefined : text(req.body.jobTitle, 150, false).trim();
      if (!Array.isArray(companyIds) || companyIds.some(id => !companies.includes(id)) || new Set(companyIds).size !== companyIds.length ||
        !formsByCompany || typeof formsByCompany !== 'object' || Array.isArray(formsByCompany)) throw new RequestError(400, 'Invalid grants.');
      for (const [company, allowed] of Object.entries(formsByCompany)) {
        if (!companyIds.includes(company) || !Array.isArray(allowed) || allowed.some(form => !forms.includes(form)) || new Set(allowed).size !== allowed.length) throw new RequestError(400, 'Invalid grants.');
      }
      if (routeRights !== undefined) {
        fields(routeRights, companyIds);
        for (const rights of Object.values(routeRights) as Record<string, unknown>[]) {
          fields(rights, ['companyAdmin', 'signerSteps', 'processorTasks']);
          if (rights.companyAdmin !== undefined && typeof rights.companyAdmin !== 'boolean') throw new RequestError(400, 'Invalid company admin grant.');
          for (const [kind, scoped] of Object.entries(rights)) {
            if (kind === 'companyAdmin') continue;
            fields(scoped, forms);
            for (const [form, ids] of Object.entries(scoped as Record<string, unknown>)) {
              if (!Array.isArray(ids) || ids.length > 20 || new Set(ids).size !== ids.length
                || ids.some(id => typeof id !== 'string' || !id.trim() || id.length > 150
                  || (kind === 'processorTasks' && !Object.hasOwn(processorTaskLabels(form), id)))) {
                throw new RequestError(400, 'Invalid signer or processor grant.');
              }
            }
          }
        }
      }
      const rightsSql = 'UPDATE users SET job_title=CASE WHEN ? THEN ? ELSE job_title END,route_rights=CASE WHEN ? THEN ? ELSE route_rights END WHERE id=?';
      const setGrants = 'INSERT INTO account_access (user_id,company_grants,form_grants) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET company_grants=excluded.company_grants,form_grants=excluded.form_grants';
      const lookup = 'SELECT id,is_disabled,route_rights FROM account_profiles WHERE id=?';
      const args = (target: Record<string, unknown>) => {
        if (target.is_disabled === 1 || (target.is_disabled === null && routeRights === undefined)) throw new RequestError(409, 'Account cannot receive grants.');
        const id = String(target.id);
        const current = typeof target.route_rights === 'string' ? JSON.parse(target.route_rights) as Record<string, unknown> : undefined;
        const rights = routeRights ?? (current && Object.fromEntries(Object.entries(current).filter(([company]) => companyIds.includes(company))));
        return { grants: [id, JSON.stringify(companyIds), JSON.stringify(formsByCompany)],
          rights: [Number(title !== undefined), title || null, Number(rights !== undefined), rights === undefined ? null : JSON.stringify(rights), id] };
      };
      if ('prepare' in db) transaction(db, () => {
        if (!res.locals.requireCurrentUser().isSuperAdmin) throw new RequestError(403, 'Administrator required.');
        const target = db.prepare(lookup).get(req.params.id);
        if (!target) throw new RequestError(404, 'Account not found.');
        const values = args(target);
        db.prepare(setGrants).run(...values.grants);
        db.prepare(rightsSql).run(...values.rights);
      });
      else await db.transaction(async tx => {
        if (!(await res.locals.requireCurrentUserAsync(tx)).isSuperAdmin) throw new RequestError(403, 'Administrator required.');
        const target = (await tx.execute(lookup, [req.params.id])).rows[0];
        if (!target) throw new RequestError(404, 'Account not found.');
        const values = args(target);
        await tx.execute(setGrants, values.grants);
        await tx.execute(rightsSql, values.rights);
      });
      res.status(204).end();
    } catch (error) { next(error); }
  });
  return router;
}
