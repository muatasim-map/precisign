import { useSlidingPill } from '../common/useSlidingPill';
import { useState } from 'react';
import { SUBMITTABLE_FORMS } from '../../../../shared/types/apiTypes';
import { processorTaskLabels } from '../../../../shared/utils/processorHandoff';
import type { CompanyId, RouteAccessRights, UserProfile, WorkflowConfig } from '../../types';

const companies = ['PEW', 'ICCL', 'FSG'] as const;
const formsInDisplayOrder = [...SUBMITTABLE_FORMS.slice(1), SUBMITTABLE_FORMS[0]];

export function AccessRightsMatrix({ grants, forms, rights, permissions, workflows, onCompany, onSubmit, onRights }: {
  grants: CompanyId[]; forms: Partial<Record<CompanyId, string[]>>; rights: NonNullable<UserProfile['routeRights']>;
  permissions?: UserProfile['companyPermissions']; workflows: WorkflowConfig[];
  onCompany: (id: CompanyId, mode: 'none' | 'view' | 'submit') => void;
  onSubmit: (id: CompanyId, form: string, enabled: boolean) => void;
  onRights: (id: CompanyId, rights: RouteAccessRights) => void;
}) {
  const [selected, select] = useState<CompanyId>(grants[0] ?? 'PEW');
  const [confirmClear, setConfirmClear] = useState<CompanyId>();
  const companySwitch = useSlidingPill();
  // Forms with settings when the editor opens stay open for the whole edit, so a row never collapses under the cursor.
  const [openForms, setOpenForms] = useState<Set<string>>(() => new Set(formsInDisplayOrder.filter(form => companies.some(id => grants.includes(id) && (
    (forms[id]?.includes(form) ?? false) || (rights[id]?.signerSteps?.[form]?.length ?? 0) > 0 || (rights[id]?.processorTasks?.[form]?.length ?? 0) > 0)))));
  const columnClass = (id: CompanyId) => id === selected ? '' : 'hidden md:table-cell';
  const toggle = (items: string[], id: string, enabled: boolean) => enabled ? [...items, id] : items.filter(item => item !== id);
  // Plain summary of overlapping responsibilities in one company, from the same draft values the cells edit.
  const plural = (count: number) => count + (count === 1 ? ' form' : ' forms');
  const maySubmitIn = (id: CompanyId) => rights[id]?.submission !== undefined
    ? rights[id].submission !== false
    : permissions?.[id]?.includes('requester') ?? true;
  const canStart = (id: CompanyId, form: string) => {
    const submission = rights[id]?.submission;
    return submission ? !submission.excludedForms.includes(form) : maySubmitIn(id) && (forms[id]?.includes(form) ?? false);
  };
  const summary = (id: CompanyId) => {
    const grant = rights[id] ?? {};
    const starts = SUBMITTABLE_FORMS.filter(form => canStart(id, form)).length;
    const maySign = permissions?.[id]?.includes('approver') ?? true;
    const chosen = SUBMITTABLE_FORMS.filter(form => (grant.signerSteps?.[form]?.length ?? 0) > 0).length;
    const byRules = SUBMITTABLE_FORMS.filter(form => grant.signerSteps?.[form] === undefined).length;
    const signer = !maySign ? 'Signing restricted by company role'
      : [chosen ? 'Signer steps on ' + plural(chosen) : null, byRules ? 'company signer rules on ' + plural(byRules) : null].filter(Boolean).join(', ') || 'Not in signer pickers';
    const receives = SUBMITTABLE_FORMS.filter(form => (grant.processorTasks?.[form]?.length ?? 0) > 0).length;
    return [
      'Starts ' + plural(starts),
      signer,
      receives ? 'Receives ' + plural(receives) : null,
      grant.companyAdmin ? 'Route admin' : null,
    ].filter(Boolean).join(' · ');
  };

  return <fieldset className="space-y-3">
    <legend className="access-legend">Company access rights</legend>
    <p className="text-xs text-workspace-muted">Each right is separate. <strong className="font-semibold text-slate-700">Start</strong> lets them submit the form. <strong className="font-semibold text-slate-700">Signer</strong> lets requesters choose them, but they can only sign a request they are assigned to. <strong className="font-semibold text-slate-700">Receive</strong> sends them the approved request.</p>
    <div ref={companySwitch.group} role="group" aria-label="Company" className="seg-group grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 md:hidden">
      <span aria-hidden="true" ref={companySwitch.pill} className="seg-pill seg-pill-white" />
      {companies.map(id => <button key={id} type="button" aria-pressed={selected === id} onClick={() => select(id)}
        className={'handoff-segment preci-press min-h-11 rounded-md px-2 text-start text-xs ' + (selected === id ? 'font-semibold text-slate-900' : 'text-slate-600')}>
        <span className="block">{id}</span><span className="block text-[11px] font-normal text-workspace-muted">{grants.includes(id) ? 'Granted' : 'No access'}</span>
      </button>)}
    </div>
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white md:overflow-x-visible">
      <table className="w-full table-fixed border-collapse text-left text-xs">
        <caption className="sr-only">Effective access by company and form</caption>
        <thead className="bg-slate-50">
          <tr><th scope="col" className="access-sticky-head w-[35%] p-3 md:w-1/4">Access right</th>{companies.map(id => <th scope="col" className={'access-sticky-head p-3 ' + columnClass(id)} key={id}>{id}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          <tr><th scope="row" className="p-3">Company access</th>{companies.map(id => <td key={id} className={'p-3 ' + columnClass(id)}>
            <select aria-label={id + ' access'} className="workspace-control min-h-10 w-full px-2"
              value={!grants.includes(id) ? 'none' : rights[id]?.submission || SUBMITTABLE_FORMS.some(form => canStart(id, form)) ? 'submit' : 'view'}
              onChange={event => onCompany(id, event.target.value as 'none' | 'view' | 'submit')}>
              <option value="none">No access</option>
              <option value="submit">Can submit</option>
              <option value="view">View only</option>
            </select>
            {grants.includes(id) && rights[id]?.submission !== false &&
              (rights[id]?.submission === undefined || rights[id].submission.excludedForms.length > 0) &&
              <button type="button" className="preci-link mt-1 min-h-9" onClick={() => onCompany(id, 'submit')}>Enable all forms</button>}
          </td>)}</tr>
          <tr><th scope="row" className="p-3">Company Admin</th>{companies.map(id => <td key={id} className={'p-3 ' + columnClass(id)}>
            {grants.includes(id) ? <label className="flex min-h-10 items-center gap-2">
              <input type="checkbox" checked={rights[id]?.companyAdmin === true} onChange={event => onRights(id, { ...rights[id], companyAdmin: event.target.checked })} /> Manage {id} signing routes
            </label> : '—'}
          </td>)}</tr>
          <tr><th scope="row" className="p-3">Responsibilities</th>{companies.map(id => <td key={id} className={'p-3 text-workspace-muted ' + columnClass(id)}>
            {grants.includes(id) ? summary(id) : '—'}
          </td>)}</tr>
          <tr><th scope="row" className="p-3">Signer picker</th>{companies.map(id => <td key={id} className={'p-3 ' + columnClass(id)}>
            {grants.includes(id) && (confirmClear === id
              ? <div role="alert" className="handoff-enter space-y-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
                <p>Remove {id} signer steps from all {SUBMITTABLE_FORMS.length} forms? Requesters won’t be able to choose this person until steps are added again. Requests already assigned to them aren’t changed. This applies when you save access.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="workspace-control preci-press min-h-9 px-3 font-semibold" onClick={() => { setConfirmClear(undefined); onRights(id, {
                    ...rights[id], signerSteps: Object.fromEntries(SUBMITTABLE_FORMS.map(form => [form, []])),
                  }); }}>Remove from all forms</button>
                  <button type="button" className="preci-link min-h-9 px-2" onClick={() => setConfirmClear(undefined)}>Keep</button>
                </div>
              </div>
              : <button type="button" className="workspace-control preci-press min-h-9 px-2.5 text-start text-xs font-semibold text-slate-700" onClick={() => setConfirmClear(id)}>Remove from all signer pickers…</button>)}
          </td>)}</tr>
          {formsInDisplayOrder.map(form => {
            // A form with nothing set for this person (in any company they can access) starts collapsed.
            if (!openForms.has(form)) return <tr key={form}>
              <th scope="row" className="break-words p-3 align-top"><span className="access-sticky-row">{form}</span></th>
              <td colSpan={companies.length} className="p-3 text-workspace-muted">
                <span className="me-2">Form exceptions and route permissions</span>
                <button type="button" aria-expanded="false" className="preci-link min-h-9 text-xs" onClick={() => setOpenForms(current => new Set(current).add(form))}>Show settings</button>
              </td>
            </tr>;
            return <tr key={form}>
            <th scope="row" className="break-words p-3 align-top"><span className="access-sticky-row">{form}</span></th>
            {companies.map(id => {
              const grant = rights[id] ?? {};
              const steps = workflows.find(workflow => workflow.companyId === id && workflow.formType === form)?.stages ?? [];
              const signerIds = grant.signerSteps?.[form];
              const taskIds = grant.processorTasks?.[form] ?? [];
              const maySign = permissions?.[id]?.includes('approver') ?? true;
              const maySubmit = maySubmitIn(id);
              const setSignerIds = (values?: string[]) => {
                const signerSteps = { ...grant.signerSteps };
                if (values) signerSteps[form] = values;
                else delete signerSteps[form];
                onRights(id, { ...grant, signerSteps });
              };
              return <td key={id} className={'space-y-2 p-2 align-top md:p-3 ' + columnClass(id)}>
                {grants.includes(id) ? <>
                  <label className="flex min-h-10 items-center gap-2">
                    <input type="checkbox" disabled={!maySubmit} checked={canStart(id, form)} onChange={event => onSubmit(id, form, event.target.checked)} />
                    {maySubmit ? 'Can start this form' : 'Select Can submit to allow starting forms'}
                  </label>
                  <details className="handoff-disclosure rounded-md bg-slate-50 p-2">
                    <summary className="leading-5"><span>Can be chosen as signer<span className="block text-workspace-muted">{!maySign ? 'Restricted by company role' : signerIds === undefined ? 'Follows company rules' : signerIds.length ? ('Limited to ' + signerIds.length + (signerIds.length === 1 ? ' step' : ' steps')) : 'Not offered'}</span></span></summary>
                    <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={signerIds !== undefined} onChange={event => setSignerIds(event.target.checked ? [] : undefined)} /> Limit to specific steps</label>
                    {signerIds !== undefined && (!steps.length ? <p>Configure a route to choose its steps.</p> : steps.map(step => <label key={step.id} className="flex min-h-10 items-center gap-2">
                      <input type="checkbox" checked={signerIds.includes(step.id)} onChange={event => setSignerIds(toggle(signerIds, step.id, event.target.checked))} />{step.name}
                    </label>))}
                  </details>
                  <details className="handoff-disclosure rounded-md bg-slate-50 p-2">
                    <summary className="leading-5"><span>Can receive the approved request<span className="block text-workspace-muted">{taskIds.length ? Object.entries(processorTaskLabels(form)).filter(([task]) => taskIds.includes(task)).map(([, label]) => label).join(', ') : 'Not offered'}</span></span></summary>
                    {Object.entries(processorTaskLabels(form)).map(([task, label]) => <label key={task} className="flex min-h-10 items-center gap-2">
                      <input type="checkbox" checked={taskIds.includes(task)} onChange={event => onRights(id, { ...grant, processorTasks: { ...grant.processorTasks, [form]: toggle(taskIds, task, event.target.checked) } })} />{label}
                    </label>)}
                  </details>
                </> : <span className="text-workspace-muted">—</span>}
              </td>;
            })}
          </tr>;
          })}
        </tbody>
      </table>
    </div>
  </fieldset>;
}
