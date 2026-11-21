import { randomUUID } from 'node:crypto';
import express, { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { accessPermissions } from '../../shared/types';
import type { CompanyId, RequestRecord } from '../../shared/types';
import { canUserAccessCompany } from '../../shared/utils/companyAccess';
import { safeProfile } from './auth';
import type { AsyncDatabase } from './asyncDatabase';
import { transaction } from './db';
import { fields, RequestError, text } from './requestValidation';

type Value = string | number;
export function accessRoleRoutes(db: DatabaseSync | AsyncDatabase) {
  const router = Router();
  const path = '/admin/access-roles';
  const select = async (sql: string) => 'prepare' in db ? db.prepare(sql).all() : (await db.execute(sql)).rows;
  function requireSuperAdmin(user: { isSuperAdmin?: boolean }) {
    if (!user.isSuperAdmin) throw new RequestError(403, 'Super admin access required.');
  }
  router.use(path, (_req, res, next) => {
    requireSuperAdmin(res.locals.user);
    next();
  });
  router.get(path, async (_req, res, next) => {
    try {
      const [roles, assignments, requests] = await Promise.all([
        select('SELECT * FROM access_roles ORDER BY name COLLATE NOCASE'),
        select('SELECT * FROM company_access_roles ORDER BY user_id, company_id'),
        select("SELECT record FROM requests WHERE status='Pending Approval'"),
      ]);
      const activeApprovals = requests.flatMap(row => {
        const request = JSON.parse(String(row.record)) as RequestRecord;
        return request.approvalSteps.filter(step => step.assignedUserId && !['Approved', 'Bypassed', 'Rejected'].includes(step.status))
          .map(step => ({ userId: step.assignedUserId!, companyId: request.companyId, requestId: request.id }));
      });
      res.json({
        activeApprovals,
        roles: roles.map(r => ({ id: r.id, name: r.name, permissions: JSON.parse(String(r.permissions)) })),
        assignments: assignments.map(a => ({ userId: a.user_id, companyId: a.company_id, roleIds: JSON.parse(String(a.role_ids)) })),
      });
    } catch (error) { next(error); }
  });
  router.put(path, express.json({ limit: '16kb' }), async (req, res, next) => {
    try {
      fields(req.body, ['id', 'name', 'permissions']);
      const id = req.body.id === undefined ? randomUUID() : text(req.body.id, 80);
      const name = text(req.body.name, 80).trim();
      const permissions = req.body.permissions;
      if (!Array.isArray(permissions) || permissions.length > accessPermissions.length
        || permissions.some(p => !accessPermissions.includes(p)) || new Set(permissions).size !== permissions.length) {
        throw new RequestError(400, 'Choose valid role permissions.');
      }
      const duplicate = 'SELECT id FROM access_roles WHERE name=? COLLATE NOCASE AND id<>?';
      const exists = 'SELECT id FROM access_roles WHERE id=?';
      const save = 'INSERT INTO access_roles VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, permissions=excluded.permissions';
      const args: Value[] = [id, name, JSON.stringify(permissions)];
      const validate = (existing: unknown, conflicting: unknown) => {
        if (req.body.id !== undefined && !existing) throw new RequestError(404, 'Role not found.');
        if (conflicting) throw new RequestError(409, 'A role already has that name.');
      };
      if ('prepare' in db) transaction(db, () => {
        requireSuperAdmin(res.locals.requireCurrentUser());
        validate(db.prepare(exists).get(id), db.prepare(duplicate).get(name, id));
        db.prepare(save).run(...args);
      });
      else await db.transaction(async tx => {
        requireSuperAdmin(await res.locals.requireCurrentUserAsync(tx));
        validate((await tx.execute(exists, [id])).rows[0], (await tx.execute(duplicate, [name, id])).rows[0]);
        await tx.execute(save, args);
      });
      res.status(204).end();
    } catch (error) { next(error); }
  });
  router.put(path + '/assignments', express.json({ limit: '16kb' }), async (req, res, next) => {
    try {
      fields(req.body, ['userId', 'companyId', 'roleIds']);
      const userId = text(req.body.userId, 128);
      const { companyId, roleIds } = req.body;
      if (!['PEW', 'ICCL', 'FSG'].includes(companyId) || !Array.isArray(roleIds) || roleIds.length > 50
        || roleIds.some(id => typeof id !== 'string' || id.length > 80) || new Set(roleIds).size !== roleIds.length) {
        throw new RequestError(400, 'Choose a company and valid roles.');
      }
      const profile = 'SELECT * FROM account_profiles WHERE id=? AND COALESCE(is_disabled,0)=0';
      const roles = 'SELECT id FROM access_roles';
      const save = 'INSERT INTO company_access_roles VALUES (?,?,?) ON CONFLICT(user_id, company_id) DO UPDATE SET role_ids=excluded.role_ids';
      const args: Value[] = [userId, companyId, JSON.stringify(roleIds)];
      const validate = (row: Parameters<typeof safeProfile>[0] | undefined, available: { id: unknown }[]) => {
        if (!row || !canUserAccessCompany(safeProfile(row), companyId as CompanyId)) throw new RequestError(400, 'The employee needs access to this company first.');
        if (roleIds.some(id => !available.some(role => role.id === id))) throw new RequestError(400, 'A selected role no longer exists.');
      };
      if ('prepare' in db) transaction(db, () => {
        requireSuperAdmin(res.locals.requireCurrentUser());
        validate(db.prepare(profile).get(userId), db.prepare(roles).all() as { id: unknown }[]);
        db.prepare(save).run(...args);
      });
      else await db.transaction(async tx => {
        requireSuperAdmin(await res.locals.requireCurrentUserAsync(tx));
        validate((await tx.execute(profile, [userId])).rows[0], (await tx.execute(roles)).rows as unknown as { id: unknown }[]);
        await tx.execute(save, args);
      });
      res.status(204).end();
    } catch (error) { next(error); }
  });
  return router;
}
