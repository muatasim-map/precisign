import { useState } from 'react';
import type { RequestRecord } from '../../types';
import { useApp } from '../../context/AppContext';
import { canConfigureSigningRoutes } from '../../utils/workflowAdministration';
import { canAppearAsProcessor, hasReadHandoff, processorTaskLabels } from '../../../../shared/utils/processorHandoff';

export function ProcessorReviewDetails({ request }: { request: RequestRecord }) {
  const { currentUser, users, reassignProcessor, readOnly } = useApp();
  const [assignment, setAssignment] = useState<{ taskId: string; from: string }>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const canEdit = readOnly && canConfigureSigningRoutes(currentUser, request.companyId);
  const tasks = request.processorHandoff ?? [];
  const labels = processorTaskLabels(request.formType);
  const choices = assignment ? users.filter(user => canAppearAsProcessor(user, request.companyId, request.formType, assignment.taskId) &&
    !tasks.find(task => task.taskId === assignment.taskId)?.userIds.includes(user.id)) : [];

  const reassignments = canEdit ? request.processorReassignments?.length ?? 0 : 0;
  const when = (at: string) => new Date(at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  return <details className="handoff-disclosure mt-1 text-xs">
    <summary className="py-1 font-semibold"><span>Details{reassignments > 0 && <span className="font-normal text-workspace-muted"> · {reassignments} {reassignments === 1 ? 'reassignment' : 'reassignments'}</span>}</span></summary>
    <p className="handoff-enter mb-2 text-workspace-muted">Opened means the approved request was viewed. It doesn’t confirm payment or completion.</p>
    <ul className="space-y-2">
      {tasks.flatMap(task => task.userIds.map(id => {
        const read = request.processorReads?.find(item => item.userId === id && item.version === request.documentVersion);
        const name = read?.name ?? users.find(user => user.id === id)?.name ?? 'Unavailable employee';
        return <li key={task.taskId + '/' + id}>
          {name} · {labels[task.taskId]}
          <span className="block tabular-nums text-workspace-muted">{read ? <>Opened <time dateTime={read.at}>{when(read.at)}</time></> : 'Not opened yet'}</span>
          {canEdit && !hasReadHandoff(request, id) && <button type="button" disabled={pending} className="preci-link min-h-8" onClick={() => { setError(''); setAssignment({ taskId: task.taskId, from: id }); }}>Reassign {name}</button>}
        </li>;
      }))}
    </ul>
    {assignment && <form className="handoff-enter mt-2 space-y-2" key={assignment.taskId + '/' + assignment.from} onSubmit={async event => {
      event.preventDefault();
      if (pending) return;
      const data = new FormData(event.currentTarget);
      setError('');
      setPending(true);
      try {
        await reassignProcessor(request.id, request.documentVersion, { ...assignment, to: String(data.get('replacement')), reason: String(data.get('reason')) });
        setAssignment(undefined);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : 'Could not reassign the request.');
      } finally { setPending(false); }
    }}>
      <label className="preci-field">Replacement
        <select name="replacement" required className="workspace-control min-h-10 w-full px-2" defaultValue="">
          <option value="">Choose an eligible processor</option>
          {choices.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select>
      </label>
      <label className="preci-field">Reason<input required maxLength={2000} name="reason" className="workspace-control min-h-10 w-full px-2" /></label>
      {error && <p role="alert" className="text-rose-700">{error}</p>}
      <button disabled={pending || !choices.length} className="workspace-primary preci-press min-h-9 px-3" type="submit">{pending ? 'Saving…' : 'Save reassignment'}</button>
      <button disabled={pending} className="preci-link min-h-9 px-2" type="button" onClick={() => setAssignment(undefined)}>Cancel</button>
    </form>}
    {canEdit && !!request.processorReassignments?.length && <div className="mt-3 space-y-1">
      <p className="font-semibold">Reassignment history</p>
      <ul className="space-y-2">{request.processorReassignments.map(event => {
        const name = (id: string) => users.find(user => user.id === id)?.name ?? 'Unavailable employee';
        return <li key={event.at + '/' + event.taskId + '/' + event.from}>
          {name(event.from)} → {name(event.to)} · {labels[event.taskId]}
          <span className="block text-workspace-muted">{name(event.actorId)} · <time dateTime={event.at}>{when(event.at)}</time></span>
          <span className="break-words">{event.reason}</span>
        </li>;
      })}</ul>
    </div>}
  </details>;
}
