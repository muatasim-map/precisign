import { useEffect, useRef } from 'react';
import { Check, Clock, Circle, CornerUpLeft, Eye, Send, SkipForward, X } from 'lucide-react';
import type { RequestRecord } from '../../types';
import { assignedProcessorIds, processorTaskLabels } from '../../../../shared/utils/processorHandoff';
import { ProcessorReviewDetails } from './ProcessorReviewDetails';
import { signingProgress } from '../journey/RouteProgress';

export function DocuSignProgressBanner({ request, currentUserId }: {
  request: RequestRecord;
  currentUserId: string;
}) {
  const processors = request.status === 'Approved' ? assignedProcessorIds(request) : [];
  const receipts = request.processorReads?.filter(read => read.version === request.documentVersion && processors.includes(read.userId)) ?? [];
  // Recipients named by task, e.g. "Accounts". Display only: the handoff itself starts on the server when signing completes.
  const taskLabels = processorTaskLabels(request.formType);
  const recipients = [...new Set((request.processorHandoff ?? []).map(task => taskLabels[task.taskId]).filter(Boolean))].join(' & ') || 'processors';
  const upcomingHandoff = request.status === 'Pending Approval' && !!request.processorHandoff?.some(task => task.userIds.length);
  const handoffTitle = !receipts.length ? 'Sent to ' + recipients
    : processors.length === 1 ? 'Opened by ' + receipts[0].name
    : 'Opened by ' + receipts.length + ' of ' + processors.length;
  const handoffMeta = !receipts.length ? 'Not opened yet' : processors.length === 1 ? [recipients, receipts[0].department].filter(Boolean).join(' · ') : recipients;
  const { headline, detail, progress, milestones } = signingProgress(request, currentUserId);
  // Live updates: remember which steps were already signed so a step signed while the page is open
  // can pop into its check and fill its connector once. First render animates nothing.
  const seen = useRef<Map<string, boolean> | null>(null);
  const signedNow = new Map(milestones.map(step => [step.id, step.status === 'completed' || step.status === 'submitted']));
  const justSigned = (id: string) => seen.current !== null && seen.current.get(id) === false && signedNow.get(id) === true;
  useEffect(() => { seen.current = signedNow; });
  return <section className="workspace-panel p-4" aria-label="Signing progress">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-sm font-bold [overflow-wrap:anywhere]">{headline}</h2>
        <p className="mt-0.5 text-xs text-workspace-muted">{progress}{detail && ` · ${detail}`}</p>
      </div>
    </div>
    <div className="mt-4 overflow-x-auto pb-1">
    <ol aria-label="Signing steps" className="grid gap-4 sm:grid-flow-col sm:auto-cols-[minmax(9rem,1fr)] sm:gap-6">
      {milestones.map((step, index) => {
        const record = step.type === 'requester' ? undefined : request.approvalSteps[step.stageIndex - 1];
        const earlyFinal = request.status === 'Pending Approval' && step.isFinalApproval && record?.status !== 'Approved' && record?.status !== 'Bypassed';
        const signed = step.status === 'completed' || step.status === 'submitted';
        const missingImage = signed && !(step.type === 'requester' ? request.formData.requesterSignatureDataUrl : record?.signatureDataUrl);
        const ready = earlyFinal || step.status === 'current';
        const Icon = signed ? Check : step.status === 'bypassed' ? SkipForward : step.status === 'returned' ? CornerUpLeft : step.status === 'rejected' ? X : ready ? Clock : Circle;
        const label = signed ? (missingImage ? 'Approval recorded' : 'Signed') : step.status === 'bypassed' ? 'Bypassed' : step.status === 'returned' ? 'Corrections requested' : step.status === 'rejected' ? 'Rejected' : earlyFinal ? 'Ready to sign' : ready ? 'Awaiting signature' : 'Upcoming';
        return <li key={step.id} className="relative flex min-w-0 items-start gap-3 pb-2 sm:block sm:pb-0">
          {(index < milestones.length - 1 || processors.length > 0 || upcomingHandoff) && <span aria-hidden="true" className={`absolute left-[13px] top-8 h-[calc(100%+0.25rem)] w-px sm:left-8 sm:top-3.5 sm:h-px sm:w-[calc(100%-0.5rem)] ${justSigned(step.id) ? 'step-connector-fill ' : ''}${signed && !(upcomingHandoff && index === milestones.length - 1) ? 'bg-emerald-300' : 'bg-slate-200'}`} />}
          <span className={`relative inline-flex size-7 shrink-0 items-center justify-center rounded-full sm:mb-2 ${justSigned(step.id) ? 'step-just-signed ' : ''}${ready && !signed ? 'step-current-pulse ' : ''}${signed ? 'bg-emerald-600 text-white' : ready ? 'bg-sky-100 text-sky-800 ring-4 ring-sky-50' : 'bg-slate-100 text-slate-600'}`}><Icon aria-hidden="true" className="size-4" /></span>
          <div className="min-w-0 text-xs"><strong className="block break-words text-sm">{step.participantName}</strong>
            <span className="mt-0.5 block text-workspace-muted">{step.type === 'requester' ? 'Requester' : step.isFinalApproval ? 'Final approver' : step.stageName}</span>
            <span className={`mt-1 inline-block text-[11px] font-semibold ${ready ? 'text-sky-800' : signed ? 'text-emerald-800' : 'text-workspace-muted'}`}>{label}</span>
            {signed && step.signatureDate && <time className="mt-1 block text-[11px] text-workspace-muted" dateTime={step.signatureDate}>{new Date(step.signatureDate).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>}
            {missingImage && <span className="mt-1 block text-[11px] text-workspace-muted">Signature image unavailable</span>}
          </div>
        </li>;
      })}
      {processors.length > 0 && <li className="flex min-w-0 items-start gap-3 sm:block">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700 sm:mb-2">
          {receipts.length ? <Eye className="size-4" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
        </span>
        <div className="min-w-0 text-xs">
          <strong className="block break-words text-sm">{handoffTitle}</strong>
          <span className="mt-0.5 block text-workspace-muted">After approval</span>
          <span className="mt-1 inline-block text-[11px] font-semibold text-workspace-muted">{handoffMeta}</span>
          <ProcessorReviewDetails request={request} />
        </div>
      </li>}
      {upcomingHandoff && <li className="flex min-w-0 items-start gap-3 sm:block">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-dashed border-slate-300 bg-white text-slate-500 sm:mb-2"><Send className="size-4" aria-hidden="true" /></span>
        <div className="min-w-0 text-xs">
          <strong className="block break-words text-sm text-workspace-muted">Sends to {recipients}</strong>
          <span className="mt-0.5 block text-workspace-muted">After approval</span>
          <span className="mt-1 inline-block text-[11px] font-semibold text-workspace-muted">Once signing is complete</span>
        </div>
      </li>}
    </ol>
    </div>
  </section>;
}
