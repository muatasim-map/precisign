import type { CompanyId, UserProfile, WorkflowStageConfig } from '../types/index';
import { canBeAssignedApproval, canUserAccessCompany, hasCompanyPermission } from './companyAccess';

export const canAdministerWorkflows = (user: UserProfile) => user.role === 'Director' || user.isGroupAdmin === true;

// Configuring future routes is separate from acting on submitted requests.
export function canConfigureSigningRoutes(user: UserProfile, companyId?: CompanyId): boolean {
  if (user.isSuperAdmin) return true;
  const check = (id: CompanyId) => hasCompanyPermission(user, id, 'manage-routes', canAdministerWorkflows(user))
    || (user.routeRights?.[id]?.companyAdmin === true && canUserAccessCompany(user, id));
  return companyId ? check(companyId) : (['PEW', 'ICCL', 'FSG'] as const).some(check);
}

export function resolveConfiguredSigner(stage: WorkflowStageConfig, users: UserProfile[], companyId: CompanyId) {
  const eligible = users.filter(user => canBeAssignedApproval(user, companyId));
  if (stage.assignedUserId) return eligible.find(user => user.id === stage.assignedUserId);
  const matches = eligible.filter(user => user.role === stage.assignedRole);
  return matches.length === 1 ? matches[0] : undefined;
}
