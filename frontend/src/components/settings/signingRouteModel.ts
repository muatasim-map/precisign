import type { UserProfile, WorkflowConfig, WorkflowStageConfig } from '../../types';
import { routeForms, type RouteForm } from '../../utils/routeForms';
import { isOptionalSigner } from '../../../../shared/utils/signingSelection';

/** The label an admin sees for a step: the form's signature slot name, or the review step's own name. */
export function stepLabel(form: RouteForm, step: WorkflowStageConfig) {
  const labels = routeForms[form];
  if (step.documentSlot && labels.department) return labels.department;
  if (step.isFinalApproval) return labels.final;
  return step.name.trim() || 'Review step';
}

const nameOf = (people: UserProfile[], id?: string) => id ? people.find(person => person.id === id)?.name ?? 'an unavailable employee' : 'Requester chooses';

/**
 * Concrete, human-readable differences between the saved route and the draft.
 * `saved` is undefined when the form has no saved route yet.
 */
export function describeRouteChanges(form: RouteForm, saved: WorkflowConfig | undefined, draft: WorkflowConfig, people: UserProfile[]): string[] {
  const changes: string[] = [];
  if (!saved) {
    changes.push(`New route with ${draft.stages.length + 1} signing steps`);
    for (const step of draft.stages) {
      if (step.assignedUserId) changes.push(`${step.isFinalApproval ? 'Final approver' : `Suggested signer for ${stepLabel(form, step)}`}: ${nameOf(people, step.assignedUserId)}`);
      for (const id of step.backupSignerIds ?? []) changes.push(`Backup added: ${nameOf(people, id)} (${stepLabel(form, step)})`);
    }
    return changes;
  }
  const before = new Map(saved.stages.map(step => [step.id, step]));
  const after = new Map(draft.stages.map(step => [step.id, step]));
  for (const step of saved.stages) if (!after.has(step.id)) changes.push(`Step removed: ${stepLabel(form, step)}`);
  for (const step of draft.stages) if (!before.has(step.id)) changes.push(`Step added: ${stepLabel(form, step)}`);

  // Order: compare the relative order of steps present in both versions.
  const kept = draft.stages.filter(step => before.has(step.id)).map(step => step.id);
  const keptBefore = saved.stages.filter(step => after.has(step.id)).map(step => step.id);
  if (kept.join() !== keptBefore.join()) {
    const order = draft.stages.map(step => stepLabel(form, step));
    changes.push(`Order changed: ${order.join(' → ')}`);
  }

  for (const step of draft.stages) {
    const old = before.get(step.id);
    if (!old) {
      if (step.assignedUserId) changes.push(`Suggested signer for ${stepLabel(form, step)}: ${nameOf(people, step.assignedUserId)}`);
      for (const id of step.backupSignerIds ?? []) changes.push(`Backup added: ${nameOf(people, id)} (${stepLabel(form, step)})`);
      continue;
    }
    const label = stepLabel(form, step);
    if (!step.isFinalApproval && !step.documentSlot && old.name.trim() !== step.name.trim()) changes.push(`Step renamed from ${stepLabel(form, old)} to ${label}`);
    if ((old.assignedUserId ?? '') !== (step.assignedUserId ?? '')) {
      changes.push(step.isFinalApproval
        ? `Final approver changed from ${nameOf(people, old.assignedUserId)} to ${nameOf(people, step.assignedUserId)}`
        : `Suggested signer for ${label} changed from ${nameOf(people, old.assignedUserId)} to ${nameOf(people, step.assignedUserId)}`);
    }
    const oldBackups = new Set(old.backupSignerIds ?? []);
    const newBackups = new Set(step.backupSignerIds ?? []);
    const several = draft.stages.filter(item => item.backupSignerIds?.length || before.get(item.id)?.backupSignerIds?.length).length > 1;
    const where = several ? ` (${label})` : '';
    for (const id of newBackups) if (!oldBackups.has(id)) changes.push(`Backup added: ${nameOf(people, id)}${where}`);
    for (const id of oldBackups) if (!newBackups.has(id)) changes.push(`Backup removed: ${nameOf(people, id)}${where}`);
  }

  if ((saved.allowFinalBypass === true) !== (draft.allowFinalBypass === true)) changes.push(draft.allowFinalBypass ? 'Final approver bypass turned on' : 'Final approver bypass turned off');
  if (JSON.stringify(saved.processorTasks ?? []) !== JSON.stringify(draft.processorTasks ?? [])) changes.push('After-approval processors updated.');
  const oldTeam = new Set(saved.processingUserIds ?? []);
  const newTeam = new Set(draft.processingUserIds ?? []);
  for (const id of newTeam) if (!oldTeam.has(id)) changes.push(`Processing team added: ${nameOf(people, id)}`);
  for (const id of oldTeam) if (!newTeam.has(id)) changes.push(`Processing team removed: ${nameOf(people, id)}`);
  if ((saved.allowCashReceiptWaiver ?? false) !== (draft.allowCashReceiptWaiver ?? false)) changes.push(draft.allowCashReceiptWaiver ? 'Cash receipt waivers allowed' : 'Cash receipt waivers no longer allowed');
  return changes;
}

/** One example of where a request goes when an optional step is skipped, derived from the route rules. */
export function skipExample(form: RouteForm, route: WorkflowConfig): string | null {
  const index = route.stages.findIndex(step => isOptionalSigner(route, step));
  if (index < 0 || index >= route.stages.length - 1) return null;
  return `If ${stepLabel(form, route.stages[index])} is skipped, the request goes to ${stepLabel(form, route.stages[index + 1])}.`;
}

export type StepIssues = { name?: string; signer?: string; backups?: string };

/** The editor's existing eligibility rules, reported per control. */
export function stepIssues(step: WorkflowStageConfig, eligible: UserProfile[], companyName: string): StepIssues {
  const issues: StepIssues = {};
  if (!step.isFinalApproval && !step.documentSlot && !step.name.trim()) issues.name = 'Enter a name for this review step.';
  if (step.assignedUserId && !eligible.some(person => person.id === step.assignedUserId)) {
    issues.signer = `This employee can no longer sign for ${companyName}. Choose another signer or let the requester choose.`;
  }
  const backups = step.backupSignerIds ?? [];
  if (backups.includes(step.assignedUserId ?? '\u0000')) issues.backups = 'The suggested signer cannot also be their own backup.';
  else if (backups.some(id => !eligible.some(person => person.id === id))) issues.backups = `A backup can no longer sign for ${companyName}. Remove them or choose another.`;
  return issues;
}

/** Moves an intermediate step; the final approval always stays last. Returns null when there is no valid destination. */
export function moveIntermediate(stages: WorkflowStageConfig[], index: number, offset: -1 | 1) {
  const target = index + offset;
  const lastIntermediate = stages.length - 2;
  if (index < 0 || index > lastIntermediate || target < 0 || target > lastIntermediate) return null;
  const next = [...stages];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
