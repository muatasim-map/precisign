import React from 'react';
import { RequestRecord } from '../../types/index';
import { signingProgress } from '../journey/RouteProgress';
import { JourneyMilestone } from '../../utils/approvalJourney';
import { Check, RotateCcw, XCircle, ShieldCheck, ChevronRight } from 'lucide-react';

/** Pen with an outlined barrel and a solid nib (slit cut in the marker colour) so it reads at 14px. */
function SigningPen({ className }: { className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
    <path d="M15.6 2.8 21.2 8.4 13.6 16 8 10.4Z" />
    <path d="M8 10.4 13.6 16 3.8 18.6Z" fill="currentColor" strokeWidth="1.2" />
    <path d="M5.6 16.8 9.6 12.8" stroke="var(--pen-slit, #1d4ed8)" strokeWidth="1.4" />
    <path d="M3.4 21.2h8.2" />
  </svg>;
}

interface CompactApprovalChainProps {
  request: RequestRecord;
  currentUserId?: string;
  onOpenDetail?: (request: RequestRecord) => void;
  maxVisible?: number;
  compact?: boolean;
  showProgressText?: boolean;
}

export const CompactApprovalChain: React.FC<CompactApprovalChainProps> = ({
  request,
  currentUserId,
  onOpenDetail,
  maxVisible = 3,
  compact = false,
  showProgressText = true,
}) => {
  const journey = signingProgress(request, currentUserId);
  const { milestones, headline } = journey;

  const visibleMilestones = milestones.slice(0, maxVisible);
  const currentMilestone = milestones.find(milestone => milestone.status === 'current');
  if (currentMilestone && visibleMilestones.length > 0 && !visibleMilestones.includes(currentMilestone)) {
    visibleMilestones[visibleMilestones.length - 1] = currentMilestone;
  }
  const overflowCount = milestones.length - visibleMilestones.length;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onOpenDetail) {
      onOpenDetail(request);
    }
  };

  const getMilestoneIcon = (milestone: JourneyMilestone) => {
    switch (milestone.status) {
      case 'completed':
      case 'submitted':
        return <Check className={compact ? 'size-3.5 stroke-[2.75]' : 'size-3.5 stroke-2'} />;
      case 'returned':
        return <RotateCcw className="size-3.5 stroke-2" />;
      case 'rejected':
        return <XCircle className="size-3.5 stroke-2" />;
      case 'bypassed':
        return <ShieldCheck className="size-3.5 stroke-2" />;
      case 'current':
        return <SigningPen className={compact ? 'size-3.5' : 'size-4'} />;
      default:
        return <span className="text-[9px] font-semibold">{milestone.participantInitials}</span>;
    }
  };

  const getMilestoneStyle = (milestone: JourneyMilestone) => {
    switch (milestone.status) {
      case 'completed':
      case 'submitted':
        return compact ? 'border-emerald-700 bg-emerald-700 text-white shadow-sm' :'bg-workspace-tint text-workspace-teal border-teal-200';
      case 'returned':
        return 'bg-amber-50 text-amber-800 border-amber-200';
      case 'rejected':
        return 'bg-rose-50 text-rose-800 border-rose-200';
      case 'bypassed':
        return 'bg-slate-100 text-slate-700 border-slate-300';
      case 'current':
        if (compact) return 'border-blue-700 bg-blue-700 text-white ring-2 ring-blue-300 ring-offset-1 ring-offset-white';
        return milestone.isAssignedToCurrentUser
          ? 'bg-workspace-teal text-white border-workspace-teal ring-2 ring-teal-200 ring-offset-1'
          : 'bg-workspace-steel text-white border-workspace-steel';
      case 'waiting':
      default:
        return compact ? 'border-dashed border-slate-400 bg-white text-slate-600' : 'bg-white text-slate-600 border-slate-300';
    }
  };

  const signed = request.approvalSteps.filter(step => step.status === 'Approved').length;
  const bypassed = request.approvalSteps.filter(step => step.status === 'Bypassed').length;
  const label = (m: JourneyMilestone) => m.status === 'submitted' ? 'Submitted' : m.status === 'completed' ? 'Signed' : m.status === 'bypassed' ? 'Bypassed' : m.status === 'current' ? (compact ? 'Awaiting' : 'Awaiting sign') : m.status === 'returned' ? 'Correction' : m.status === 'rejected' ? 'Rejected' : m.statusLabel === 'Closed' ? 'Closed' : 'Waiting';
  return <button type="button" onClick={handleClick}
    aria-label={`Approval Journey for ${request.id}: ${milestones.map(m => `${m.participantName}: ${m.statusLabel}`).join('; ')}. Open full journey.`}
    className={`workspace-control group w-full max-w-96 text-left ${compact ? "min-w-52 border-transparent bg-transparent px-0.5 py-1" : "min-w-60 p-2.5"}`}>
    <span className="flex items-start">
      {visibleMilestones.map((m, i) => {
        const next = visibleMilestones[i + 1];
        const hasGap = next && milestones.indexOf(next) - milestones.indexOf(m) > 1;
        const signedLink = !hasGap && (m.status === 'submitted' || m.status === 'completed');
        return <span key={m.id} aria-current={m.status === 'current' ? 'step' : undefined} title={`${m.participantName} · ${m.participantRole} · ${m.statusLabel}`} className="relative flex min-w-0 flex-1 flex-col items-center px-1 text-center">
          {next && <span aria-hidden="true" className={`absolute ${compact ? "left-[calc(50%+17px)] top-[11px] w-[calc(100%-34px)] border-t-2" : "left-[calc(50%+17px)] top-3.5 w-[calc(100%-34px)] border-t"} ${compact && signedLink ? "border-emerald-500" : "border-slate-300"} ${hasGap || (compact && !signedLink) ? 'border-dashed' : ''}`} />}
          <span aria-hidden="true" className={`flex items-center justify-center rounded-full border ${compact ? "size-6" : "size-7"} ${getMilestoneStyle(m)}`}>{getMilestoneIcon(m)}</span>
          <span className={`max-w-full font-semibold leading-tight text-workspace-ink [overflow-wrap:anywhere] ${compact ? "mt-1.5 text-[11px]" : "mt-1.5 text-xs"}`}>{m.participantName}</span>
          <span className={`mt-0.5 text-[11px] leading-tight ${m.status === 'current' ? 'font-semibold text-blue-700' : compact && (m.status === 'completed' || m.status === 'submitted') ? 'font-medium text-emerald-700' : compact && m.status === 'waiting' ? 'text-slate-500' : 'text-slate-600'}`}>{label(m)}</span>
        </span>;
      })}
    </span>
    {compact && overflowCount > 0 && <span className="mt-1 block text-center text-[11px] font-semibold text-workspace-steel">+{overflowCount} more · View journey</span>}
    {!compact && showProgressText && (
      <span className="mt-2 block border-t border-workspace-line pt-1.5 text-[11px] text-workspace-muted">
        {request.status === 'Pending Approval' && (
          <span className="mb-1 block font-semibold text-workspace-ink">{headline}</span>
        )}
        <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span>{signed}/{request.approvalSteps.length} approvals signed{bypassed ? ` · ${bypassed} bypassed` : ''}</span>
          <span className="inline-flex items-center gap-1 font-semibold text-workspace-steel">{overflowCount ? `+${overflowCount} more · ` : ''}View journey <ChevronRight aria-hidden="true" className="size-3" /></span>
        </span>
      </span>
    )}
  </button>;
};
