import { DirectorySkeleton } from '../common/Skeletons';
import { toast } from '../common/Toaster';
import { PageHeader } from '../common/PageHeader';
import { AccessRightsMatrix } from './AccessRightsMatrix';
import { useApp } from '../../context/AppContext';
import { SUBMITTABLE_FORMS } from '../../../../shared/types/apiTypes';
import type { UserProfile } from '../../types';
import { isShowcaseBuild } from '../../config/demo';
import { useCallback, useEffect, useRef, useState, useId } from 'react';
import {
  Loader2,
  Building2,
  KeyRound,
  Mail,
  MoreHorizontal,
  Search,
  Shield,
  SlidersHorizontal,
  UserRoundCheck,
  UserRoundMinus,
  UsersRound,
  X,
  UserPlus,
  Info,
  FileText,
  AlertTriangle,
  Lock,
  Eye,
  Check,
} from 'lucide-react';
import type { StaffRole, AccountDirectoryEntry, IAccountAdministrationRepository } from '../../services/repository';
import { ApiError } from '../../services/apiTypes';
import type { CompanyId } from '../../types';
import { INITIAL_COMPANIES } from '../../data/seedData';
import { companyForms } from '../library/FormsLibraryView';
import { AccessRolesPanel } from './AccessRolesPanel';

type Editor = { account: AccountDirectoryEntry; mode: 'access' | 'email' | 'status' | 'reset' | 'role' };
type FormGrants = Partial<Record<CompanyId, string[]>>;

function isAwaitingAccess(account: AccountDirectoryEntry) {
  return !account.isDisabled && !account.isSuperAdmin && !account.isGroupAdmin && account.companyGrants?.length === 0;
}

const editorTitles = {
  access: 'Access Rights',
  email: 'Change sign-in email',
  role: 'Change staff role',
  status: 'Account status',
  reset: 'Password reset link',
};

export function AccountDirectoryView({ repository }: { repository: IAccountAdministrationRepository }) {
  const [accounts, setAccounts] = useState<AccountDirectoryEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [loadError, setLoadError] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const editorTrigger = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(false);
    try {
      const entries = await repository.listAccounts();
      setAccounts(entries);
      return entries;
    } catch {
      setLoadError(true);
    }
  }, [repository]);

  useEffect(() => {
    void refresh();
    heading.current?.focus();
  }, [refresh]);

  useEffect(() => {
    if (!editor && !showAddUserModal && editorTrigger.current) {
      editorTrigger.current.focus({ preventScroll: true });
      editorTrigger.current = null;
    }
  }, [editor, showAddUserModal]);

  const term = query.trim().toLowerCase();
  const filtered = accounts?.filter(account =>
    (status === 'all' || (status === 'awaiting'
      ? isAwaitingAccess(account)
      : status === 'disabled' ? account.isDisabled : !account.isDisabled && !isAwaitingAccess(account))) &&
    [account.name, account.email, account.department, account.role].some(value =>
      value.toLowerCase().includes(term)
    )
  );
  const enabledCount = accounts?.filter(account => !account.isDisabled).length ?? 0;

  function openEditor(account: AccountDirectoryEntry, mode: Editor['mode'], trigger: HTMLButtonElement) {
    const menu = trigger.closest('details');
    editorTrigger.current = menu?.querySelector('summary') ?? trigger;
    if (menu) menu.open = false;
    setEditor({ account, mode });
  }

  return (
    <section className="preci-directory settings-page" aria-labelledby="directory-title">
      <div className="space-y-4">
        <PageHeader motif="people" eyebrow="Administration" title="User directory" headingId="directory-title" headingRef={heading}
          subtitle="Manage employee accounts, company access, and roles."
          actions={repository.registerUser && (
            <button
              type="button"
              className="workspace-primary preci-press inline-flex min-h-10 items-center gap-2 px-4 text-sm font-semibold"
              onClick={event => {
                editorTrigger.current = event.currentTarget;
                setShowAddUserModal(true);
              }}
            >
              <UserPlus aria-hidden="true" className="size-4" />
              Add new employee
            </button>
          )} />
        {accounts && (
          <dl className="preci-directory-stats">
            <div><dt>Total accounts</dt><dd>{accounts.length}</dd></div>
            <div><dt>Enabled</dt><dd className="text-teal-700">{enabledCount}</dd></div>
            <div><dt>Disabled</dt><dd className="text-amber-800">{accounts.length - enabledCount}</dd></div>
          </dl>
        )}
      </div>


      {loadError && (
        <div role="alert" className="preci-error flex flex-wrap items-center justify-between gap-2 p-4">
          <span>Could not load accounts. Please verify network connectivity and try again.</span>
          <button type="button" className="preci-link font-semibold" onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}

      <div className="workspace-panel">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-workspace-line p-4 sm:px-5">
          <div className="w-full max-w-md sm:flex-1">
            <label htmlFor="directory-search" className="preci-field">Find an employee</label>
            <div className="preci-search">
              <Search aria-hidden="true" />
              <input
                id="directory-search"
                type="search"
                placeholder="Name, email, department, or role"
                value={query}
                onChange={event => setQuery(event.target.value)}
              />
            </div>
          </div>
          <label className="preci-field">
            Account status
            <select
              className="workspace-control block min-h-10 px-3 text-sm font-normal"
              value={status}
              onChange={event => setStatus(event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="active">Active</option>
              <option value="awaiting">Awaiting access</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
        </div>

        {filtered && (
          <p role="status" className="border-b border-workspace-line bg-slate-50/70 px-4 py-2 text-xs font-medium text-workspace-muted sm:px-5">
            Showing {filtered.length} of {accounts?.length} accounts
          </p>
        )}

        {!accounts && !loadError && (
          <DirectorySkeleton />
        )}

        {filtered?.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-xl bg-workspace-tint text-workspace-teal">
              <UsersRound aria-hidden="true" />
            </span>
            <h2 className="text-base font-bold text-slate-800">
              {accounts?.length ? 'No matching accounts found' : 'No employee accounts yet'}
            </h2>
            <p className="text-sm text-workspace-muted">
              {accounts?.length ? 'Try clearing your search query or status filter.' : 'Employee accounts will appear here after creation.'}
            </p>
            {!!accounts?.length && (
              <button
                type="button"
                className="preci-link mt-2 font-medium"
                onClick={() => { setQuery(''); setStatus('all'); }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}

        <ul className="fade-in divide-y divide-workspace-line">
          {filtered?.map(account => {
            const hasMultipleCompanies = (account.companyGrants?.length ?? 0) > 1;
            const isWorkflowAdmin = account.role === 'Director' || account.isGroupAdmin === true || account.isRouteAdmin === true || Object.values(account.routeRights ?? {}).some(right => right?.companyAdmin);

            return (
              <li className="preci-directory-row p-4 sm:p-5" key={account.id}>
                {/* 1. Identity & Staff Role */}
                <div className="flex min-w-0 items-start gap-3">
                  <span className="preci-avatar" aria-hidden="true">
                    {account.name.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('')}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h2 className="break-words text-sm font-bold text-slate-900">{account.name}</h2>
                      {account.isSuperAdmin && (
                        <span className="preci-tag preci-tag-admin">
                          <Shield aria-hidden="true" /> Super admin
                        </span>
                      )}
                      {(account.isDisabled || isAwaitingAccess(account)) && <span className={`preci-tag ${account.isDisabled ? 'preci-tag-disabled' : 'preci-tag-active'}`}>
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                        {account.isDisabled ? 'Disabled' : 'Awaiting access'}
                      </span>}
                      {isWorkflowAdmin && (
                        <span className="inline-flex items-center gap-1 rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 border border-indigo-150" title="Can configure signing routes and manage intermediate signer replacements">
                          <SlidersHorizontal className="size-3" /> Route Admin
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-sm">
                      <span className="font-medium text-slate-800">{isAwaitingAccess(account) && account.jobTitle
                        ? `Suggested title: ${account.jobTitle}`
                        : account.jobTitle || account.role}</span>
                      {account.department && <span aria-hidden="true" className="text-workspace-muted">·</span>}
                      {account.department && <span className="text-workspace-muted">{account.department}</span>}
                    </div>
                    <p className="mt-0.5 text-xs [overflow-wrap:anywhere] text-workspace-muted">{account.email}</p>

                  </div>
                </div>

                {/* 2. What this employee can do, for which company, and why */}
                <div className="min-w-0 text-xs space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <span className="font-bold text-slate-700 uppercase tracking-wider text-[11px]">
                      Company access
                    </span>
                    {account.companyGrants !== null && (
                      <span className="text-[11px] font-medium text-workspace-muted">
                        {hasMultipleCompanies ? 'Group View enabled' : account.companyGrants.length === 1 ? 'Single company' : 'No access'}
                      </span>
                    )}
                  </div>

                  {account.companyGrants === null ? (
                    <div className="rounded border border-amber-200 bg-amber-50 p-2 text-amber-900 text-xs">
                      Legacy account format. Edit access to migrate to explicit grants.
                    </div>
                  ) : account.companyGrants.length === 0 ? (
                    <p className="text-workspace-muted italic">No legal companies assigned. Employee cannot view requests or initiate forms.</p>
                  ) : (
                    <div className="space-y-2">
                      <ul className="flex flex-wrap gap-1.5" aria-label="Companies and startable forms">
                        {account.companyGrants.map(company => {
                          const chipPermissions = account.companyPermissions?.[company];
                          const chipCount = (chipPermissions && !chipPermissions.includes('requester') ? [] : account.formGrants?.[company] ?? []).length;
                          return (
                            <li key={company} className="access-chip">
                              <span className="access-chip-code">{company}</span>
                              {chipCount} {chipCount === 1 ? 'form' : 'forms'}
                            </li>
                          );
                        })}
                      </ul>
                      <details className="access-details">
                        <summary>Access details</summary>
                        <div className="mt-2 space-y-1.5">
                      {account.companyGrants.map(company => {
                        const permissions = account.companyPermissions?.[company];
                        const forms = permissions && !permissions.includes('requester') ? [] : account.formGrants?.[company] ?? [];
                        return (
                          <div key={company} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1 mb-1">
                              <span className="font-bold text-slate-900 flex items-center gap-1.5">
                                <span className="rounded bg-white px-1.5 py-0.5 text-slate-700 font-mono text-xs">{company}</span>
                                {INITIAL_COMPANIES.find(c => c.id === company)?.name ?? company}
                              </span>
                              <span className="text-[11px] text-teal-800 font-medium">
                                {forms.length} {forms.length === 1 ? 'form' : 'forms'} startable
                              </span>
                            </div>
                            <p className="text-slate-600 break-words leading-relaxed">
                              {forms.length > 0 ? forms.join(', ') : <span className="text-workspace-muted">View only (no forms startable)</span>}
                            </p>
                            <p className="mt-1 text-slate-600">
                              {permissions
                                ? [permissions.includes('requester') && 'Requester', permissions.includes('approver') && 'Approver'].filter(Boolean).join(' · ') || 'No requester or approver role'
                                : 'Existing access rules'}
                            </p>
                          </div>
                        );
                      })}
                        </div>
                      </details>
                    </div>
                  )}
                </div>

                {/* 3. Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 justify-end sm:justify-start">
                  {!account.isDisabled && account.companyGrants !== null && (
                    <button
                      type="button"
                      className="workspace-control preci-press inline-flex min-h-10 items-center gap-2 px-3 text-xs font-semibold text-slate-700 hover:text-slate-900"
                      onClick={event => openEditor(account, 'access', event.currentTarget)}
                    >
                      <SlidersHorizontal aria-hidden="true" className="manage-icon size-4 text-workspace-teal" />
                      Manage access
                    </button>
                  )}
                  <details
                    className="preci-row-menu relative"
                    onBlur={event => {
                      if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Escape') {
                        event.currentTarget.open = false;
                        event.currentTarget.querySelector('summary')?.focus();
                      }
                    }}
                  >
                    <summary
                      aria-label={`Account actions for ${account.name}`}
                      className="workspace-control preci-icon-button min-h-10 min-w-10 cursor-pointer"
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </summary>
                    <div className="preci-popover absolute top-full right-0 z-10 mt-2 w-56 origin-top-right rounded-xl border border-workspace-line bg-white p-1.5 shadow-lg">
                      <button
                        type="button"
                        className="preci-menu-action w-full text-left"
                        disabled={account.companyGrants === null}
                        onClick={event => openEditor(account, 'email', event.currentTarget)}
                      >
                        <Mail aria-hidden="true" className="size-4" /> Change email
                      </button>
                      {account.companyGrants !== null && !account.isDisabled && !['Director', 'General Manager'].includes(account.role) && (
                        <button
                          type="button"
                          className="preci-menu-action w-full text-left"
                          onClick={event => openEditor(account, 'role', event.currentTarget)}
                        >
                          <UsersRound aria-hidden="true" className="size-4" /> Change staff role
                        </button>
                      )}
                      {!isShowcaseBuild && !account.isDisabled && (
                        <button
                          type="button"
                          className="preci-menu-action w-full text-left"
                          onClick={event => openEditor(account, 'reset', event.currentTarget)}
                        >
                          <KeyRound aria-hidden="true" className="size-4" /> Create reset link
                        </button>
                      )}
                      <button
                        type="button"
                        className={`preci-menu-action w-full text-left ${account.isDisabled ? 'text-teal-700 hover:bg-teal-50' : 'text-rose-800 hover:bg-rose-50'}`}
                        disabled={account.companyGrants === null}
                        onClick={event => openEditor(account, 'status', event.currentTarget)}
                      >
                        {account.isDisabled ? <UserRoundCheck aria-hidden="true" className="size-4" /> : <UserRoundMinus aria-hidden="true" className="size-4" />}
                        {account.isDisabled ? 'Re-enable account' : 'Disable account'}
                      </button>
                    </div>
                  </details>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {accounts && repository.listAccessRoles && repository.saveAccessRole && repository.assignAccessRoles &&
        <AccessRolesPanel accounts={accounts} onSaved={async () => { await refresh(); }} repository={repository as Required<Pick<IAccountAdministrationRepository, 'listAccessRoles' | 'saveAccessRole' | 'assignAccessRoles'>>} />}

      {editor && (
        <AccountEditor
          editor={editor}
          repository={repository}
          onClose={() => setEditor(null)}
          onSaved={message => {
            setEditor(null);
            toast(message);
            void refresh();
          }}
        />
      )}

      {showAddUserModal && repository.registerUser && (
        <AddUserDialog
          repository={repository}
          onClose={() => setShowAddUserModal(false)}
          onCreated={async (name, email) => {
            const entries = await refresh();
            const account = entries?.find(entry => entry.email.toLowerCase() === email);
            setShowAddUserModal(false);
            if (account) setEditor({ account, mode: 'access' });
            toast(account
              ? `Employee account created for ${name}.`
              : `Account created for ${name}. Refresh the directory to set access.`);
          }}
        />
      )}
    </section>
  );
}

function AccountEditor({
  editor,
  repository,
  onClose,
  onSaved,
}: {
  editor: Editor;
  repository: IAccountAdministrationRepository;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { account, mode } = editor;
  const dialog = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState(account.email);
  const [role, setRole] = useState<StaffRole | ''>('');
  const { workflows } = useApp();
  const [useExplicitGrants, setUseExplicitGrants] = useState(false);
  const legacy = account.companyGrants === null;
  const editingLegacy = legacy && !useExplicitGrants;
  const legacyCompanies = INITIAL_COMPANIES.filter(company => account.isGroupAdmin || account.role === 'Director' || account.role === 'General Manager'
    || company.id === account.companyId || account.allowedCompanyIds?.includes(company.id)).map(company => company.id);
  const [companyIds, setCompanyIds] = useState<CompanyId[]>(account.companyGrants ?? legacyCompanies);
  const [formGrants, setFormGrants] = useState<FormGrants>(account.formGrants ?? Object.fromEntries(legacyCompanies.map(id => [id, [...SUBMITTABLE_FORMS]])));
  const [jobTitle, setJobTitle] = useState(account.jobTitle ?? '');
  const [routeRights, setRouteRights] = useState<NonNullable<UserProfile['routeRights']>>(account.routeRights ?? {});
  const [resetLink, setResetLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Track initial state to indicate unsaved changes
  const initialCompanyIds = useRef(account.companyGrants ?? []);
  const initialFormGrants = useRef(account.formGrants ?? {});
  const isDirty = mode === 'access' && (
    JSON.stringify(companyIds.slice().sort()) !== JSON.stringify(initialCompanyIds.current.slice().sort()) ||
    JSON.stringify(formGrants) !== JSON.stringify(initialFormGrants.current) || jobTitle !== (account.jobTitle ?? '') || JSON.stringify(routeRights) !== JSON.stringify(account.routeRights ?? {})
  );

  // Closing with unsaved access edits asks first instead of silently discarding them.
  function requestClose() {
    if (busy) return;
    if (isDirty && !resetLink) setConfirmDiscard(true);
    else onClose();
  }

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  // Display-only summary of the draft selection.
  const totalForms = companyIds.reduce((sum, id) => sum + (formGrants[id]?.length ?? 0), 0);
  const isRouteAdmin = account.isSuperAdmin || account.role === 'Director' || account.isGroupAdmin || account.isRouteAdmin || companyIds.some(id => routeRights[id]?.companyAdmin || account.companyPermissions?.[id]?.includes('manage-routes'));
  // Says where they can manage signing routes; organization-wide roles cover every company they can access.
  const organizationRouteAdmin = account.isSuperAdmin || account.role === 'Director' || account.isGroupAdmin || account.isRouteAdmin;
  const companyRouteAdmin = companyIds.filter(id => routeRights[id]?.companyAdmin || account.companyPermissions?.[id]?.includes('manage-routes'));
  const routeAdminScope = !isRouteAdmin ? 'Cannot manage signing routes'
    : organizationRouteAdmin ? 'Can manage signing routes (organization role)'
    : 'Can manage signing routes in ' + companyRouteAdmin.join(', ');
  const initials = account.name.trim().split(/\s+/).slice(0, 2).map(part => part.charAt(0)).join('');

  function toggleCompany(id: CompanyId, enabled: boolean) {
    setError('');
    setCompanyIds(ids => enabled ? [...ids, id] : ids.filter(value => value !== id));
    if (!enabled) {
      setFormGrants(grants => {
        const next = { ...grants };
        delete next[id];
        return next;
      });
    }
  }

  function toggleForm(company: CompanyId, form: string, enabled: boolean) {
    setError('');
    setFormGrants(grants => {
      const current = grants[company] ?? [];
      return { ...grants, [company]: enabled ? [...current, form] : current.filter(value => value !== form) };
    });
  }

  async function save() {
    if (busy || resetLink || (mode === 'access' && editingLegacy)) return;
    setBusy(true);
    setError('');
    try {
      if (mode === 'access') {
        const authorizedRights = Object.fromEntries(Object.entries(routeRights).filter(([id]) => companyIds.includes(id as CompanyId)));
        await repository.updateGrants(account.id, companyIds, formGrants, { jobTitle, routeRights: authorizedRights });
        onSaved(`Access updated for ${account.name}.`);
      } else if (mode === 'role') {
        if (!role) return;
        await repository.updateAccount(account.id, { role });
        onSaved(`Staff role updated for ${account.name}.`);
      } else if (mode === 'email') {
        await repository.updateAccount(account.id, { email });
        onSaved(`Sign-in email updated for ${account.name}.`);
      } else if (mode === 'status') {
        await repository.updateAccount(account.id, { isDisabled: !account.isDisabled });
        onSaved(account.isDisabled ? `${account.name}’s account was re-enabled.` : `${account.name}’s account was disabled.`);
      } else {
        setResetLink(await repository.createResetLink(account.id));
      }
    } catch (err: any) {
      // Preserve entered selections upon error; show helpful message
      setError(
        mode === 'reset'
          ? 'Could not create a reset link. Please try again.'
          : err?.message || 'Could not save the changes. Selections were preserved. Check the details and try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  const submitLabel = mode === 'access' ? 'Save access'
    : mode === 'email' ? 'Save email'
    : mode === 'role' ? 'Save role'
    : mode === 'reset' ? 'Create reset link'
    : account.isDisabled ? 'Re-enable account' : 'Disable account';

  return (
    <dialog
      ref={dialog}
      className={`preci-dialog${mode === 'access' ? ' preci-dialog-wide' : ''}`}
      aria-labelledby="account-editor-title"
      onCancel={event => {
        event.preventDefault();
        requestClose();
      }}
    >
      <form className="flex min-h-0 flex-col max-h-[90vh]" onSubmit={event => { event.preventDefault(); void save(); }}>
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-workspace-line p-4 sm:p-5 bg-white">
          <div className="flex min-w-0 items-start gap-3">
            <span className="preci-avatar" aria-hidden="true">{initials}</span>
            <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="account-editor-title" className="text-lg font-semibold tracking-tight text-slate-900">{editorTitles[mode]}</h2>
              {isDirty && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200">
                  Unsaved changes
                </span>
              )}
            </div>
            <p className="mt-1 break-all text-sm text-workspace-muted">
              {account.name} · {account.email} · <span className="font-medium text-slate-700">{account.jobTitle || account.role}</span>
            </p>
            {mode === 'access' && (
              <p className="mt-1 text-xs font-medium text-workspace-teal" aria-live="polite">
                {companyIds.length} {companyIds.length === 1 ? 'company' : 'companies'} · {totalForms} {totalForms === 1 ? 'form' : 'forms'} can be started
              </p>
            )}
            </div>
          </div>
          <button
            type="button"
            className="workspace-control preci-icon-button shrink-0"
            aria-label="Close account editor"
            disabled={busy}
            onClick={requestClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain p-4 sm:p-6 bg-slate-50/40">
          {mode === 'role' && (
            <div className="space-y-3">
              <p className="text-sm text-workspace-muted">
                Employee is the standard operational role. IT, Finance, and Admin processing roles are used for stage assignment in signing routes. Administrative titles alone do not confer signing authority.
              </p>
              <label className="preci-field">
                Staff role (currently {account.role})
                <select
                  className="workspace-control block min-h-10 px-3 text-sm"
                  value={role}
                  required
                  disabled={busy}
                  onChange={event => setRole(event.target.value as StaffRole | '')}
                >
                  <option value="">Choose role</option>
                  <option value="Employee">Employee (Standard)</option>
                  <option value="Admin">Admin processing</option>
                  <option value="IT">IT</option>
                  <option value="Finance">Finance</option>
                </select>
              </label>
            </div>
          )}

          {mode === 'access' && (
            <div className="space-y-4">
              <label className="preci-field">Job title
                <input value={jobTitle} maxLength={150} disabled={busy || editingLegacy} onChange={event => setJobTitle(event.target.value)} className="workspace-control min-h-10 w-full px-3" placeholder={account.role} />
              </label>
              <p className="text-sm text-workspace-muted">{account.isSuperAdmin ? 'Super Admin · organization-wide access' : 'Not a Super Admin · access is set per company below'}</p>
              {editingLegacy && <p className="text-sm text-workspace-muted">This account uses legacy defaults. <button type="button" className="preci-link min-h-10" onClick={() => setUseExplicitGrants(true)}>Use explicit grants</button></p>}
              <fieldset disabled={busy || editingLegacy}>
                <AccessRightsMatrix grants={companyIds} forms={formGrants} rights={routeRights} permissions={account.companyPermissions} workflows={workflows} legacy={editingLegacy}
                  onCompany={toggleCompany} onSubmit={toggleForm} onRights={(id, rights) => setRouteRights(current => ({ ...current, [id]: rights }))} />
              </fieldset>
            </div>
          )}

          {mode === 'email' && (
            <label className="preci-field">
              Sign-in email
              <input
                className="workspace-control block min-h-10 w-full px-3 font-normal"
                type="email"
                required
                maxLength={254}
                disabled={busy}
                value={email}
                onChange={event => setEmail(event.target.value)}
              />
            </label>
          )}

          {mode === 'status' && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-2">
              <p className="font-bold flex items-center gap-1.5">
                <AlertTriangle className="size-4 text-amber-700" />
                {account.isDisabled ? 'Re-enable account confirmation' : 'Disable account confirmation'}
              </p>
              <p>
                {account.isDisabled
                  ? 'The employee will be able to sign in again. Company and form access will need to be re-assigned separately.'
                  : 'The employee will be signed out immediately, active sessions revoked, and all company and form grants cleared.'}
              </p>
            </div>
          )}

          {mode === 'reset' && (
            <div className="space-y-3">
              <p className="text-sm text-workspace-muted">
                Generate a single-use password recovery link valid for 30 minutes. Share it privately with the employee.
              </p>
              {resetLink && (
                <label className="preci-field">
                  Password reset link
                  <div className="flex gap-2">
                    <input
                      className="workspace-control block min-h-10 flex-1 px-3 font-mono text-xs"
                      readOnly
                      value={resetLink}
                      onFocus={event => event.currentTarget.select()}
                    />
                    <button
                      type="button"
                      className="workspace-control px-3 font-semibold text-xs"
                      onClick={() => {
                        void navigator.clipboard.writeText(resetLink);
                        alert('Reset link copied to clipboard!');
                      }}
                    >
                      Copy
                    </button>
                  </div>
                </label>
              )}
            </div>
          )}

          {error && (
            <div role="alert" className="preci-error p-3 rounded-lg flex items-center justify-between gap-2">
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-workspace-line bg-white p-4 sm:px-5">
          {confirmDiscard ? <div role="alert" className="handoff-enter flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <span className="font-semibold">Discard unsaved access changes?</span>
            <span className="flex gap-2">
              <button type="button" className="workspace-control preci-press min-h-10 px-3 font-semibold" onClick={() => setConfirmDiscard(false)}>Keep editing</button>
              <button type="button" className="workspace-control preci-press min-h-10 px-3 font-semibold text-rose-800" onClick={onClose}>Discard</button>
            </span>
          </div> : <>
          {mode === 'access' && (
            <p className="access-after" role="status">
              <span className="font-semibold text-slate-800">After saving:</span>{' '}
              {companyIds.length > 1
                ? `Group View across ${companyIds.join(', ')}`
                : companyIds.length === 1
                ? `Single company (${companyIds[0]})`
                : 'No company access'}
              {' · '}
              {routeAdminScope}
            </p>
          )}
          <button
            type="button"
            className="workspace-control preci-press min-h-10 px-4 text-sm font-semibold text-slate-700"
            disabled={busy}
            onClick={requestClose}
          >
            {resetLink ? 'Done' : 'Cancel'}
          </button>
          {!resetLink && (
            <button
              type="submit"
              className={`workspace-primary preci-press min-h-10 px-4 text-sm font-semibold ${
                mode === 'status' && !account.isDisabled ? 'preci-danger bg-rose-700 hover:bg-rose-800 text-white' : ''
              }`}
              disabled={busy || (mode === 'access' && editingLegacy)}
            >
              <span className="morph-stack">
                <span className="morph-face" data-active={!busy} aria-hidden={busy || undefined}>{submitLabel}</span>
                <span className="morph-face" data-active={busy} aria-hidden={!busy || undefined}><Loader2 aria-hidden="true" className="size-4 animate-spin" />Saving changes…</span>
              </span>
            </button>
          )}
          </>}
        </footer>
      </form>
    </dialog>
  );
}

function AddUserDialog({
  repository,
  onClose,
  onCreated,
}: {
  repository: IAccountAdministrationRepository;
  onClose: () => void;
  onCreated: (name: string, email: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [department, setDepartment] = useState('');
  const [role, setRole] = useState<StaffRole>('Employee');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (repository.registerUser) {
        const normalizedName = name.trim();
        const normalizedEmail = email.trim().toLowerCase();
        await repository.registerUser({
          name: normalizedName,
          email: normalizedEmail,
          department: department.trim(),
          password,
          role,
        });
        await onCreated(normalizedName, normalizedEmail);
      }
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409
        ? 'This email is already in the directory. Search for the existing account to manage its access.'
        : err instanceof Error ? err.message : 'Could not create the account. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="preci-dialog"
      aria-labelledby="add-user-title"
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form aria-labelledby="add-user-title" method="post" className="flex min-h-0 flex-col" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-workspace-line p-4 sm:p-5 bg-white">
          <div>
            <h2 id="add-user-title" className="text-xl font-bold text-slate-900">Add New Employee Account</h2>
            <p className="mt-1 text-sm text-workspace-muted">
              Create a sign-in for an employee. Set their company and form access in the next step.
            </p>
          </div>
          <button
            type="button"
            className="workspace-control preci-icon-button shrink-0"
            aria-label="Close add employee dialog"
            disabled={busy}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain p-4 sm:p-5 bg-slate-50/50">
          <label className="preci-field">
            Full name *
            <input
              className="workspace-control block min-h-10 w-full px-3 text-sm font-normal"
              type="text"
              name="name"
              autoComplete="off"
              required
              pattern={/.*\S.*/.source}
              maxLength={150}
              placeholder="e.g. John Doe"
              value={name}
              onChange={event => setName(event.target.value)}
              disabled={busy}
            />
          </label>

          <label className="preci-field">
            Work email *
            <input
              className="workspace-control block min-h-10 w-full px-3 text-sm font-normal"
              type="email"
              name="email"
              autoComplete="off"
              spellCheck={false}
              required
              maxLength={254}
              placeholder="e.g. employee@company.com"
              value={email}
              onChange={event => setEmail(event.target.value)}
              disabled={busy}
            />
          </label>

          <label className="preci-field">
            Department *
            <input
              className="workspace-control block min-h-10 w-full px-3 text-sm font-normal"
              type="text"
              name="department"
              required
              pattern={/.*\S.*/.source}
              maxLength={150}
              placeholder="e.g. Engineering / Maintenance"
              value={department}
              onChange={event => setDepartment(event.target.value)}
              disabled={busy}
            />
          </label>

          <label className="preci-field">
            Staff role
            <select name="role" className="workspace-control block min-h-10 w-full px-3 text-sm font-normal" value={role}
              onChange={event => setRole(event.target.value as StaffRole)} disabled={busy}>
              <option value="Employee">Employee</option>
              <option value="Admin">Admin</option>
              <option value="IT">IT</option>
              <option value="Finance">Finance</option>
            </select>
          </label>

          <label className="preci-field">
            Temporary password (minimum 6 characters) *
            <input
              className="workspace-control block min-h-10 w-full px-3 text-sm font-normal font-mono"
              type="password"
              name="password"
              autoComplete="new-password"
              aria-describedby="add-user-password-help"
              required
              minLength={6}
              maxLength={1024}
              placeholder="••••••••"
              value={password}
              onChange={event => setPassword(event.target.value)}
              disabled={busy}
            />
          </label>
          <p id="add-user-password-help" className="text-xs text-workspace-muted">The employee must change this password when they first sign in.</p>

          {error && <div role="alert" className="preci-error p-3 rounded-lg text-xs">{error}</div>}
        </div>

        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-workspace-line bg-white p-4 sm:px-5">
          <button
            type="button"
            className="workspace-control preci-press min-h-10 px-4 text-sm font-semibold text-slate-700"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="workspace-primary preci-press min-h-10 px-4 text-sm font-semibold"
            disabled={busy}
          >
            {busy ? 'Creating…' : 'Create employee'}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
