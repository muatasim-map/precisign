import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { CompanyId, AdminWorkDraft } from '../../shared/types/index';
import { canUserAccessCompany, canUserStartForm } from '../../shared/utils/companyAccess';
import { transaction } from './db';
import { RequestError, fields, form, attachments } from './requestValidation';
import type { AsyncDatabase, AsyncQueryConnection } from './asyncDatabase';

export function draftRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RequestError(400, 'Invalid draft revision.');
  return Number(value);
}

export function readDraft(db: DatabaseSync, userId: string, companyId: string, formType: string = 'Admin Work Request') {
  const row = db.prepare('SELECT revision,data FROM drafts WHERE user_id=? AND company_id=? AND form_type=?').get(userId, companyId, formType);
  return row ? { revision: Number(row.revision), data: JSON.parse(String(row.data)) } : { revision: 0, data: null };
}

// Called inside the caller's transaction. A tombstone prevents stale writes after clear/submit.
export function writeDraft(db: DatabaseSync, userId: string, companyId: string, expectedRevision: number, data: unknown, formType: string = 'Admin Work Request') {
  const current = readDraft(db, userId, companyId, formType);
  if (current.revision !== expectedRevision) throw new RequestError(409, 'Draft changed in another session.', 'DRAFT_CONFLICT');
  const revision = current.revision + 1;
  db.prepare('INSERT INTO drafts VALUES (?,?,?,?,?) ON CONFLICT(user_id,company_id,form_type) DO UPDATE SET revision=excluded.revision,data=excluded.data')
    .run(userId, companyId, formType, revision, JSON.stringify(data));
  return { revision, data };
}

export async function readDraftAsync(db: AsyncQueryConnection, userId: string, companyId: string, formType: string = 'Admin Work Request') {
  const row = (await db.execute('SELECT revision,data FROM drafts WHERE user_id=? AND company_id=? AND form_type=?', [userId, companyId, formType])).rows[0];
  return row ? { revision: Number(row.revision), data: JSON.parse(String(row.data)) } : { revision: 0, data: null };
}

export async function writeDraftAsync(tx: AsyncQueryConnection, userId: string, companyId: string, expectedRevision: number, data: unknown, formType: string = 'Admin Work Request') {
  const current = await readDraftAsync(tx, userId, companyId, formType);
  if (current.revision !== expectedRevision) throw new RequestError(409, 'Draft changed in another session.', 'DRAFT_CONFLICT');
  const revision = current.revision + 1;
  await tx.execute('INSERT INTO drafts VALUES (?,?,?,?,?) ON CONFLICT(user_id,company_id,form_type) DO UPDATE SET revision=excluded.revision,data=excluded.data',
    [userId, companyId, formType, revision, JSON.stringify(data)]);
  return { revision, data };
}

export function draftRoutes(db: DatabaseSync | AsyncDatabase) {
  const router = Router();
  router.use('/drafts/:companyId/:formType', (req, res, next) => {
    const { companyId, formType } = req.params;
    if (!['PEW','ICCL','FSG'].includes(companyId) || (formType !== 'Admin Work Request' && formType !== 'IT Request')) { next(new RequestError(400, 'Invalid draft key.')); return; }
    if (!canUserAccessCompany(res.locals.user, companyId as CompanyId)) { next(new RequestError(403, 'Company access denied.')); return; }
    if (!canUserStartForm(res.locals.user, companyId as CompanyId, formType)) { next(new RequestError(403, 'Form access denied.')); return; }
    next();
  });
  router.get('/drafts/:companyId/:formType', async (req, res, next) => {
    try {
      res.json('prepare' in db ? readDraft(db, res.locals.user.id, req.params.companyId, req.params.formType)
        : await readDraftAsync(db, res.locals.user.id, req.params.companyId, req.params.formType));
    } catch (error) { next(error); }
  });
  router.put('/drafts/:companyId/:formType', async (req, res, next) => {
    try {
      fields(req.body, ['expectedRevision','data']);
      const expected = draftRevision(req.body.expectedRevision);
      const data = req.body.data;
      if (req.params.formType === 'IT Request') {
        if (!data || typeof data !== 'object') throw new RequestError(400, 'Invalid draft data.');
        if (data.companyId !== undefined && data.companyId !== req.params.companyId) throw new RequestError(400, 'Company mismatch.');
        const rawFields = data.fields && typeof data.fields === 'object' ? data.fields : {};
        const validatedFields = {
          department: typeof rawFields.department === 'string' ? rawFields.department.slice(0, 200) : '',
          requester: typeof rawFields.requester === 'string' ? rawFields.requester.slice(0, 200) : '',
          date: typeof rawFields.date === 'string' ? rawFields.date.slice(0, 50) : '',
          requestType: typeof rawFields.requestType === 'string' ? rawFields.requestType.slice(0, 200) : '',
          priority: typeof rawFields.priority === 'string' ? rawFields.priority.slice(0, 50) : '',
          details: typeof rawFields.details === 'string' ? rawFields.details.slice(0, 10000) : '',
          justification: typeof rawFields.justification === 'string' ? rawFields.justification.slice(0, 10000) : '',
        };
        const validatedChoices: Record<string, string> = {};
        if (data.choices && typeof data.choices === 'object' && !Array.isArray(data.choices)) {
          for (const [k, v] of Object.entries(data.choices)) {
            if (typeof k === 'string' && typeof v === 'string') {
              validatedChoices[k.slice(0, 100)] = v.slice(0, 100);
            }
          }
        }
        const validated = {
          fields: validatedFields,
          choices: validatedChoices,
          companyId: req.params.companyId as CompanyId,
        };
        res.json('prepare' in db ? transaction(db, () => {
          const actor = res.locals.requireCurrentUser();
          if (!canUserAccessCompany(actor, req.params.companyId as CompanyId)) throw new RequestError(403, 'Company access denied.');
          if (!canUserStartForm(actor, req.params.companyId as CompanyId, req.params.formType)) throw new RequestError(403, 'Form access denied.');
          return writeDraft(db, actor.id, req.params.companyId, expected, validated, 'IT Request');
        }) : await db.transaction(async tx => {
          const actor = await res.locals.requireCurrentUserAsync(tx);
          if (!canUserStartForm(actor, req.params.companyId as CompanyId, req.params.formType)) throw new RequestError(403, 'Form access denied.');
          return writeDraftAsync(tx, actor.id, req.params.companyId, expected, validated, 'IT Request');
        }));
        return;
      }
      fields(data, ['dateOfRequest','department','priority','workDescription','documents','companyId','attachments']);
      if (data.companyId !== undefined && data.companyId !== req.params.companyId) throw new RequestError(400, 'Company mismatch.');
      const { attachments: files, companyId: _companyId, ...editable } = data;
      form(editable, true);
      const validated = { ...editable, companyId: req.params.companyId as CompanyId, attachments: await attachments(files, res.locals.user.name) };
      res.json('prepare' in db ? transaction(db, () => {
        const actor = res.locals.requireCurrentUser();
        if (!canUserAccessCompany(actor, req.params.companyId as CompanyId)) throw new RequestError(403, 'Company access denied.');
        if (!canUserStartForm(actor, req.params.companyId as CompanyId, req.params.formType)) throw new RequestError(403, 'Form access denied.');
        return writeDraft(db, actor.id, req.params.companyId, expected, validated, 'Admin Work Request');
      }) : await db.transaction(async tx => {
        const actor = await res.locals.requireCurrentUserAsync(tx);
        if (!canUserStartForm(actor, req.params.companyId as CompanyId, req.params.formType)) throw new RequestError(403, 'Form access denied.');
        return writeDraftAsync(tx, actor.id, req.params.companyId, expected, validated, 'Admin Work Request');
      }));
    } catch (error) { next(error); }
  });
  router.delete('/drafts/:companyId/:formType', async (req, res, next) => {
    try {
      fields(req.body, ['expectedRevision']);
      const expected = draftRevision(req.body.expectedRevision);
      res.json('prepare' in db ? transaction(db, () => writeDraft(db, res.locals.user.id, req.params.companyId, expected, null, req.params.formType))
        : await db.transaction(async tx => {
          const actor = await res.locals.requireCurrentUserAsync(tx);
          if (!canUserStartForm(actor, req.params.companyId as CompanyId, req.params.formType)) throw new RequestError(403, 'Form access denied.');
          return writeDraftAsync(tx, actor.id, req.params.companyId, expected, null, req.params.formType);
        }));
    } catch (error) { next(error); }
  });
  return router;
}
