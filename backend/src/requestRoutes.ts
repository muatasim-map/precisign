import { attachmentIdentity, attachmentMetadata, type AttachmentStorage } from './attachmentStorage';
import { saveRndEvaluation } from '../../shared/utils/rndWorkflow';
import { canReadPreciRoute } from '../../shared/utils/routeAccess';
import { proposeSignerReplacement, acceptSignerReplacement } from '../../shared/utils/routeReplacement';
import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './db';
import type { AsyncDatabase } from './asyncDatabase';
import { draftRevision, readDraft, readDraftAsync, writeDraft, writeDraftAsync } from './drafts';
import { RequestError, fail, fields, text, bytes, attachments, form } from './requestValidation';
import { safeProfile } from './auth';
import { processorHandoffRoutes } from './processorHandoffRoutes';
import { assignedProcessorIds, resolveProcessorChoices } from '../../shared/utils/processorHandoff';
import { canAppearAsSigner, canUserAccessCompany, canUserStartForm } from '../../shared/utils/companyAccess';
import { createNewRequestRecord, approveRequestStage, returnRequestForCorrection, rejectRequest, resubmitCorrectedRequest, completePreciRoute, cancelPreciRoute } from '../../shared/utils/workflowEngine';
import type { AdminWorkFormData, AttachmentItem, CompanyId, RequestRecord, UserProfile, WorkflowConfig } from '../../shared/types/index';
import { SUBMITTABLE_FORMS } from '../../shared/types/apiTypes';
import { recordProcessing, processingLabels, processingRequiresSignature, financeHoldActions } from '../../shared/utils/routeProcessing';
import { expenseEvidenceError, preservesExpenseReceipts } from '../../shared/utils/expenseEvidence';
import { applySignerChoices } from '../../shared/utils/signingSelection';
import {
  buildSubmissionEmails,
  buildProcessorEmail,
  buildNextActionEmail,
  buildCompletionEmail,
  buildReplacementActionEmail,
  planTransitionNotification,
  buildNotificationFromPlan,
  enqueueOutboxSync,
  enqueueOutboxAsync,
  type OutboxProcessor,
} from './email';
import { allocateSequenceSync, allocateSequenceAsync, formTypeToPrefix } from './email/requestSequence';
import { emitPostHogLog } from './posthogLogs';

function computeSubmissionHash(
  companyId: string,
  formType: string,
  formData: unknown,
  comment?: string,
  signatureDataUrl?: string,
  signerChoices?: unknown,
  emailNote?: string,
  attachmentsList?: AttachmentItem[],
  processorChoices?: unknown
) {
  const normalized = {
    companyId,
    formType,
    formData,
    comment: comment || '',
    signatureDataUrl: signatureDataUrl || '',
    signerChoices: signerChoices || null,
    emailNote: emailNote || '',
    ...(processorChoices === undefined ? {} : { processorChoices }),
    attachments: (attachmentsList || []).map(a => ({ name: a.name, size: a.sizeBytes, mimeType: a.mimeType })),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function requestRoutes(
  db: DatabaseSync | AsyncDatabase,
  outboxProcessor?: OutboxProcessor,
  now: () => number = Date.now,
  storage?: AttachmentStorage
) {
  const router = Router();
  router.use(processorHandoffRoutes(db, now, outboxProcessor));
  router.post('/requests', async (req, res, next) => {
    try {
      const body = req.body;
      fields(body, ['companyId','formType','formData','attachments','comment','signatureDataUrl','expectedDraftRevision','expectedWorkflowVersion','signerChoices','processorChoices','emailNote','submissionKey']);
      const rawKey = req.headers['idempotency-key'] ?? body.submissionKey;
      const submissionKey = typeof rawKey === 'string' ? text(rawKey, 128, false).trim() || undefined : undefined;
      const expectedDraft = body.expectedDraftRevision === undefined ? undefined : draftRevision(body.expectedDraftRevision);
      const combined = body.formType === 'Administrative & Payment Request';
      const it = body.formType === 'IT Request';
      const financial = body.formType === 'Cash Voucher' ? 'cashVoucher' : body.formType === 'Expense Claim' ? 'expenseClaim' : undefined;
      const legacy = body.formType === 'Admin Work Request';
      if (!['PEW', 'ICCL', 'FSG'].includes(body.companyId) || !SUBMITTABLE_FORMS.includes(body.formType)) fail('Choose a legal company and a supported form.');
      const companyId = body.companyId as CompanyId;
      if (!legacy && body.formType !== 'IT Request' && expectedDraft !== undefined) fail('This draft revision belongs to another form.');
      const actor = res.locals.user;
      if (!canUserStartForm(actor, companyId, body.formType)) throw new RequestError(403, 'Company or form access denied.');
      const data = form(body.formData, false, combined, it, financial, body.formType === 'R&D Initiative'); await bytes(body.signatureDataUrl, true);
      if (body.comment !== undefined) text(body.comment, 2000, false);
      if (body.emailNote !== undefined) text(body.emailNote, 2000, false);
      const files = await attachments(body.attachments, actor.name);
      if (data.expenseClaim) {
        const evidenceError = expenseEvidenceError(data.expenseClaim, files);
        if (evidenceError) fail(evidenceError);
      }

      const payloadHash = submissionKey
        ? computeSubmissionHash(companyId, body.formType, data, body.comment, body.signatureDataUrl, body.signerChoices, body.emailNote, files, body.processorChoices)
        : '';

      if (submissionKey) {
        const existingRow = 'prepare' in db
          ? db.prepare('SELECT payload_hash, response_json FROM submission_idempotency WHERE user_id=? AND key=?').get(actor.id, submissionKey) as { payload_hash: string; response_json: string } | undefined
          : (await db.execute('SELECT payload_hash, response_json FROM submission_idempotency WHERE user_id=? AND key=?', [actor.id, submissionKey])).rows[0] as unknown as { payload_hash: string; response_json: string } | undefined;
        if (existingRow) {
          if (existingRow.payload_hash !== payloadHash) {
            throw new RequestError(409, 'The submission key was already used for a different request.', 'SUBMISSION_CONFLICT');
          }
          res.status(200).json(JSON.parse(existingRow.response_json));
          return;
        }
      }

      // Pre-upload checks: verify workflow and draft before uploading attachments
      if (!legacy && body.expectedWorkflowVersion !== undefined) {
        const wfRow = 'prepare' in db
          ? db.prepare('SELECT config FROM workflows WHERE company_id=? AND form_type=?').get(companyId, body.formType) as { config: string } | undefined
          : (await db.execute('SELECT config FROM workflows WHERE company_id=? AND form_type=?', [companyId, body.formType])).rows[0] as unknown as { config: string } | undefined;
        if (!wfRow) fail('No workflow is configured for this company.');
        const wf = JSON.parse(String((wfRow as { config: string }).config)) as WorkflowConfig;
        if (wf.version !== body.expectedWorkflowVersion) {
          throw new RequestError(409, 'The signing route changed. Review the updated route before sending.', 'WORKFLOW_CONFLICT');
        }
      }
      if (expectedDraft !== undefined) {
        const currentDraft = 'prepare' in db
          ? readDraft(db, actor.id, companyId, body.formType)
          : await readDraftAsync(db, actor.id, companyId, body.formType);
        if (currentDraft.revision !== expectedDraft) {
          throw new RequestError(409, 'Draft changed in another session.', 'DRAFT_CONFLICT');
        }
      }

      const uploadedRefs: string[] = [];
      if (storage) {
        for (const file of files) {
          if (file.dataUrl && !file.dataUrl.startsWith('r2:')) {
            await storage.upload(file);
            if (file.dataUrl?.startsWith('r2:')) {
              uploadedRefs.push(file.dataUrl);
            }
          }
        }
      }

      const workflowSql = 'SELECT config FROM workflows WHERE company_id=? AND form_type=?';
      const companySql = 'SELECT name,logo_data_url FROM companies LEFT JOIN company_logos ON company_id=id WHERE id=?';
      const usersSql = 'SELECT * FROM account_profiles WHERE COALESCE(is_disabled,0)=0';
      const insertSql = 'INSERT INTO requests VALUES (?,?,?,?,?,?)';
      const prefix = formTypeToPrefix(body.formType);
      const year = new Date().getFullYear();
      function buildRecord(actor: UserProfile, row: Record<string, unknown> | undefined, company: Record<string, unknown> | undefined, users: UserProfile[], displayId?: string) {
        if (!company) fail('Company not found.');
        if (!canUserStartForm(actor, companyId, body.formType)) throw new RequestError(403, 'Company or form access denied.');
        if (!row) fail('No workflow is configured for this company.');
        let workflow = JSON.parse(String(row!.config)) as WorkflowConfig;
        if (!legacy && workflow.version !== body.expectedWorkflowVersion) throw new RequestError(409, 'The signing route changed. Review the updated route before sending.', 'WORKFLOW_CONFLICT');
        if (legacy && body.signerChoices !== undefined) fail('Signer selection is unavailable on the legacy form.');
        const selection = applySignerChoices(workflow, users, actor.id, body.signerChoices);
        if (!selection.workflow) throw new RequestError(400, selection.error);
        workflow = selection.workflow;
        if (workflow.stages.some(stage => stage.assignedUserId && !users.some(user => user.id === stage.assignedUserId && canAppearAsSigner(user, companyId, body.formType, stage.id)))) fail('A configured signer is unavailable.');
        if (data.cashVoucher) {
          const recipient = users.find(user => user.id === data.cashVoucher?.recipientUserId);
          if (!recipient || !canUserAccessCompany(recipient, companyId) || recipient.name !== data.cashVoucher.payee) fail('Choose an eligible voucher recipient.');
        }
        if (workflow.stages.some(stage => stage.assignedUserId === actor.id || (!stage.assignedUserId && users.some(user => user.id === actor.id && user.role === stage.assignedRole)))) {
          fail('The requester cannot also be an approver.');
        }
        if (!workflow.stages.length || workflow.stages.some((stage,index) => stage.isFinalApproval !== (index === workflow.stages.length - 1))) fail('Invalid final approver designation.');
        let processorHandoff;
        try { processorHandoff = resolveProcessorChoices(workflow, users, body.processorChoices); }
        catch (error) { throw new RequestError(400, (error as Error).message, 'PROCESSOR_SELECTION'); }
        const result = {
          ...createNewRequestRecord({
            id: `${companyId}-${prefix}-${year}-${randomUUID()}`,
            formType: body.formType,
            formData: { ...data, companyId, companyName: `${companyId} - ${company!.name}`, companyLogoDataUrl: legacy ? undefined : (company!.logo_data_url as string | null) ?? undefined, requesterId: actor.id, requesterName: actor.name, emailNote: body.emailNote },
            requester: actor, workflowConfig: workflow, users, attachments: files, comment: body.comment, signatureDataUrl: body.signatureDataUrl,
          }),
          displayId,
          processorHandoff,
          emailNote: body.emailNote,
          omittedSigningSteps: selection.omittedSigningSteps, revision: 1,
        };
        return result;
      }

      let record: any;
      try {
        record = 'prepare' in db ? transaction(db, () => {
          const actor = res.locals.requireCurrentUser();
          if (submissionKey) {
            const existingInTx = db.prepare('SELECT payload_hash, response_json FROM submission_idempotency WHERE user_id=? AND key=?').get(actor.id, submissionKey) as { payload_hash: string; response_json: string } | undefined;
            if (existingInTx) {
              if (existingInTx.payload_hash !== payloadHash) {
                throw new RequestError(409, 'The submission key was already used for a different request.', 'SUBMISSION_CONFLICT');
              }
              return JSON.parse(existingInTx.response_json);
            }
          }
          const allUsers = db.prepare(usersSql).all().map(safeProfile);
          const displayId = allocateSequenceSync(db, companyId, prefix, year);
          const result = buildRecord(actor, db.prepare(workflowSql).get(companyId, body.formType),
            db.prepare(companySql).get(companyId), allUsers, displayId);
          db.prepare(insertSql).run(result.id, result.companyId, actor.id, result.status, 1, JSON.stringify(result));
          if (expectedDraft !== undefined) writeDraft(db, actor.id, result.companyId, expectedDraft, null, body.formType);
          const emails = buildSubmissionEmails(result, actor, allUsers, now(), body.emailNote);
          enqueueOutboxSync(db, emails);
          const responsePayload = attachmentMetadata(result);
          if (submissionKey) {
            try {
              db.prepare('INSERT INTO submission_idempotency (key, user_id, company_id, form_type, payload_hash, request_id, response_json, created_at) VALUES (?,?,?,?,?,?,?,?)')
                .run(submissionKey, actor.id, companyId, body.formType, payloadHash, result.id, JSON.stringify(responsePayload), now());
            } catch (insertErr) {
              const checkRow = db.prepare('SELECT payload_hash, response_json FROM submission_idempotency WHERE user_id=? AND key=?').get(actor.id, submissionKey) as { payload_hash: string; response_json: string } | undefined;
              if (checkRow && checkRow.payload_hash === payloadHash) {
                return JSON.parse(checkRow.response_json);
              }
              throw insertErr;
            }
          }
          return responsePayload;
        }) : await db.transaction(async tx => {
          const actor = await res.locals.requireCurrentUserAsync(tx);
          if (submissionKey) {
            const existingInTx = (await tx.execute('SELECT payload_hash, response_json FROM submission_idempotency WHERE user_id=? AND key=?', [actor.id, submissionKey])).rows[0] as unknown as { payload_hash: string; response_json: string } | undefined;
            if (existingInTx) {
              if (existingInTx.payload_hash !== payloadHash) {
                throw new RequestError(409, 'The submission key was already used for a different request.', 'SUBMISSION_CONFLICT');
              }
              return JSON.parse(existingInTx.response_json);
            }
          }
          const workflow = (await tx.execute(workflowSql, [companyId, body.formType])).rows[0];
          const company = (await tx.execute(companySql, [companyId])).rows[0];
          const users = (await tx.execute(usersSql)).rows.map(safeProfile);
          const displayId = await allocateSequenceAsync(tx, companyId, prefix, year);
          const result = buildRecord(actor, workflow, company, users, displayId);
          await tx.execute(insertSql, [result.id, result.companyId, actor.id, result.status, 1, JSON.stringify(result)]);
          if (expectedDraft !== undefined) await writeDraftAsync(tx, actor.id, result.companyId, expectedDraft, null, body.formType);
          const emails = buildSubmissionEmails(result, actor, users, now(), body.emailNote);
          await enqueueOutboxAsync(tx, emails);
          const responsePayload = attachmentMetadata(result);
          if (submissionKey) {
            try {
              await tx.execute('INSERT INTO submission_idempotency (key, user_id, company_id, form_type, payload_hash, request_id, response_json, created_at) VALUES (?,?,?,?,?,?,?,?)',
                [submissionKey, actor.id, companyId, body.formType, payloadHash, result.id, JSON.stringify(responsePayload), now()]);
            } catch (insertErr) {
              const checkRow = (await tx.execute('SELECT payload_hash, response_json FROM submission_idempotency WHERE user_id=? AND key=?', [actor.id, submissionKey])).rows[0] as unknown as { payload_hash: string; response_json: string } | undefined;
              if (checkRow && checkRow.payload_hash === payloadHash) {
                return JSON.parse(checkRow.response_json);
              }
              throw insertErr;
            }
          }
          return responsePayload;
        });
      } catch (txError) {
        if (uploadedRefs.length > 0) {
          // A concurrent request can reference an uploaded object after this failure.
          console.warn('Attachment reconciliation candidates after failed request write:', uploadedRefs);
        }
        throw txError;
      }
      outboxProcessor?.trigger().catch(() => {});
      emitPostHogLog('request_submitted', { form_type: String(record.formType), attachment_count: files.length });
      res.status(201).json(record);
    } catch (error) { next(error); }
  });
  router.post('/requests/:id/:action', async (req, res, next) => {
    try {
      const action = req.params.action; const body = req.body; const actor = res.locals.user;
      const allowed: Record<string,string[]> = { replace: ['expectedRevision','stageId','newUserId','reason'], 'accept-replacement': ['expectedRevision','accept'], cancel: ['expectedRevision','reason'], approve: ['expectedRevision','comment','signatureDataUrl'], return: ['expectedRevision','reason'], reject: ['expectedRevision','reason'], resubmit: ['expectedRevision','formData','attachments','changeNote','signatureDataUrl'], override: ['expectedRevision','reason','signatureDataUrl'] };
      allowed['rnd-evaluation'] = ['expectedRevision', 'evaluation'];
      allowed.process = ['expectedRevision', 'action', 'note', 'signatureDataUrl', 'attachment'];
      if (!Object.hasOwn(allowed, action)) throw new RequestError(404, 'Action not found.');
      fields(body, allowed[action]);
      if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 1) fail('Invalid revision.');
      if (action === 'process') {
        if (typeof body.action !== 'string' || (!Object.hasOwn(processingLabels, body.action) && !financeHoldActions.some(action => action === body.action))) fail('Invalid processing action.');
        text(body.note, 2000);
        if (processingRequiresSignature(body.action)) await bytes(body.signatureDataUrl, true);
      }
      if (['approve','resubmit'].includes(action) || (action === 'override' && body.signatureDataUrl)) await bytes(body.signatureDataUrl, true);
      if (['return','reject','override','cancel','replace'].includes(action)) text(body.reason, 2000);
      if (body.comment !== undefined) text(body.comment, 2000, false);
      if (body.changeNote !== undefined) text(body.changeNote, 2000, false);
      if (action === 'replace') { text(body.stageId,150); text(body.newUserId,150); }
      if (action === 'accept-replacement' && typeof body.accept !== 'boolean') fail('Acceptance required.');
      const evidence = action === 'process' && body.attachment !== undefined ? (await attachments([body.attachment], actor.name))[0] : undefined;
      const lookup = 'SELECT * FROM requests WHERE id=?';
      const replacement = 'SELECT * FROM account_profiles WHERE id=? AND COALESCE(is_disabled,0)=0';
      const update = 'UPDATE requests SET status=?,revision=?,record=? WHERE id=? AND revision=?';

      let files: AttachmentItem[] | undefined;

      function transitionRecord(
        actor: UserProfile,
        row: Record<string, unknown>,
        request: RequestRecord & { attachmentVersions?: { version: number; attachments: AttachmentItem[] }[] },
        targetRow?: Record<string, unknown>
      ) {
        if (!canReadPreciRoute(actor, request)) throw new RequestError(404, 'Request not found.');
        if (Number(row.revision) !== body.expectedRevision) throw new RequestError(409, 'Request changed. Refresh and review again.', 'REQUEST_CONFLICT');
        if (action === 'resubmit' && request.formType === 'Expense Claim' && files && request.formData.expenseClaim
          && !preservesExpenseReceipts(request.formData.expenseClaim,
            request.attachments.map(file => ({ ...file, dataUrl: attachmentIdentity(file.dataUrl) })),
            files.map(file => ({ ...file, dataUrl: attachmentIdentity(file.dataUrl) })))) {
          fail('Receipt links must be preserved when resubmitting this claim.');
        }
        const revised = action === 'resubmit' ? form(body.formData, false,
          request.formType === 'Administrative & Payment Request' && body.formData?.administrativePayment !== undefined,
          request.formType === 'IT Request',
          request.formType === 'Expense Claim' && body.formData?.expenseClaim !== undefined ? 'expenseClaim' : undefined, request.formType === 'R&D Initiative') : undefined;
        if (revised?.expenseClaim) {
          const error = expenseEvidenceError(revised.expenseClaim, files ?? request.attachments);
          if (error) fail(error);
        }
        if (action === 'replace' && !targetRow) fail('Replacement user not found.');
        const result = action === 'rnd-evaluation' ? saveRndEvaluation(request, actor, body.evaluation) : action === 'process' ? recordProcessing(request, actor, body.action, body.note, body.signatureDataUrl, evidence)
          : action === 'replace' ? proposeSignerReplacement(request,actor,safeProfile(targetRow!),body.stageId,body.reason)
          : action === 'accept-replacement' ? acceptSignerReplacement(request,actor,body.accept)
          : action === 'cancel' ? cancelPreciRoute({ request, actingUser: actor, reason: body.reason }) : action === 'approve' ? approveRequestStage({ request, actingUser: actor, comment: body.comment, signatureDataUrl: body.signatureDataUrl })
          : action === 'return' ? returnRequestForCorrection({ request, actingUser: actor, reason: body.reason })
          : action === 'reject' ? rejectRequest({ request, actingUser: actor, reason: body.reason })
          : action === 'override' ? completePreciRoute({ request, actingUser: actor, signatureDataUrl: body.signatureDataUrl, reason: body.reason })
          : resubmitCorrectedRequest({ request, actingUser: actor, updatedFormData: { ...request.formData, ...revised }, attachments: files, changeNote: body.changeNote, signatureDataUrl: body.signatureDataUrl });
        if (!result.success || !result.updatedRequest) throw new RequestError(403, result.error || 'Action rejected.');
        const record = { ...result.updatedRequest, revision: Number(row.revision) + 1,
          attachmentVersions: action === 'resubmit' ? [...(request.attachmentVersions || []), { version: request.documentVersion, attachments: request.attachments }] : request.attachmentVersions };
        if (record.pendingReplacement && (record.status !== 'Pending Approval' || ['Approved','Bypassed','Rejected'].includes(record.approvalSteps.find(step => step.stageId === record.pendingReplacement!.stageId)?.status || ''))) record.pendingReplacement = undefined;
        return record;
      }
      function updateArgs(record: ReturnType<typeof transitionRecord>) {
        return [record.status, record.revision, JSON.stringify(record), record.id, body.expectedRevision];
      }
      const resubmitUploadedRefs: string[] = [];
      if ((action === 'resubmit' && body.attachments !== undefined) || (storage && evidence)) {
        const row = 'prepare' in db ? db.prepare(lookup).get(req.params.id) : (await db.execute(lookup, [req.params.id])).rows[0];
        if (!row || !canUserAccessCompany(actor, row.company_id as CompanyId)) throw new RequestError(404, 'Request not found.');
        const previous = JSON.parse(String(row.record)) as RequestRecord;
        if (!canReadPreciRoute(actor, previous)) throw new RequestError(404, 'Request not found.');
        if (Number(row.revision) !== body.expectedRevision) throw new RequestError(409, 'Request changed. Refresh and review again.', 'REQUEST_CONFLICT');
        if (action === 'resubmit') files = await attachments(body.attachments, actor.name, previous.attachments);
        transitionRecord(actor, row, previous);
        if (storage) {
          const existingIds = new Set(previous.attachments.map(file => file.id));
          for (const file of files ?? []) {
            if (!existingIds.has(file.id)) {
              if (file.dataUrl && !file.dataUrl.startsWith('r2:')) {
                await storage.upload(file);
                if (file.dataUrl?.startsWith('r2:')) {
                  resubmitUploadedRefs.push(file.dataUrl);
                }
              }
            }
          }
          if (evidence && evidence.dataUrl && !evidence.dataUrl.startsWith('r2:')) {
            await storage.upload(evidence);
            if (evidence.dataUrl?.startsWith('r2:')) {
              resubmitUploadedRefs.push(evidence.dataUrl);
            }
          }
        }
      }
      let updated: any;
      try {
        updated = 'prepare' in db ? transaction(db, () => {
          const actor = res.locals.requireCurrentUser();
          const row = db.prepare(lookup).get(req.params.id) as Record<string, unknown> | undefined;
          if (!row || !canUserAccessCompany(actor, row.company_id as any)) throw new RequestError(404, 'Request not found.');
          const previousRecord = JSON.parse(String(row.record)) as RequestRecord & { attachmentVersions?: { version: number; attachments: AttachmentItem[] }[] };
          const target = action === 'replace' ? db.prepare(replacement).get(body.newUserId) as Record<string, unknown> | undefined : undefined;
          const record = transitionRecord(actor, row, previousRecord, target);
          const saved = db.prepare(update).run(...updateArgs(record));
          if (saved.changes !== 1) throw new RequestError(409, 'Request changed. Refresh and review again.', 'REQUEST_CONFLICT');

          const getUser = (userId: string) => {
            const u = db.prepare('SELECT id, name, email, notification_email, COALESCE(is_disabled,0) AS is_disabled FROM account_profiles WHERE id=?').get(userId) as any;
            return u ? { id: String(u.id), name: String(u.name), email: String(u.notification_email || u.email), isDisabled: u.is_disabled === 1 } : undefined;
          };

          const plan = planTransitionNotification(action, record, previousRecord, actor.id, body);
          if (record.status === 'Approved' && previousRecord.status !== 'Approved') {
            for (const id of assignedProcessorIds(record)) {
              if (id === record.requesterId) continue;
              const row = db.prepare('SELECT * FROM account_profiles WHERE id=? AND COALESCE(is_disabled,0)=0').get(id);
              const user = row && safeProfile(row);
              const email = user && canUserAccessCompany(user, record.companyId) && buildProcessorEmail(record, user, now());
              if (email) enqueueOutboxSync(db, [email]);
            }
          }
          if (plan) {
            const user = getUser(plan.userId);
            const item = buildNotificationFromPlan(plan, user, record, previousRecord, now());
            if (item) enqueueOutboxSync(db, [item]);
          }

          return record;
        }) : await db.transaction(async tx => {
          const actor = await res.locals.requireCurrentUserAsync(tx);
          const row = (await tx.execute(lookup, [req.params.id])).rows[0] as Record<string, unknown> | undefined;
          if (!row || !canUserAccessCompany(actor, row.company_id as any)) throw new RequestError(404, 'Request not found.');
          const previousRecord = JSON.parse(String(row.record)) as RequestRecord & { attachmentVersions?: { version: number; attachments: AttachmentItem[] }[] };
          const target = action === 'replace' ? (await tx.execute(replacement, [body.newUserId])).rows[0] as Record<string, unknown> | undefined : undefined;
          const record = transitionRecord(actor, row, previousRecord, target);
          const saved = await tx.execute(update, updateArgs(record));
          if (saved.rowsAffected !== 1) throw new RequestError(409, 'Request changed. Refresh and review again.', 'REQUEST_CONFLICT');

          const getUserAsync = async (userId: string) => {
            const res = await tx.execute('SELECT id, name, email, notification_email, COALESCE(is_disabled,0) AS is_disabled FROM account_profiles WHERE id=?', [userId]);
            const u = res.rows[0] as any;
            return u ? { id: String(u.id), name: String(u.name), email: String(u.notification_email || u.email), isDisabled: u.is_disabled === 1 } : undefined;
          };

          const plan = planTransitionNotification(action, record, previousRecord, actor.id, body);
          if (record.status === 'Approved' && previousRecord.status !== 'Approved') {
            for (const id of assignedProcessorIds(record)) {
              if (id === record.requesterId) continue;
              const row = (await tx.execute('SELECT * FROM account_profiles WHERE id=? AND COALESCE(is_disabled,0)=0', [id])).rows[0];
              const user = row && safeProfile(row);
              const email = user && canUserAccessCompany(user, record.companyId) && buildProcessorEmail(record, user, now());
              if (email) await enqueueOutboxAsync(tx, [email]);
            }
          }
          if (plan) {
            const user = await getUserAsync(plan.userId);
            const item = buildNotificationFromPlan(plan, user, record, previousRecord, now());
            if (item) await enqueueOutboxAsync(tx, [item]);
          }

          return record;
        });
      } catch (actionError) {
        if (resubmitUploadedRefs.length > 0) {
          // A concurrent request can reference an uploaded object after this failure.
          console.warn('Attachment reconciliation candidates after failed request write:', resubmitUploadedRefs);
        }
        throw actionError;
      }
      outboxProcessor?.trigger().catch(() => {});
      res.json(attachmentMetadata(updated));
    } catch (error) { next(error); }
  });
  return router;
}
