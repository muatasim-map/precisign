import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { RequestRecord, UserProfile } from '../../shared/types';
import { canUserAccessCompany } from '../../shared/utils/companyAccess';
import { assignedProcessorIds, canAppearAsProcessor, hasReadHandoff } from '../../shared/utils/processorHandoff';
import { canConfigureSigningRoutes } from '../../shared/utils/workflowAdministration';
import type { AsyncDatabase } from './asyncDatabase';
import { safeProfile } from './auth';
import { transaction } from './db';
import { buildProcessorEmail, enqueueOutboxSync, enqueueOutboxAsync, type OutboxProcessor } from './email';
import { fail, fields, RequestError, text } from './requestValidation';

export function processorHandoffRoutes(db: DatabaseSync | AsyncDatabase, now: () => number, outbox?: OutboxProcessor) {
  const router = Router();
  router.post(['/requests/:id/processor-read', '/requests/:id/processor-reassignment'], async (req, res, next) => {
    try {
      const reassign = req.path.endsWith('/processor-reassignment');
      fields(req.body, reassign ? ['version', 'taskId', 'from', 'to', 'reason'] : ['version']);
      const { version } = req.body;
      if (!Number.isSafeInteger(version) || version < 1) fail('Choose an approved document version.');
      const intent = reassign ? {
        taskId: text(req.body.taskId, 150),
        from: text(req.body.from, 150),
        to: text(req.body.to, 150),
        reason: text(req.body.reason, 2000).trim(),
      } : undefined;
      if (intent && (!intent.reason || intent.from === intent.to)) fail('Choose a different processor and enter a reason.');

      const lookup = 'SELECT record,revision FROM requests WHERE id=?';
      const people = 'SELECT * FROM account_profiles WHERE id=? AND COALESCE(is_disabled,0)=0';
      const update = 'UPDATE requests SET record=? WHERE id=? AND revision=?';
      const apply = (actor: UserProfile, row: Record<string, unknown> | undefined, targetRow?: Record<string, unknown>) => {
        if (!row) throw new RequestError(404, 'Request not found.');
        const record = { ...JSON.parse(String(row.record)) as RequestRecord, revision: Number(row.revision) };
        if (!canUserAccessCompany(actor, record.companyId) || (intent
          ? !canConfigureSigningRoutes(actor, record.companyId)
          : !assignedProcessorIds(record).includes(actor.id))) throw new RequestError(404, 'Request not found.');
        if (record.status !== 'Approved' || version !== record.documentVersion) {
          throw new RequestError(409, 'The approved document changed. Reload it before continuing.', 'REQUEST_CONFLICT');
        }
        const at = new Date(now()).toISOString();
        if (!intent) {
          if (hasReadHandoff(record, actor.id)) return { record, changed: false };
          record.processorReads = [...(record.processorReads ?? []), {
            userId: actor.id, name: actor.name, department: actor.department, version, at,
          }];
          return { record, changed: true };
        }

        const target = targetRow && safeProfile(targetRow);
        const task = record.processorHandoff?.find(candidate => candidate.taskId === intent.taskId);
        if (!task || !task.userIds.includes(intent.from) || hasReadHandoff(record, intent.from)) {
          throw new RequestError(409, 'Only an unread assignment can be reassigned.', 'PROCESSOR_REASSIGNMENT');
        }
        if (!target || task.userIds.includes(target.id) || !canAppearAsProcessor(target, record.companyId, record.formType, task.taskId)) {
          throw new RequestError(400, 'Choose an eligible replacement processor.', 'PROCESSOR_REASSIGNMENT');
        }
        const addedRecipient = !assignedProcessorIds(record).includes(intent.to);
        task.userIds = task.userIds.map(id => id === intent.from ? intent.to : id);
        record.processorReassignments = [...(record.processorReassignments ?? []), { ...intent, actorId: actor.id, at, version }];
        const email = addedRecipient && intent.to !== record.requesterId ? buildProcessorEmail(record, target, now()) : undefined;
        return { record, changed: true, email };
      };

      const result = 'prepare' in db ? transaction(db, () => {
        const result = apply(res.locals.requireCurrentUser(), db.prepare(lookup).get(req.params.id),
          intent ? db.prepare(people).get(intent.to) : undefined);
        if (result.changed) db.prepare(update).run(JSON.stringify(result.record), result.record.id, result.record.revision);
        if (result.email) enqueueOutboxSync(db, [result.email]);
        return result.record;
      }) : await db.transaction(async tx => {
        const result = apply(await res.locals.requireCurrentUserAsync(tx), (await tx.execute(lookup, [req.params.id])).rows[0],
          intent ? (await tx.execute(people, [intent.to])).rows[0] : undefined);
        if (result.changed) await tx.execute(update, [JSON.stringify(result.record), result.record.id, result.record.revision]);
        if (result.email) await enqueueOutboxAsync(tx, [result.email]);
        return result.record;
      });
      if (intent) outbox?.trigger().catch(() => {});
      res.json(intent ? { processorHandoff: result.processorHandoff, processorReads: result.processorReads, processorReassignments: result.processorReassignments } : {
        processorReads: result.processorReads,
      });
    } catch (error) { next(error); }
  });
  return router;
}
