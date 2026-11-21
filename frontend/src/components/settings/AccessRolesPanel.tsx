import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { accessPermissions } from '../../types';
import type { AccessPermission, AccessRole, CompanyId, CompanyRoleAssignment } from '../../types';
import { INITIAL_COMPANIES } from '../../data/seedData';
import type { AccountDirectoryEntry, IAccountAdministrationRepository } from '../../services/repository';
import { ActionButton, EditorInput, EditorSelect } from '../create/RequestEditorControls';

const labels: Record<AccessPermission, string> = {
  requester: 'Requester',
  approver: 'Approver',
  cashier: 'Cashier',
  finance: 'Finance processor',
  'manage-routes': 'Manage signing routes',
};

export function AccessRolesPanel({ accounts, repository, onSaved }: {
  accounts: AccountDirectoryEntry[];
  repository: Required<Pick<IAccountAdministrationRepository, 'listAccessRoles' | 'saveAccessRole' | 'assignAccessRoles'>>;
  onSaved: () => Promise<void>;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof repository.listAccessRoles>>>();
  const [draft, setDraft] = useState<Omit<AccessRole, 'id'> & { id?: string }>({ name: '', permissions: [] });
  const [assignment, setAssignment] = useState<CompanyRoleAssignment>();
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();
  const employee = accounts.find(account => account.id === userId && !account.isDisabled);
  const companies = INITIAL_COMPANIES.filter(company => employee?.companyGrants?.includes(company.id));
  const impacted = data?.assignments.filter(item => draft.id && item.roleIds.includes(draft.id)) ?? [];
  const approvalIds = (userId: string, companyId: CompanyId) => [...new Set(data?.activeApprovals
    .filter(item => item.userId === userId && item.companyId === companyId).map(item => item.requestId))];
  const assignedRequests = assignment ? approvalIds(assignment.userId, assignment.companyId) : [];
  const affectedRequests = [...new Set(impacted.flatMap(item => approvalIds(item.userId, item.companyId)))];

  useEffect(() => {
    let cancelled = false;
    void repository.listAccessRoles().then(result => {
      if (!cancelled) setData(result);
    }).catch(() => {
      if (!cancelled) setFeedback({ error: true, text: 'Could not load access roles. Reload the directory to retry.' });
    });
    return () => { cancelled = true; };
  }, [repository]);

  async function save(action: () => Promise<void>, message: string) {
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      const [updated] = await Promise.all([repository.listAccessRoles(), onSaved()]);
      setData(updated);
      setFeedback({ error: false, text: message });
    } catch (error) {
      setFeedback({ error: true, text: error instanceof Error ? error.message : 'Could not save access.' });
    } finally { setBusy(false); }
  }

  function chooseCompany(companyId: string) {
    const company = companies.find(item => item.id === companyId);
    setAssignment(company ? {
      userId, companyId: company.id as CompanyId,
      roleIds: data?.assignments.find(item => item.userId === userId && item.companyId === company.id)?.roleIds ?? [],
    } : undefined);
  }

  return <details className="workspace-panel route-accordion roles-panel p-4">
    <summary>
      <span><strong>Roles and access levels</strong><small>Create roles and assign them per company</small></span>
      <ChevronDown aria-hidden="true" className="route-accordion-chevron size-4" />
    </summary>
    <p className="mt-3 text-sm text-slate-600">Assign roles per company. Requesters also need access to the forms they can start. Approvers sign only when assigned to a request.</p>
    {feedback && <p className="mt-2 text-sm" role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>}
    {!data ? !feedback && <p role="status" className="mt-2 text-sm">Loading roles…</p> :
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <form className="roles-card space-y-3" onSubmit={event => {
          event.preventDefault();
          void save(() => repository.saveAccessRole(draft), 'Role saved.');
        }}>
          <fieldset disabled={busy} className="space-y-2">
            <legend className="font-semibold">Create or edit a role</legend>
            <label className="block text-sm">Role to edit
              <EditorSelect value={draft.id ?? ''} onChange={event => setDraft(data.roles.find(role => role.id === event.target.value) ?? { name: '', permissions: [] })}>
                <option value="">New role</option>
                {data.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
              </EditorSelect>
            </label>
            <label className="block text-sm">Role name
              <EditorInput required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} />
            </label>
            {accessPermissions.map(permission => <label key={permission} className="preci-form-option">
              <input type="checkbox" className="preci-check" checked={draft.permissions.includes(permission)} onChange={event => setDraft({
                ...draft, permissions: event.target.checked ? [...draft.permissions, permission] : draft.permissions.filter(item => item !== permission),
              })} />
              {labels[permission]}
            </label>)}
            {impacted.length > 0 && <p className="text-sm text-slate-600">This affects {impacted.map(item => `${accounts.find(account => account.id === item.userId)?.name ?? item.userId} (${item.companyId})`).join(', ')}.</p>}
            {affectedRequests.length > 0 && <p className="text-sm">Existing signer assignments stay in place for {affectedRequests.join(', ')}.</p>}
            <div className="flex justify-end pt-1"><ActionButton type="submit" busy={busy}>Save role</ActionButton></div>
          </fieldset>
        </form>
        <form className="roles-card space-y-3" onSubmit={event => {
          event.preventDefault();
          if (assignment) void save(() => repository.assignAccessRoles(assignment), 'Company roles saved.');
        }}>
          <fieldset disabled={busy} className="space-y-2">
            <legend className="font-semibold">Assign company roles</legend>
            <label className="block text-sm">Employee
              <EditorSelect value={userId} onChange={event => { setUserId(event.target.value); setAssignment(undefined); }}>
                <option value="">Choose an employee</option>
                {accounts.filter(account => !account.isDisabled).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
              </EditorSelect>
            </label>
            <label className="block text-sm">Company
              <EditorSelect value={assignment?.companyId ?? ''} onChange={event => chooseCompany(event.target.value)}>
                <option value="">Choose a company</option>
                {companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}
              </EditorSelect>
            </label>
            {assignment && <>
              {!data.assignments.some(item => item.userId === userId && item.companyId === assignment.companyId) &&
                <p className="text-sm text-slate-600">This employee uses existing access rules here. Saving replaces those role permissions with the selection below.</p>}
              {data.roles.map(role => <label key={role.id} className="preci-form-option">
                <input type="checkbox" className="preci-check" checked={assignment.roleIds.includes(role.id)} onChange={event => setAssignment({
                  ...assignment, roleIds: event.target.checked ? [...assignment.roleIds, role.id] : assignment.roleIds.filter(id => id !== role.id),
                })} />
                {role.name}
              </label>)}
            </>}
            {assignedRequests.length > 0 && <p className="text-sm">Existing signer assignments stay in place for {assignedRequests.join(', ')}.</p>}
            <div className="flex justify-end pt-1"><ActionButton type="submit" disabled={!assignment} busy={busy}>Save company roles</ActionButton></div>
          </fieldset>
        </form>
      </div>}
  </details>;
}
