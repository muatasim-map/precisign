import type { UserProfile, WorkflowConfig } from '../../types';
import { canAppearAsProcessor, processorTaskLabels } from '../../../../shared/utils/processorHandoff';

export function ProcessorTaskSettings({ workflow, users, onChange }: {
  workflow: WorkflowConfig; users: UserProfile[]; onChange: (value: WorkflowConfig) => void;
}) {
  const tasks = workflow.processorTasks ?? [];
  return <section className="mt-3 space-y-3" aria-label="After approval processors">
    <p className="text-sm text-workspace-muted">Choose who receives the approved request once signing is complete. Requesters see your choice as the recommendation and can change it. These people don’t sign.</p>
    {Object.entries(processorTaskLabels(workflow.formType)).map(([id, label]) => {
      const task = tasks.find(item => item.id === id);
      const people = users.filter(user => canAppearAsProcessor(user, workflow.companyId, workflow.formType, id));
      const update = (selected?: string[]) => {
        const next = tasks.filter(item => item.id !== id);
        if (selected) next.push({ id, suggestedUserIds: selected });
        onChange({ ...workflow, processorTasks: next.length ? next : undefined });
      };
      return <fieldset key={id} className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold">{label}</legend>
        <label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={!!task} onChange={event => update(event.target.checked ? [] : undefined)} /> Send approved requests to {label}</label>
        {task && (!people.length ? <p className="text-sm text-amber-800">No one can receive {label} requests in this company yet. A Super Admin grants this in User directory → Manage access.</p> : (
          <div className="grid gap-1 sm:grid-cols-2">
            {task.suggestedUserIds.some(id => !people.some(user => user.id === id)) && <p className="text-sm text-amber-800 sm:col-span-2">A saved processor has lost access. Select an eligible person to replace them.</p>}
            {people.map(user => <label key={user.id} className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" checked={task.suggestedUserIds.includes(user.id)} onChange={event => {
                const current = task.suggestedUserIds.filter(id => people.some(person => person.id === id));
                update(event.target.checked ? [...current, user.id] : current.filter(id => id !== user.id));
              }} />
              {user.name} · {user.department}
            </label>)}
          </div>
        ))}
      </fieldset>;
    })}
  </section>;
}
