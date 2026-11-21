import { useState } from 'react';
import type { UserProfile, WorkflowConfig } from '../../types';
import { useApp } from '../../context/AppContext';
import { canConfigureSigningRoutes } from '../../utils/workflowAdministration';
import { canAppearAsProcessor, processorTaskLabels, type ProcessorChoices } from '../../../../shared/utils/processorHandoff';

export function useProcessorSelection(workflow?: WorkflowConfig) {
  const key = workflow && [workflow.companyId, workflow.formType, workflow.version].join('/');
  const [state, setState] = useState<{ key?: string; choices: ProcessorChoices }>();
  const defaults = workflow?.processorTasks?.length
    ? Object.fromEntries(workflow.processorTasks.map(task => [task.id, task.suggestedUserIds]))
    : undefined;
  return {
    choices: state && state.key === key ? state.choices : defaults,
    onChange: (choices: ProcessorChoices) => setState({ key, choices }),
  };
}

export function ProcessorChoicesFields({ workflow, users, choices, onChange, connected }: {
  workflow?: WorkflowConfig; users: UserProfile[]; choices?: ProcessorChoices;
  onChange: (choices: ProcessorChoices) => void; connected?: boolean;
}) {
  const { currentUser, setActiveView } = useApp();
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  if (!workflow) return null;
  const labels = processorTaskLabels(workflow.formType);
  const canSetUp = canConfigureSigningRoutes(currentUser, workflow.companyId);
  if (!workflow.processorTasks?.length) return connected ? (
    <p className="text-sm text-workspace-muted">
      After approval, this request isn’t sent to anyone yet: processor handoff hasn’t been set up for {workflow.companyId} · {workflow.formType}.{' '}
      {canSetUp
        ? <button type="button" className="preci-link min-h-10" onClick={() => setActiveView('workflow-settings')}>Set up After approval</button>
        : 'Contact your signing route administrator to set it up.'}
    </p>
  ) : null;
  const suggested = (taskId: string) => workflow.processorTasks?.find(task => task.id === taskId)?.suggestedUserIds ?? [];
  return <section className="workspace-panel space-y-3 p-4" aria-label="Processors after approval">
    <div>
      <h3 className="font-semibold">After approval</h3>
      <p className="text-sm text-workspace-muted">Once signing is complete, the approved request is sent to the people below. They don’t sign it.</p>
    </div>
    {workflow.processorTasks.map(task => {
      const eligible = users.filter(user => canAppearAsProcessor(user, workflow.companyId, workflow.formType, task.id));
      const selected = choices?.[task.id] ?? [];
      const valid = selected.filter(id => eligible.some(person => person.id === id));
      const unavailable = selected.length !== valid.length;
      const people = valid.map(id => eligible.find(user => user.id === id)!);
      const recommended = valid.length === suggested(task.id).length && valid.every(id => suggested(task.id).includes(id));
      // The picker opens by itself whenever the current selection can't be submitted as it is.
      const forced = !valid.length || unavailable;
      const open = editing[task.id] || forced;
      const pickerId = 'processor-picker-' + task.id;
      return <div key={task.id} role="group" aria-labelledby={'processor-title-' + task.id} className="space-y-2 rounded-lg border border-slate-200 p-3">
        <p id={'processor-title-' + task.id} className="text-sm font-semibold">Send the approved request to {labels[task.id]}</p>
        {!eligible.length && <p className="text-sm text-amber-800">No one can receive {labels[task.id]} requests for {workflow.companyId} yet. {canSetUp
          ? <button type="button" className="preci-link min-h-10" onClick={() => setActiveView('user-directory')}>Grant access in User directory</button>
          : 'Ask a signing route administrator to set this up.'}</p>}
        {unavailable && <p className="text-sm text-amber-800">A suggested person can no longer receive this request. Choose someone else.</p>}
        {!!people.length && <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-sm [overflow-wrap:anywhere]">
            <span className="font-semibold">{people.map(user => user.name).join(', ')}</span>
            {recommended && <span className="ms-2 inline-block whitespace-nowrap rounded-full bg-workspace-tint px-2 py-0.5 text-xs font-semibold text-workspace-teal">Recommended</span>}
          </p>
          {!forced && <button type="button" aria-expanded={open} aria-controls={pickerId} className="preci-link -mt-2 min-h-10 shrink-0 text-sm"
            onClick={() => setEditing(current => ({ ...current, [task.id]: !open }))}>{open ? 'Done' : 'Change'}</button>}
        </div>}
        {open && eligible.length > 0 && <div id={pickerId} className="handoff-enter mt-1 grid gap-1 sm:grid-cols-2">{eligible.map(user => <label key={user.id} className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" checked={selected.includes(user.id)} onChange={event => {
            onChange({ ...choices, [task.id]: event.target.checked ? [...valid, user.id] : valid.filter(id => id !== user.id) });
          }} />
          <span>{user.name} <span className="text-workspace-muted">· {user.department}</span></span>
        </label>)}</div>}
      </div>;
    })}
  </section>;
}
