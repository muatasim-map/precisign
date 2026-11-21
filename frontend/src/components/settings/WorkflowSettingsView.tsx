import { PageHeader } from '../common/PageHeader';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, CircleCheck, Pencil, Plus, Route, Trash2, UserRound, Users } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useApp } from '../../context/AppContext';
import type { CompanyId, UserProfile, WorkflowConfig, WorkflowStageConfig } from '../../types';
import { canAppearAsSigner, canBeAssignedApproval, canUserAccessCompany } from '../../utils/companyAccess';
import { canConfigureSigningRoutes } from '../../utils/workflowAdministration';
import { canJoinCompanyProcessingTeam } from '../../utils/routeProcessing';
import { newSigningStep, routeDraft, routeForms, type RouteForm } from '../../utils/routeForms';
import { LegacyWorkflowSettingsView } from './LegacyWorkflowSettingsView';
import { EditorSelect } from '../create/RequestEditorControls';
import { EmptyState } from '../common/EmptyState';
import { ProcessorTaskSettings } from './ProcessorTaskSettings';
import { processorTaskLabels } from '../../../../shared/utils/processorHandoff';

/** One line naming who receives the approved request, e.g. "Sends to Accounts: Bala Test, Dina Test". */
function handoffSummary(route: WorkflowConfig, people: UserProfile[]) {
  const labels = processorTaskLabels(route.formType);
  if (!route.processorTasks?.length) return 'Not sent to anyone yet';
  return route.processorTasks.map(task => 'Sends to ' + labels[task.id] + ': ' + (task.suggestedUserIds.length
    ? task.suggestedUserIds.map(id => people.find(person => person.id === id)?.name ?? 'Unavailable employee').join(', ')
    : 'choose people')).join(' · ');
}
import { describeRouteChanges, moveIntermediate, skipExample, stepIssues, stepLabel, type StepIssues } from './signingRouteModel';

type Selection = { company: CompanyId | ''; form: RouteForm; legacy: boolean };

/** Eligibility problems show as soon as they exist; an empty step name waits until the admin tries to save. */
const visibleIssues = (issues: StepIssues, afterSave: boolean): StepIssues => afterSave ? issues : { signer: issues.signer, backups: issues.backups };

function PeoplePicker({ label, people, selected, onChange, exclude = [], describedBy, invalid, hideLegend }: {
  hideLegend?: boolean; label: string; people: UserProfile[]; selected: string[]; exclude?: string[]; onChange: (ids: string[]) => void; describedBy?: string; invalid?: boolean;
}) {
  const [query, setQuery] = useState('');
  const visible = people.filter(person => !exclude.includes(person.id) && person.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <fieldset className="min-w-0 space-y-2" aria-describedby={describedBy} aria-invalid={invalid || undefined}>
    <legend className={hideLegend ? "sr-only" : "text-sm font-semibold"}>{label} <span className="text-xs font-normal text-workspace-muted">· Optional</span></legend>
    {people.length > 5 && <input type="search" aria-label={`Search ${label.toLowerCase()}`} placeholder="Find an employee…" className="workspace-control min-h-10 w-full px-3 text-sm"
      value={query} onChange={event => setQuery(event.target.value)} />}
    <div className={`space-y-1 rounded-lg border bg-white p-1.5 ${invalid ? 'border-rose-300' : 'border-workspace-line'} ${visible.length > 6 ? 'max-h-56 overflow-y-auto overscroll-contain' : ''}`}>
      {visible.map(person =>
        <label key={person.id} className="preci-form-option">
          <input className="preci-check" type="checkbox" checked={selected.includes(person.id)}
            onChange={event => onChange(event.target.checked ? [...selected, person.id] : selected.filter(id => id !== person.id))} />
          <span className="min-w-0 break-words">{person.name}</span>
        </label>)}
      {visible.length === 0 && <p className="p-2 text-xs text-workspace-muted">No eligible employees match.</p>}
    </div>
    {selected.some(id => !people.some(person => person.id === id) || exclude.includes(id)) && <p className="text-xs text-rose-700">A saved selection is no longer available. <button type="button" className="preci-link" onClick={() => onChange(selected.filter(id => people.some(person => person.id === id) && !exclude.includes(id)))}>Remove unavailable selections</button></p>}
    <p className="text-xs text-workspace-muted">{selected.length} selected{visible.length > 6 ? ' · scroll for more employees' : ''}</p>
  </fieldset>;
}

/** Asks before discarding edits. Focus lands on "Keep editing", the safe choice. */
function DiscardPrompt({ message, onKeep, onDiscard }: { message: string; onKeep: () => void; onDiscard: () => void }) {
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => { keep.current?.focus(); }, []);
  return <section role="alertdialog" aria-labelledby="route-discard-title" aria-describedby="route-discard-text" className="route-discard workspace-panel space-y-3 p-4 text-sm">
    <h2 id="route-discard-title" className="font-semibold text-workspace-ink">Discard unsaved route changes?</h2>
    <p id="route-discard-text" className="text-workspace-muted">{message}</p>
    <div className="flex flex-wrap gap-2">
      <button ref={keep} type="button" className="workspace-control min-h-11 px-4 font-semibold" onClick={onKeep}>Keep editing</button>
      <button type="button" className="workspace-control min-h-11 border-rose-200 px-4 font-semibold text-rose-800" onClick={onDiscard}>Discard changes</button>
    </div>
  </section>;
}

export function WorkflowSettingsView() {
  const { companies, currentUser, selectedScope, setUnsavedWork } = useApp();
  const [company, setCompany] = useState<CompanyId | ''>(selectedScope === 'PEG' ? '' : selectedScope);
  const [form, setForm] = useState<RouteForm>('Administrative & Payment Request');
  const [legacy, setLegacy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [change, setChange] = useState<Selection | null>(null);
  const guardKey = useMemo(() => Symbol('signing-route-editor'), []);
  useEffect(() => { setUnsavedWork(guardKey, dirty); return () => setUnsavedWork(guardKey, false); }, [dirty, guardKey, setUnsavedWork]);
  if (!canConfigureSigningRoutes(currentUser)) return <p role="alert" className="p-6">Ask a signing route administrator to configure this form.</p>;

  function apply(next: Selection) { setDirty(false); setCompany(next.company); setForm(next.form); setLegacy(next.legacy); setChange(null); }
  function navigate(next: Selection) { if (dirty) setChange(next); else apply(next); }

  return <div className="settings-page space-y-6">
    <PageHeader motif="routes" eyebrow="Administration" title="Signing routes" subtitle="Set up a company’s suggested signers. Employees choose who signs each request." />
    <fieldset disabled={pending} className="workspace-panel grid min-w-0 gap-4 p-5 sm:grid-cols-2">
      <legend className="sr-only">Route to view</legend>
      <label className="text-sm font-semibold">Company
        <EditorSelect className="mt-1 font-normal" value={company} onChange={event => navigate({ company: event.target.value as CompanyId, form, legacy: false })}>
          <option value="" disabled>Choose a legal company</option>
          {companies.filter(item => canUserAccessCompany(currentUser, item.id)).map(item => <option key={item.id} value={item.id}>{item.fullName}</option>)}
        </EditorSelect>
      </label>
      <label className="text-sm font-semibold">Form
        <EditorSelect className="mt-1 font-normal" value={form} onChange={event => navigate({ company, form: event.target.value as RouteForm, legacy: false })}>
          {Object.keys(routeForms).map(name => <option key={name}>{name}</option>)}
        </EditorSelect>
      </label>
    </fieldset>
    {change && <DiscardPrompt message="Switching company or form discards the changes you have not saved." onKeep={() => setChange(null)} onDiscard={() => apply(change)} />}
    {legacy ? <LegacyWorkflowSettingsView /> : company && canUserAccessCompany(currentUser, company)
      ? <SigningRouteSection key={company + form} companyId={company} form={form} onDirty={setDirty} onPending={setPending} />
      : <div className="workspace-panel"><EmptyState title="Choose a legal company" description="Pick a company above to set up who signs each form." /></div>}
    <section aria-labelledby="route-advanced" className="flex flex-wrap items-center justify-between gap-3 border-t border-workspace-line pt-5">
      <div><h2 id="route-advanced" className="text-sm font-semibold text-workspace-ink">Advanced</h2>
        <p className="mt-0.5 text-xs text-workspace-muted">{legacy ? 'You are viewing the legacy settings.' : 'Older forms may still use the legacy route settings.'}</p></div>
      <button type="button" disabled={pending} className="workspace-control min-h-10 px-3 text-sm font-medium" onClick={() => navigate({ company, form, legacy: !legacy })}>{legacy ? 'Back to current forms' : 'Legacy signing route settings'}</button>
    </section>
  </div>;
}

function Marker({ children, tone = 'default' }: { children: ReactNode; tone?: 'default' | 'active' | 'muted' }) {
  return <span aria-hidden="true" className="route-rail-marker route-marker-halo" data-tone={tone}>{children}</span>;
}

/** Read-only vertical diagram of a route. Signer names lead; step names and rules follow. */
function RouteDiagram({ form, route, people, suggestion }: { form: RouteForm; route: WorkflowConfig; people: UserProfile[]; suggestion?: boolean }) {
  const labels = routeForms[form];
  const total = route.stages.length + 1;
  const name = (id?: string) => id ? people.find(person => person.id === id)?.name ?? 'Unavailable employee' : null;
  return <ol className="route-rail" aria-label={`Signing order, ${total} steps`}>
    <li className="route-rail-step">
      <Marker>1</Marker>
      <div className="route-rail-card">
        <p className="route-rail-signer">The requester</p>
        <p className="route-rail-meta">{labels.requester} · Signs when submitting</p>
      </div>
    </li>
    {route.stages.map((step, index) => {
      const signer = name(step.assignedUserId);
      const backups = (step.backupSignerIds ?? []).map(id => name(id)!);
      const required = step.isFinalApproval;
      return <li key={step.id} className="route-rail-step">
        <Marker tone={required ? 'active' : 'default'}>{index + 2}</Marker>
        <div className="route-rail-card">
          <p className="route-rail-meta route-rail-step-name">{stepLabel(form, step)}</p>
          <p className={`route-rail-signer ${signer ? '' : 'route-rail-signer-open'}`}>
            {signer ?? 'Requester chooses'}
            <span className="sr-only">{signer ? (suggestion ? ', suggested signer (not saved)' : ', suggested signer') : ''}</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`route-pill ${required ? 'route-pill-required' : ''}`}>{required ? <><CircleCheck aria-hidden="true" className="size-3.5" /> Required step</> : 'Optional step'}</span>
            {signer && <span className="route-pill route-pill-quiet">{suggestion ? 'Suggestion' : 'Suggested signer'}</span>}
          </div>
          {backups.length > 0 && <p className="route-rail-backups"><Users aria-hidden="true" className="size-3.5 shrink-0" /><span><span className="text-workspace-muted">Backup{backups.length > 1 ? 's' : ''}: </span><strong>{backups.join(', ')}</strong></span></p>}
        </div>
      </li>;
    })}
  </ol>;
}

function SigningRouteSection({ companyId, form, onDirty, onPending }: {
  companyId: CompanyId; form: RouteForm; onDirty: (dirty: boolean) => void; onPending: (busy: boolean) => void;
}) {
  const { workflows, users, companies, saveWorkflow, readOnly: connected } = useApp();
  const reduceMotion = useReducedMotion();
  const saved = workflows.find(route => route.companyId === companyId && route.formType === form);
  const company = companies.find(item => item.id === companyId);
  const companyName = company?.fullName ?? companyId;
  const labels = routeForms[form];
  const eligible = useMemo(() => users.filter(person => canBeAssignedApproval(person, companyId)).sort((a, b) =>
    Number(!!(b.isSuperAdmin || b.isGroupAdmin || b.role === 'Admin')) - Number(!!(a.isSuperAdmin || a.isGroupAdmin || a.role === 'Admin')) || a.name.localeCompare(b.name)), [users, companyId]);

  const [draft, setDraft] = useState<WorkflowConfig | null>(null);
  /** The saved route this draft was started from (or last reconciled with). */
  const [base, setBase] = useState<WorkflowConfig | undefined>(undefined);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const [showIssues, setShowIssues] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const saving = useRef(false);
  const cards = useRef(new Map<string, HTMLElement>());
  const flip = useRef<Map<string, number> | null>(null);
  const pendingFocus = useRef<{ id: string; direction: 'earlier' | 'later' } | null>(null);
  const editHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);

  const editing = draft !== null;
  const changes = useMemo(() => draft ? describeRouteChanges(form, base, draft, users) : [], [draft, base, form, users]);
  const conflict = editing && (saved?.version ?? 0) !== draft.version;
  const latestChanges = useMemo(() => draft && conflict ? describeRouteChanges(form, saved, draft, users) : [], [draft, conflict, saved, form, users]);
  const dirty = editing && touched && (base ? changes.length > 0 : true);
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty(false), [onDirty]);
  const issues = useMemo(() => new Map((draft?.stages ?? []).map(step => [step.id, stepIssues(step, eligible.filter(person => canAppearAsSigner(person, companyId, form, step.id)), companyName)])), [draft, eligible, companyId, form, companyName]);
  const hasIssues = [...issues.values()].some(item => item.name || item.signer || item.backups);

  // Keep focus with a moved step and, for pointer moves, let the cards glide to their new places.
  useLayoutEffect(() => {
    const before = flip.current;
    flip.current = null;
    if (before) for (const [id, top] of before) {
      const element = cards.current.get(id);
      if (!element) continue;
      const delta = top - element.getBoundingClientRect().top;
      if (delta) element.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], { duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    }
    const focus = pendingFocus.current;
    pendingFocus.current = null;
    if (focus) {
      const wanted = document.querySelector<HTMLButtonElement>(`[data-move="${focus.id}:${focus.direction}"]`);
      const other = document.querySelector<HTMLButtonElement>(`[data-move="${focus.id}:${focus.direction === 'earlier' ? 'later' : 'earlier'}"]`);
      (wanted && !wanted.disabled ? wanted : other && !other.disabled ? other : cards.current.get(focus.id))?.focus();
    }
  }, [draft]);

  function startEditing() {
    setDraft(routeDraft(companyId, form, saved)); setBase(saved); setTouched(false); setFeedback(''); setError(''); setShowIssues(false);
    requestAnimationFrame(() => editHeading.current?.focus());
  }
  function stopEditing(message = '') {
    setDraft(null); setBase(undefined); setTouched(false); setConfirmCancel(false); setShowIssues(false); setError(''); setActiveStep(null); setFeedback(message);
    requestAnimationFrame(() => reviewHeading.current?.focus());
  }
  function update(next: WorkflowConfig) { setDraft(next); setTouched(true); setFeedback(''); setError(''); }
  function updateStep(id: string, fields: Partial<WorkflowStageConfig>) {
    if (draft) update({ ...draft, stages: draft.stages.map(step => step.id === id ? { ...step, ...fields } : step) });
  }
  function move(index: number, direction: 'earlier' | 'later', pointer: boolean) {
    if (!draft) return;
    const stages = moveIntermediate(draft.stages, index, direction === 'earlier' ? -1 : 1);
    if (!stages) return;
    const step = draft.stages[index];
    if (pointer && !reduceMotion) flip.current = new Map(draft.stages.map(item => [item.id, cards.current.get(item.id)?.getBoundingClientRect().top ?? 0]));
    pendingFocus.current = { id: step.id, direction };
    const position = stages.findIndex(item => item.id === step.id) + 2;
    setAnnouncement(`${stepLabel(form, step)} moved to step ${position} of ${stages.length + 1}.`);
    setActiveStep(step.id);
    update({ ...draft, stages });
  }
  function reconcileWithLatest() {
    if (!draft) return;
    // The admin has seen the latest route: compare against it and require an explicit save.
    setDraft({ ...draft, version: saved?.version ?? 0 }); setBase(saved); setTouched(true); setError('');
    setFeedback('Your draft is now compared with the latest saved route. Review the changes, then save again.');
  }
  function focusFirstIssue() {
    const first = draft?.stages.find(step => { const item = issues.get(step.id); return item && (item.name || item.signer || item.backups); });
    if (!first) return;
    const item = issues.get(first.id)!;
    const target = document.getElementById(`${first.id}-${item.name ? 'name' : item.signer ? 'signer' : 'backups'}`);
    (target?.querySelector<HTMLElement>('input, select') ?? target)?.focus();
  }

  async function save() {
    if (!draft || saving.current) return;
    if (hasIssues || !eligible.length || conflict) {
      setShowIssues(true);
      setError(conflict ? 'Another administrator saved this route. Compare your draft with the latest route below, then save again.'
        : !eligible.length ? 'Assign company access to employees before setting up this route.' : 'Fix the highlighted steps before saving.');
      requestAnimationFrame(() => (hasIssues && !conflict && eligible.length ? focusFirstIssue() : errorRef.current?.focus()));
      return;
    }
    saving.current = true; setBusy(true); onPending(true); setError('');
    try {
      await saveWorkflow({ ...draft, version: connected ? draft.version : draft.version + 1,
        stages: draft.stages.map((step, index) => ({ ...step, stageNumber: index + 1 })) });
      stopEditing(`Signing route saved for ${companyName} · ${form}. New requests will use it.`);
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : '';
      setError(/changed|conflict/i.test(message)
        ? 'Another administrator saved this route first. Your draft is still here. Compare it with the latest route below, then save again.'
        : message || 'Could not save. Your changes are still here.');
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally { saving.current = false; setBusy(false); onPending(false); }
  }

  const status = <>
    {feedback && <p role="status" className="route-feedback rounded-lg border border-teal-200 bg-workspace-tint p-3 text-sm">{feedback}</p>}
    {error && <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
  </>;

  // ----- Review mode -----
  if (!draft) {
    const example = saved ? skipExample(form, saved) : null;
    return <div className="route-layout">
      <section className="workspace-panel route-panel min-w-0" aria-labelledby="route-review-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="route-review-title" ref={reviewHeading} tabIndex={-1} className="text-lg font-semibold text-workspace-ink">Saved route</h2>
            <p className="mt-0.5 text-xs text-workspace-muted">{companyName} · {form}{saved ? ` · Version ${saved.version}` : ''}</p>
          </div>
          {saved && <button type="button" className="workspace-primary route-press inline-flex min-h-11 items-center gap-2 px-4 text-sm font-semibold" onClick={startEditing}><Pencil aria-hidden="true" className="size-4" />Edit route</button>}
        </div>
        <div className="mt-4 space-y-3">{status}</div>
        {saved
          ? <div className="mt-4"><RouteDiagram form={form} route={saved} people={users} /></div>
          : <div className="route-empty mt-4">
            <Route aria-hidden="true" className="size-6 text-workspace-teal" />
            <h3 className="font-semibold text-workspace-ink">No saved signing route for this form</h3>
            <p className="max-w-sm text-sm text-workspace-muted">Set up who signs {form} requests for {companyName}. Default steps are filled in as suggestions until you save.</p>
            <button type="button" className="workspace-primary route-press inline-flex min-h-11 items-center gap-2 px-4 text-sm font-semibold" onClick={startEditing}><Plus aria-hidden="true" className="size-4" />Set up route</button>
          </div>}
        {saved && <p className="mt-4 text-sm"><span className="font-semibold">After approval</span> · {handoffSummary(saved, users)}</p>}
        {saved && (saved.processingUserIds?.length ?? 0) > 0 && <p className="mt-4 text-xs text-workspace-muted">Processing team: {(saved.processingUserIds ?? []).map(id => users.find(person => person.id === id)?.name ?? 'Unavailable employee').join(', ')}</p>}
      </section>
      {example && <aside className="workspace-panel route-panel route-note" aria-labelledby="route-skip-title">
        <h2 id="route-skip-title" className="text-sm font-semibold text-workspace-ink">When a review step is skipped</h2>
        <p className="mt-1 text-sm text-workspace-muted">{example}</p>
      </aside>}
    </div>;
  }

  // ----- Edit mode -----
  const intermediate = draft.stages.length - 1;
  const example = skipExample(form, draft);
  return <div className="route-layout">
    <section className="workspace-panel route-panel min-w-0" aria-labelledby="route-edit-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="route-edit-title" ref={editHeading} tabIndex={-1} className="text-lg font-semibold text-workspace-ink">{saved ? 'Edit route' : 'Set up route'}</h2>
          <p className="mt-0.5 text-xs text-workspace-muted">{companyName} · {form}{base ? '' : ' · Suggested steps, not saved yet'}</p>
        </div>
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>
      <div className="mt-4 space-y-3">{status}</div>
      {conflict && <ConflictPanel form={form} latest={saved} people={users} differences={latestChanges} onReconcile={reconcileWithLatest}
        onDiscard={() => { setDraft(routeDraft(companyId, form, saved)); setBase(saved); setTouched(false); setError(''); setFeedback('Loaded the latest saved route. Your earlier draft was discarded.'); }} />}
      <fieldset disabled={busy} className="mt-4 min-w-0">
        <legend className="sr-only">Signing steps</legend>
        <ol className="route-rail route-rail-edit">
          <li className="route-rail-step">
            <Marker tone="muted">1</Marker>
            <div className="route-rail-card">
              <p className="route-rail-signer">The requester</p>
              <p className="route-rail-meta">{labels.requester} · Signs when submitting · Always first</p>
            </div>
          </li>
          {draft.stages.map((step, index) => <StepEditor key={step.id} form={form} step={step} index={index} intermediateCount={intermediate}
            eligible={eligible.filter(person => canAppearAsSigner(person, companyId, form, step.id))} issues={visibleIssues(issues.get(step.id)!, showIssues)} active={activeStep === step.id} suggestion={!base}
            register={element => { if (element) cards.current.set(step.id, element); else cards.current.delete(step.id); }}
            onActivate={() => setActiveStep(step.id)} onMove={(direction, pointer) => move(index, direction, pointer)}
            onChange={fields => updateStep(step.id, fields)}
            onRemove={() => { update({ ...draft, stages: draft.stages.filter(item => item.id !== step.id) }); setAnnouncement(`${stepLabel(form, step)} removed.`); }}
            bypass={step.isFinalApproval ? { value: draft.allowFinalBypass === true, onChange: value => update({ ...draft, allowFinalBypass: value }) } : undefined} />)}
        </ol>
        <div className="mt-4 flex flex-wrap gap-2 ps-12">
          <button type="button" disabled={draft.stages.length >= 20} className="workspace-control route-press inline-flex min-h-11 items-center gap-2 px-3 text-sm" onClick={() => update({ ...draft, stages: [...draft.stages.slice(0, -1), newSigningStep('Additional review', false), draft.stages.at(-1)!] })}><Plus aria-hidden="true" className="size-4" />Add review step</button>
          {labels.department && !draft.stages.some(step => step.documentSlot === 'department-head') && <button type="button" className="workspace-control route-press min-h-11 px-3 text-sm" onClick={() => update({ ...draft, stages: [newSigningStep(labels.department!, false, 'department-head'), ...draft.stages] })}>Add {labels.department}</button>}
        </div>
        {labels.processing && <p className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-workspace-muted">{labels.processing}</p>}
        <details className="route-accordion mt-4 rounded-lg border border-workspace-line p-4">
          <summary>
            <span><strong>Processing team and read access</strong>
              <small>{(draft.processingUserIds ?? []).length} selected · who records the work or payment after signing</small></span>
            <ChevronDown aria-hidden="true" className="route-accordion-chevron size-4" />
          </summary>
          <p className="my-3 text-xs text-workspace-muted">Choose employees who handle the work or payment after signing. Their existing staff role determines processing actions.</p>
          <PeoplePicker label="Processing team" people={users.filter(person => canJoinCompanyProcessingTeam(form, person, companyId))} selected={draft.processingUserIds ?? []} onChange={ids => update({ ...draft, processingUserIds: ids })} />
          {form === 'Cash Voucher' && <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" className="preci-check" checked={draft.allowCashReceiptWaiver ?? false} onChange={event => update({ ...draft, allowCashReceiptWaiver: event.target.checked })} />Allow authorized cash receipt waivers</label>}
        </details>
        <details className="route-accordion mt-4 rounded-lg border border-workspace-line p-4">
          <summary>
            <span><strong>After approval</strong>
              <small>{handoffSummary(draft, users)}</small></span>
            <ChevronDown aria-hidden="true" className="route-accordion-chevron size-4" />
          </summary>
          <ProcessorTaskSettings workflow={draft} users={users} onChange={update} />
        </details>
      </fieldset>
    </section>
    <aside className="route-aside" aria-label="Save route">
      <section className="workspace-panel route-panel route-summary" aria-labelledby="route-summary-title">
        <h2 id="route-summary-title" className="text-base font-semibold text-workspace-ink">Changes to save</h2>
        <p className="mt-0.5 text-xs text-workspace-muted">{companyName} · {form}</p>
        {changes.length
          ? <ul className="mt-3 space-y-1.5" aria-label="Changes">{changes.map(item => <li key={item} className="route-change"><CircleCheck aria-hidden="true" className="size-4 shrink-0 text-workspace-teal" /><span>{item}</span></li>)}</ul>
          : <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-workspace-muted">No changes yet. Edit a step to see what Save will change.</p>}
        <p className="mt-3 text-xs text-workspace-muted">Applies to new requests for this company and form. Submitted requests keep their existing route and history.</p>
        {confirmCancel && <div className="mt-3"><DiscardPrompt message="Cancelling discards the changes you have not saved." onKeep={() => setConfirmCancel(false)} onDiscard={() => stopEditing()} /></div>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" disabled={busy} className="workspace-control route-press min-h-11 px-3 text-sm font-semibold" onClick={() => dirty ? setConfirmCancel(true) : stopEditing()}>Cancel</button>
          <button type="button" disabled={busy || (!!base && changes.length === 0)} className="workspace-primary route-press min-h-11 px-3 text-sm font-semibold" onClick={() => void save()}>{busy ? 'Saving…' : 'Save route'}</button>
        </div>
      </section>
      {example && <section className="workspace-panel route-panel route-note" aria-labelledby="route-skip-title">
        <h2 id="route-skip-title" className="text-sm font-semibold text-workspace-ink">When a review step is skipped</h2>
        <p className="mt-1 text-sm text-workspace-muted">{example}</p>
      </section>}
    </aside>
  </div>;
}

function ConflictPanel({ form, latest, people, differences, onReconcile, onDiscard }: {
  form: RouteForm; latest?: WorkflowConfig; people: UserProfile[]; differences: string[]; onReconcile: () => void; onDiscard: () => void;
}) {
  return <section className="route-conflict mt-4 space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm" aria-labelledby="route-conflict-title">
    <div className="flex gap-2"><AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-700" />
      <div><h3 id="route-conflict-title" className="font-semibold text-amber-950">Another administrator saved this route{latest ? ` (version ${latest.version})` : ''}</h3>
        <p className="mt-0.5 text-amber-900">Your draft is kept. Compare it with the latest saved route, then choose how to continue. Nothing is saved until you press Save route.</p></div></div>
    {differences.length > 0 && <div><p className="font-semibold text-amber-950">Your draft differs from the latest route:</p>
      <ul className="mt-1 list-disc space-y-0.5 ps-5 text-amber-900">{differences.map(item => <li key={item}>{item}</li>)}</ul></div>}
    {latest && <details className="rounded-lg bg-white p-3"><summary className="cursor-pointer font-semibold text-workspace-ink">Show the latest saved route</summary>
      <div className="mt-3"><RouteDiagram form={form} route={latest} people={people} /></div></details>}
    <div className="flex flex-wrap gap-2">
      <button type="button" className="workspace-primary route-press min-h-11 px-3 font-semibold" onClick={onReconcile}>Keep my draft and compare</button>
      <button type="button" className="workspace-control route-press min-h-11 px-3 font-semibold" onClick={onDiscard}>Use the latest route</button>
    </div>
  </section>;
}

function StepEditor({ form, step, index, intermediateCount, eligible, issues, active, suggestion, register, onActivate, onMove, onChange, onRemove, bypass }: {
  form: RouteForm; step: WorkflowStageConfig; index: number; intermediateCount: number; eligible: UserProfile[]; issues: StepIssues; active: boolean; suggestion: boolean;
  register: (element: HTMLElement | null) => void; onActivate: () => void; onMove: (direction: 'earlier' | 'later', pointer: boolean) => void;
  onChange: (fields: Partial<WorkflowStageConfig>) => void; onRemove: () => void; bypass?: { value: boolean; onChange: (value: boolean) => void };
}) {
  const final = step.isFinalApproval;
  const label = stepLabel(form, step);
  const canEarlier = !final && index > 0;
  const canLater = !final && index < intermediateCount - 1;
  const id = step.id;
  const invalid = !!(issues.name || issues.signer || issues.backups);
  return <li className="route-rail-step">
    <Marker tone={active ? 'active' : 'default'}>{index + 2}</Marker>
    <div ref={register} tabIndex={-1} className="route-rail-card route-edit-card" data-active={active || undefined} data-invalid={invalid || undefined}
      onFocus={onActivate} onPointerDown={onActivate} aria-label={`Step ${index + 2}: ${label}`} role="group">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold text-workspace-ink">{label}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-workspace-muted">
            <span className={`route-pill ${final ? 'route-pill-required' : ''}`}>{final ? <><CircleCheck aria-hidden="true" className="size-3.5" /> Required step · Always last</> : 'Optional step'}</span>
            {suggestion && <span className="route-pill route-pill-quiet">Suggestion until saved</span>}
          </p>
        </div>
        {!final && <div className="flex shrink-0 items-start gap-1.5">
          <div className="route-move" role="group" aria-label={`Reorder ${label}`}>
            <button type="button" data-move={`${id}:earlier`} aria-label={`Move ${label} earlier`} disabled={!canEarlier} className="route-move-button"
              onClick={event => onMove('earlier', event.detail > 0)}><ChevronUp aria-hidden="true" className="size-4" /></button>
            <button type="button" data-move={`${id}:later`} aria-label={`Move ${label} later`} disabled={!canLater} className="route-move-button"
              onClick={event => onMove('later', event.detail > 0)}><ChevronDown aria-hidden="true" className="size-4" /></button>
          </div>
          <button type="button" aria-label={`Remove ${label}`} className="route-move-button route-remove" onClick={onRemove}><Trash2 aria-hidden="true" className="size-4" /></button>
        </div>}
      </div>
      {!final && !step.documentSlot && <div id={`${id}-name`} className="mt-4">
        <label className="block text-sm font-semibold" htmlFor={`${id}-name-input`}>Review step name</label>
        <input id={`${id}-name-input`} className="workspace-control mt-1 block min-h-11 w-full px-3" maxLength={150} value={step.name} aria-invalid={!!issues.name || undefined}
          aria-describedby={issues.name ? `${id}-name-issue` : undefined} onChange={event => onChange({ name: event.target.value })} />
        {issues.name && <p id={`${id}-name-issue`} className="route-issue"><AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />{issues.name}</p>}
      </div>}
      <div className="route-signer-group mt-4">
        <div id={`${id}-signer`}>
          <label className="flex items-center gap-1.5 text-sm font-semibold" htmlFor={`${id}-signer-input`}><UserRound aria-hidden="true" className="size-4 text-workspace-muted" />{final ? 'Suggested final approver' : 'Suggested signer'}</label>
          <EditorSelect id={`${id}-signer-input`} className={`mt-1 font-normal ${issues.signer ? 'border-rose-400' : ''}`} value={step.assignedUserId ?? ''} aria-invalid={!!issues.signer || undefined}
            aria-describedby={issues.signer ? `${id}-signer-issue` : undefined} onChange={event => {
              const person = eligible.find(item => item.id === event.target.value);
              onChange({ assignedUserId: person?.id, assignedRole: person?.role, backupSignerIds: step.backupSignerIds?.filter(other => other !== person?.id) });
            }}>
            <option value="">Requester chooses</option>
            {step.assignedUserId && !eligible.some(person => person.id === step.assignedUserId) && <option value={step.assignedUserId}>Unavailable employee — choose another</option>}
            {eligible.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
          </EditorSelect>
          {issues.signer && <p id={`${id}-signer-issue`} className="route-issue"><AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />{issues.signer}</p>}
        </div>
        <details id={`${id}-backups`} className="route-backups mt-3" open={issues.backups ? true : undefined}>
          <summary className="route-backups-summary">
            <span className="min-w-0"><span className="flex items-center gap-1.5 text-sm font-semibold"><Users aria-hidden="true" className="size-4 text-workspace-muted" />{final ? 'Backup approvers' : 'Backup signers'}</span>
              <span className="mt-0.5 block text-xs text-workspace-muted">{(step.backupSignerIds ?? []).length
                ? (step.backupSignerIds ?? []).map(backup => eligible.find(person => person.id === backup)?.name ?? 'Unavailable employee').join(', ')
                : 'None · Optional'}</span></span>
            <span className="route-backups-action">Change<ChevronDown aria-hidden="true" className="route-accordion-chevron size-4" /></span>
          </summary>
          <div className="mt-3"><PeoplePicker label={final ? 'Backup approvers' : 'Backup signers'} people={eligible} selected={step.backupSignerIds ?? []} exclude={step.assignedUserId ? [step.assignedUserId] : []}
            hideLegend invalid={!!issues.backups} describedBy={issues.backups ? `${id}-backups-issue` : undefined}
            onChange={ids => onChange({ backupSignerIds: ids, backupCompletionUserIds: undefined })} /></div>
        </details>
        {issues.backups && <p id={`${id}-backups-issue`} className="route-issue"><AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />{issues.backups}</p>}
        <p className="mt-2 text-xs text-workspace-muted">Backups are inactive until the step is reassigned to them. Employees can choose other eligible company users for their request.</p>
      </div>
      {bypass && <label className="mt-4 flex items-start gap-3 rounded-lg bg-white/70 p-3 text-sm">
        <input type="checkbox" className="preci-check mt-0.5" checked={bypass.value} onChange={event => bypass.onChange(event.target.checked)} />
        <span><strong>Allow bypass</strong><span className="mt-1 block text-xs text-workspace-muted">The assigned final approver can complete early with a reason. Their own signature is required.</span></span>
      </label>}
      {step.documentSlot && <p className="mt-3 text-xs text-workspace-muted">Uses the form’s {routeForms[form].department} signature space.</p>}
      {!step.documentSlot && !final && <p className="mt-3 text-xs text-workspace-muted">Recorded in signing history. No signature space is added to the printed form.</p>}
    </div>
  </li>;
}
