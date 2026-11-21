import type { CompanyId, ProcessorHandoff, RequestRecord, UserProfile, WorkflowConfig } from '../types';
import { canUserAccessCompany } from './companyAccess';

export function processorTaskLabels(form: string): Record<string, string> {
  switch (form) {
    case 'Administrative & Payment Request': return { finance: 'Accounts', admin: 'Admin fulfillment' };
    case 'IT Request': return { it: 'IT fulfillment' };
    case 'Cash Voucher': return { cashier: 'Cash payout' };
    case 'Expense Claim': return { finance: 'Expense settlement' };
    case 'R&D Initiative': return { rnd: 'R&D follow-up' };
    default: return { admin: 'Admin fulfillment' };
  }
}

export function canAppearAsProcessor(user: UserProfile, company: CompanyId, form: string, taskId: string) {
  return canUserAccessCompany(user, company) && user.routeRights?.[company]?.processorTasks?.[form]?.includes(taskId) === true;
}

export function hasProcessorRights(user: UserProfile, companies: readonly CompanyId[]) {
  return companies.some(company => canUserAccessCompany(user, company) &&
    Object.values(user.routeRights?.[company]?.processorTasks ?? {}).some(tasks => tasks.length > 0));
}

export function assignedProcessorIds(record: RequestRecord) {
  return [...new Set(record.processorHandoff?.flatMap(task => task.userIds) ?? [])];
}

export function hasProcessorHandoff(record: RequestRecord, userId: string) {
  return record.status === 'Approved' && assignedProcessorIds(record).includes(userId);
}

export function hasReadHandoff(record: RequestRecord, userId: string) {
  return record.processorReads?.some(read => read.userId === userId && read.version === record.documentVersion) === true;
}

export type ProcessorChoices = Record<string, string[]>;

export function resolveProcessorChoices(workflow: WorkflowConfig, users: UserProfile[], choices: unknown): ProcessorHandoff[] | undefined {
  if (!workflow.processorTasks?.length) {
    if (choices !== undefined) throw new Error('Processors have not been configured for this form.');
    return undefined;
  }
  if (choices !== undefined && (!choices || typeof choices !== 'object' || Array.isArray(choices)
    || Object.keys(choices).some(id => !workflow.processorTasks!.some(task => task.id === id)))) {
    throw new Error('Review the selected processors.');
  }
  return workflow.processorTasks.map(task => {
    const selected = choices === undefined ? task.suggestedUserIds : (choices as ProcessorChoices)[task.id];
    const eligible = users.filter(user => canAppearAsProcessor(user, workflow.companyId, workflow.formType, task.id));
    const label = processorTaskLabels(workflow.formType)[task.id];
    if (!eligible.length) throw new Error(`Ask a route administrator to configure ${label} for ${workflow.companyId} · ${workflow.formType}.`);
    if (!Array.isArray(selected) || !selected.length || selected.length > 20 || new Set(selected).size !== selected.length
      || selected.some(id => !eligible.some(user => user.id === id))) throw new Error(`Choose at least one eligible processor for ${label}.`);
    return { taskId: task.id, userIds: selected };
  });
}
