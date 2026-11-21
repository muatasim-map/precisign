import { useState } from 'react';
import { Info, Check, CheckCircle2 } from 'lucide-react';
import type { RequestRecord, RndFormData } from '../../types';
import { useApp } from '../../context/AppContext';
import { isEvaluationField, rndEvaluationComplete } from '../../utils/rndWorkflow';
import { ActionButton } from '../create/RequestEditorControls';
import { RndFields } from './RndFields';
import { RndRequestDocument } from './RndRequestDocument';

export function RndEvaluationPanel({ request }: { request: RequestRecord }) {
  const { currentUser, saveRndEvaluation, directorOverrideAction } = useApp();
  const base = request.formData.rnd!;
  const [value, setValue] = useState<RndFormData>({
    fields: Object.fromEntries(Object.entries(base.fields).filter(([id]) => isEvaluationField(id))),
    choices: Object.fromEntries(Object.entries(base.choices).filter(([id]) => isEvaluationField(id))),
    marketRows: []
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const canEdit = request.status === 'Pending Approval' && request.approvalSteps.at(-1)?.assignedUserId === currentUser.id;
  const isFinalSigned = request.approvalSteps.at(-1)?.status === 'Approved';
  const isBaseComplete = rndEvaluationComplete(base);
  const isValueComplete = rndEvaluationComplete(value);

  return (
    <section id="rnd-evaluation-section" tabIndex={-1} className="workspace-panel space-y-4 p-4 scroll-mt-24">
      <div className="space-y-1">
        <h2 className="font-bold text-base text-workspace-ink">R&amp;D Evaluation &amp; Completion</h2>
        <p className="text-xs text-workspace-muted">
          {canEdit
            ? 'You are the assigned final approver (Head of Department / Approver). Complete Section H evaluation and finalize the route.'
            : 'Section H is maintained by the assigned final approver. Completed evaluations are locked.'}
        </p>
      </div>

      {canEdit && (
        <div className="rounded-lg border border-workspace-line bg-workspace/40 p-3 space-y-2 text-xs">
          <p className="font-semibold text-workspace-ink">Route Completion Requirements:</p>
          <ul className="space-y-1 text-slate-700 list-disc list-inside">
            <li>
              Approver Signature:{' '}
              {isFinalSigned ? (
                <span className="inline-flex items-center gap-1 font-semibold text-teal-700">
                  <Check aria-hidden="true" className="size-3.5" /> Signed
                </span>
              ) : (
                <span className="text-amber-800 font-semibold">Pending signature (Sign above)</span>
              )}
            </li>
            <li>
              Section H Decision:{' '}
              {value.choices.hDecision?.length ? (
                <span className="inline-flex items-center gap-1 font-semibold text-teal-700">
                  <Check aria-hidden="true" className="size-3.5" /> Selected ({value.choices.hDecision.join(', ')})
                </span>
              ) : (
                <span className="text-rose-700 font-semibold">Required (Choose in Section H)</span>
              )}
            </li>
            <li>
              Section H Next Action:{' '}
              {value.fields.inpHNextAction?.trim() ? (
                <span className="inline-flex items-center gap-1 font-semibold text-teal-700">
                  <Check aria-hidden="true" className="size-3.5" /> Entered
                </span>
              ) : (
                <span className="text-rose-700 font-semibold">Required (Enter in Section H)</span>
              )}
            </li>
            <li>
              Saved to Record:{' '}
              {isBaseComplete ? (
                <span className="inline-flex items-center gap-1 font-semibold text-teal-700">
                  <Check aria-hidden="true" className="size-3.5" /> Saved
                </span>
              ) : (
                <span className="text-amber-800 font-semibold">Save evaluation required</span>
              )}
            </li>
          </ul>
        </div>
      )}

      {request.status === 'Pending Approval' && !isBaseComplete && (
        <div className="notice-rnd-section-h" role="note">
          <Info aria-hidden="true" className="mt-px size-4 shrink-0 text-[#b45309]" />
          <p>{canEdit
            ? 'Complete the decision and next action below to finish this route.'
            : 'The assigned approver needs to complete Section H before this route can finish.'}</p>
        </div>
      )}

      {!!request.rndSignedStates?.some(state => state.version === request.documentVersion) && (
        <p className="text-xs text-workspace-muted">
          A signature confirms the document at signing time. Later evaluation updates are separate review records; use the signed copies below to see exactly what was signed.
        </p>
      )}

      <details open={canEdit} className="space-y-3">
        <summary className="cursor-pointer text-sm font-semibold text-workspace-ink">
          Section H · Internal evaluation
        </summary>
        <div className="mt-2">
          <RndFields value={value} onChange={setValue} evaluation disabled={!canEdit || saving} />
        </div>
      </details>

      {canEdit && (
        <div className="pt-1">
          <ActionButton
            variant="primary"
            size="sm"
            disabled={!isValueComplete}
            busy={saving}
            busyText="Saving evaluation…"
            onClick={async () => {
              setSaving(true);
              setMessage('');
              try {
                const result = await saveRndEvaluation(request.id, value);
                setMessage(result.success ? 'Evaluation saved successfully.' : result.error ?? 'Could not save evaluation.');
              } finally {
                setSaving(false);
              }
            }}
          >
            Save Section H evaluation
          </ActionButton>
          {!isValueComplete && (
            <p className="mt-1 text-xs text-rose-700">
              Select an Evaluation Decision and enter a Recommended Next Action to save.
            </p>
          )}
        </div>
      )}

      {message && <p role="status" className="text-xs font-semibold text-teal-800">{message}</p>}

      {canEdit && isFinalSigned && (
        <div className="space-y-3 border-t border-workspace-line pt-3">
          <h3 className="text-sm font-bold text-workspace-ink">Finalize R&amp;D Route</h3>
          <p className="text-xs text-workspace-muted">
            {isBaseComplete
              ? 'Your signature and Section H evaluation are saved. Enter a completion note to finalize the request.'
              : 'Save Section H evaluation above to enable route completion.'}
          </p>
          <label className="block text-xs font-semibold space-y-1">
            <span>Completion note / reason (required)</span>
            <textarea
              className="workspace-control block w-full p-2 text-sm font-normal"
              rows={3}
              maxLength={2000}
              placeholder="e.g. Approved and evaluation finalized."
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </label>
          <ActionButton
            variant="primary"
            size="sm"
            disabled={!reason.trim() || !isBaseComplete}
            busy={saving}
            busyText="Finalizing…"
            onClick={async () => {
              setSaving(true);
              try {
                const result = await directorOverrideAction(request.id, reason);
                setMessage(result.success ? 'Route completed successfully.' : result.error ?? 'Could not complete.');
              } finally {
                setSaving(false);
              }
            }}
          >
            Complete and finalize route
          </ActionButton>
        </div>
      )}

      {!!request.rndSignedStates?.length && (
        <details className="border-t border-workspace-line pt-3">
          <summary className="text-xs font-semibold cursor-pointer">Document copies captured at signing ({request.rndSignedStates.length})</summary>
          {request.rndSignedStates.map((state, i) => (
            <details key={i} className="mt-2 text-xs">
              <summary className="cursor-pointer">
                v{state.version} · {request.approvalHistory.find(event => event.actionByUserId === state.actorId)?.actionByName ?? state.actorId} · {new Date(state.at).toLocaleString()}
              </summary>
              <div className="mt-2 overflow-auto">
                <RndRequestDocument data={state.formData} />
              </div>
            </details>
          ))}
        </details>
      )}

      {!!request.rndEvaluationHistory?.length && (
        <details className="border-t border-workspace-line pt-3">
          <summary className="text-xs font-semibold cursor-pointer">Evaluation updates ({request.rndEvaluationHistory.length})</summary>
          <ul className="mt-2 space-y-2 text-xs">
            {request.rndEvaluationHistory.map((item, i) => (
              <li key={i} className="rounded border border-slate-200 p-2">
                <span className="font-semibold">{item.actorName}</span> · v{item.version} · {new Date(item.at).toLocaleString()}
                <p className="mt-1 text-slate-700">{item.evaluation.choices.hDecision?.join(', ')} · {item.evaluation.fields.inpHNextAction}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
