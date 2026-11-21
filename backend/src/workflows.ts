import { Router } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { CompanyId, UserProfile, WorkflowConfig } from '../../shared/types/index';
import type { AsyncDatabase } from './asyncDatabase';
import { canConfigureSigningRoutes } from '../../shared/utils/workflowAdministration';
import { canAppearAsSigner, canUserAccessCompany } from '../../shared/utils/companyAccess';
import { safeProfile } from './auth';
import { transaction } from './db';
import { fields, text, RequestError } from './requestValidation';
import { canJoinCompanyProcessingTeam } from '../../shared/utils/routeProcessing';
import { canAppearAsProcessor, processorTaskLabels } from '../../shared/utils/processorHandoff';
import { SUBMITTABLE_FORMS } from '../../shared/types/apiTypes';

const activeProfilesSql = 'SELECT * FROM account_profiles WHERE COALESCE(is_disabled,0)=0';
const workflowVersionSql = 'SELECT version FROM workflows WHERE company_id=? AND form_type=?';
const saveWorkflowSql = 'INSERT INTO workflows VALUES (?,?,?,?) ON CONFLICT(company_id,form_type) DO UPDATE SET version=excluded.version,config=excluded.config';

export function validateWorkflow(db: DatabaseSync, value: any): WorkflowConfig {
  return validateWorkflowWithUsers(value, db.prepare(activeProfilesSql).all().map(safeProfile));
}

function validateWorkflowWithUsers(value: any, users: UserProfile[]): WorkflowConfig {
  fields(value, ['signerSelection','allowFinalBypass','processingUserIds','processorTasks','id','companyId','formType','version','stages','preventSelfApproval','allowDirectorOverride','reminderDays','escalationDays','rejectionBehavior','returnBehavior','allowCashReceiptWaiver']);
  text(value.id,150);
  if (!['PEW', 'ICCL', 'FSG'].includes(value.companyId) || !SUBMITTABLE_FORMS.includes(value.formType) || value.returnBehavior !== 'restart_workflow' || !['archive','notify_requester'].includes(value.rejectionBehavior)) throw new RequestError(400,'Unsupported workflow.');
  const directory = value.signerSelection === 'company-directory';
  if (value.formType === 'R&D Initiative' && !directory) throw new RequestError(400, 'R&D uses company-directory signing routes.');
  if (directory && value.formType === 'Admin Work Request') throw new RequestError(400, 'Use the current forms for directory routes.');
  if (value.signerSelection !== undefined && !directory) throw new RequestError(400, 'Invalid signer selection.');
  if (value.allowFinalBypass !== undefined && typeof value.allowFinalBypass !== 'boolean') throw new RequestError(400, 'Invalid completion policy.');
  const companyId = value.companyId as CompanyId;
  for (const key of ['preventSelfApproval','allowDirectorOverride']) if (typeof value[key] !== 'boolean') throw new RequestError(400,'Invalid policy.');
  if (value.allowCashReceiptWaiver !== undefined && (value.formType !== 'Cash Voucher' || typeof value.allowCashReceiptWaiver !== 'boolean')) {
    throw new RequestError(400, 'Receipt waiver policy applies only to Cash Voucher.');
  }
  for (const key of ['reminderDays','escalationDays']) if (!Number.isSafeInteger(value[key]) || value[key]<0 || value[key]>365) throw new RequestError(400,'Invalid interval.');
  if (!Array.isArray(value.stages) || !value.stages.length || value.stages.length>20) throw new RequestError(400,'Invalid stages.');
  if (!directory && value.formType === 'Administrative & Payment Request' && value.stages.length > 2) throw new RequestError(400,'Use up to two approval steps: Department Head and Final Approver.');
  if (!directory && value.formType === 'IT Request' && value.stages.length !== 1) throw new RequestError(400,'IT Request requires one approval authority.');
  if (!directory && value.formType === 'Cash Voucher' && value.stages.length !== 1) throw new RequestError(400,'Cash Voucher requires one payout approver.');
  if (!directory && value.formType === 'Expense Claim' && value.stages.length > 2) throw new RequestError(400,'Use up to two claim approval steps.');
  if (value.processingUserIds !== undefined && (!Array.isArray(value.processingUserIds) || value.processingUserIds.length > 100 || value.processingUserIds.some((id:unknown) => typeof id !== 'string' || !users.some(user => user.id === id && canJoinCompanyProcessingTeam(value.formType, user, companyId))))) throw new RequestError(400,'Invalid processing team.');
  if (value.processorTasks !== undefined) {
    const labels = processorTaskLabels(value.formType);
    if (!Array.isArray(value.processorTasks) || value.processorTasks.length > Object.keys(labels).length) throw new RequestError(400, 'Invalid processor tasks.');
    const taskIds = new Set<string>();
    for (const task of value.processorTasks) {
      fields(task, ['id', 'suggestedUserIds']);
      if (typeof task.id !== 'string' || !Object.hasOwn(labels, task.id) || taskIds.has(task.id)
        || !Array.isArray(task.suggestedUserIds) || !task.suggestedUserIds.length || task.suggestedUserIds.length > 20
        || new Set(task.suggestedUserIds).size !== task.suggestedUserIds.length
        || task.suggestedUserIds.some((id: unknown) => !users.some(user => user.id === id && canAppearAsProcessor(user, companyId, value.formType, task.id)))) {
        throw new RequestError(400, 'Choose eligible suggested processors for each task.', 'PROCESSOR_SETUP');
      }
      taskIds.add(task.id);
    }
  }
  const ids=new Set();
  const stages=value.stages.map((stage:any,index:number)=>{
    fields(stage,['id','stageNumber','name','assignedRole','assignedUserId','isFinalApproval','canReject','canReturnForCorrection','mapsToDocumentSignature','backupSignerIds','backupCompletionUserIds','eligibleSignerIds','documentSlot','requiredOnSubmit','mustSign']);
    text(stage.id,150);text(stage.name,150);
    if(ids.has(stage.id)||stage.stageNumber!==index+1) throw new RequestError(400,'Invalid stage order.'); ids.add(stage.id);
    for(const key of ['isFinalApproval','canReject','canReturnForCorrection','mapsToDocumentSignature']) if(typeof stage[key]!=='boolean') throw new RequestError(400,'Invalid stage flag.');
    const final=index===value.stages.length-1;
    if (stage.documentSlot !== undefined && (!directory || stage.documentSlot !== 'department-head' || final
      || !['Administrative & Payment Request','Expense Claim'].includes(value.formType)
      || value.stages.some((other: any, i: number) => i < index && other.documentSlot === stage.documentSlot))) {
      throw new RequestError(400, 'Invalid printed signature mapping.');
    }
    if(stage.isFinalApproval!==final || stage.mapsToDocumentSignature!==final) throw new RequestError(400,'Only final stage maps to paper signature.');
    const eligible=users.filter(user=>canAppearAsSigner(user, companyId, value.formType, stage.id) && (stage.assignedUserId ? user.id===stage.assignedUserId : user.role===stage.assignedRole));
    const noSuggestion = directory && !stage.assignedUserId && !stage.assignedRole;
    if(!noSuggestion && (eligible.length!==1 || (stage.assignedRole && eligible[0].role!==stage.assignedRole))) throw new RequestError(400,'Missing, ambiguous or mismatched approver.');
    const backups = stage.backupSignerIds ?? [];
    const eligibleSigners = stage.eligibleSignerIds ?? [];
    if (!Array.isArray(eligibleSigners) || eligibleSigners.length > 20 || new Set(eligibleSigners).size !== eligibleSigners.length
      || !Array.isArray(backups) || eligibleSigners.some(id => backups.includes(id) || !users.some(user => user.id === id && canAppearAsSigner(user, companyId, value.formType, stage.id)))) {
      throw new RequestError(400, 'Choose eligible signers separately from backups.');
    }
    for (const key of ['requiredOnSubmit','mustSign']) if (stage[key] !== undefined && typeof stage[key] !== 'boolean') throw new RequestError(400,'Invalid signature policy.');
    const completion = stage.backupCompletionUserIds ?? [];
    if (!Array.isArray(backups) || backups.length > 20 || new Set(backups).size !== backups.length
      || backups.some(id => id === eligible[0]?.id || !users.some(user => user.id === id && canAppearAsSigner(user, companyId, value.formType, stage.id)))) {
      throw new RequestError(400, 'Choose eligible backup signers other than the primary signer.');
    }
    if (!Array.isArray(completion) || new Set(completion).size !== completion.length || (!final && completion.length) || completion.some(id => !backups.includes(id))) {
      throw new RequestError(400, 'Early completion permission applies only to backups on the final step.');
    }
    return {...stage,assignedUserId:noSuggestion ? undefined : eligible[0].id,assignedRole:noSuggestion ? undefined : eligible[0].role, ...(directory ? { requiredOnSubmit:final, mustSign:false } : {})};
  });
  return {...value,stages};
}

export function saveWorkflowConfig(db: DatabaseSync, config: WorkflowConfig, expectedVersion?: number) {
  return transaction(db,()=>{
    const validated=validateWorkflow(db,config);
    const old=db.prepare(workflowVersionSql).get(validated.companyId,validated.formType);
    if(expectedVersion!==undefined && Number(old?.version ?? 0)!==expectedVersion) throw new RequestError(409,'Workflow changed. Reload before saving.','WORKFLOW_CONFLICT');
    const saved={...validated,version:Number(old?.version ?? 0)+1};
    db.prepare(saveWorkflowSql).run(saved.companyId,saved.formType,saved.version,JSON.stringify(saved));
    return saved;
  });
}

export function workflowRoutes(db: DatabaseSync | AsyncDatabase) {
  const router=Router();
  router.put('/workflows/:companyId/:formType',async (req,res,next)=>{
    try {
      const actor = 'prepare' in db ? res.locals.requireCurrentUser() : res.locals.user;
      if(!canConfigureSigningRoutes(actor)) throw new RequestError(403,'Workflow administrator required.');
      fields(req.body,['expectedVersion','workflow']);
      const {expectedVersion,workflow}=req.body;
      if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0||workflow?.companyId!==req.params.companyId||workflow?.formType!==req.params.formType) throw new RequestError(400,'Invalid workflow intent.');
      if (!canUserAccessCompany(actor, workflow.companyId) || !canConfigureSigningRoutes(actor, workflow.companyId)) throw new RequestError(403, 'Company access denied.');
      const saved = 'prepare' in db ? saveWorkflowConfig(db,workflow,expectedVersion) : await db.transaction(async tx => {
        const current = await res.locals.requireCurrentUserAsync(tx);
        if (!canConfigureSigningRoutes(current, workflow.companyId) || !canUserAccessCompany(current, workflow.companyId)) throw new RequestError(403, 'Workflow administrator required.');
        const validated = validateWorkflowWithUsers(workflow, (await tx.execute(activeProfilesSql)).rows.map(safeProfile));
        const old = (await tx.execute(workflowVersionSql, [validated.companyId, validated.formType])).rows[0];
        if (Number(old?.version ?? 0) !== expectedVersion) throw new RequestError(409, 'Workflow changed. Reload before saving.', 'WORKFLOW_CONFLICT');
        const updated = { ...validated, version: expectedVersion + 1 };
        await tx.execute(saveWorkflowSql, [updated.companyId, updated.formType, updated.version, JSON.stringify(updated)]);
        return updated;
      });
      res.json(saved);
    }catch(error){next(error);}
  });return router;
}
