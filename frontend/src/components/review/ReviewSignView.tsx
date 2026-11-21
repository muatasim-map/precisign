import { assignedProcessorIds, processorTaskLabels } from '../../../../shared/utils/processorHandoff';
import { toast } from '../common/Toaster';
import { useSlidingPill } from '../common/useSlidingPill';
import { ReviewSupportingFiles } from './ReviewSupportingFiles';
import { formatRequestId } from '../../utils/requestId';
import { INITIAL_COMPANIES } from '../../data/companies';
import { RndEvaluationPanel } from '../rnd/RndEvaluationPanel';
import React, { useState, useRef, useEffect } from 'react';
import { ApiError } from '../../services/apiTypes';
import { captureFrontendError } from '../../services/sentry';
import { canAdministerWorkflows } from '../../utils/workflowAdministration';
import { canCompleteWithOutstandingSteps, canProposeFinalReplacement, configuredReplacementIds, usesConfiguredBackups } from '../../../../shared/utils/routeReplacement';
import { canBeAssignedApproval, canUserAccessCompany } from '../../utils/companyAccess';
import { needsProcessingAction } from '../../utils/routeProcessing';
import { useApp, useUnsavedWork } from '../../context/AppContext';
import { AdminWorkFormData, AttachmentItem } from '../../types/index';
import { getRequestDocumentVersion, RequestDocument } from '../document/RequestDocument';
import { RouteProcessingPanel } from './RouteProcessingPanel';
import { attachmentsForVersion } from '../../utils/historicalEvidence';
import { FinanceHoldPanel } from './FinanceHoldPanel';
import { SignatureModal } from '../modals/SignatureModal';
import { hasProcessorHandoff, hasReadHandoff } from '../../../../shared/utils/processorHandoff';
import { DocuSignProgressBanner } from './DocuSignProgressBanner';
import { canOfferEarlyCompletion, outstandingSigners } from '../journey/RouteProgress';
import { ApprovalJourneyPanel } from '../journey/ApprovalJourneyPanel';
import { ReturnRequestDialog } from './ReturnRequestDialog';
import { CloseRequestDialog } from './CloseRequestDialog';
import { CompleteRouteDialog } from './CompleteRouteDialog';
import { CorrectionDialog } from './CorrectionDialog';
import {
  FileText,
  Clock,
  Printer,
  Maximize2,
  Minimize2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  ChevronLeft,
  ZoomIn,
  ZoomOut,
  Send,
  Eye,
  ShieldAlert,
  RotateCcw,
  History,
  Check,
  AlertCircle,
  ShieldCheck,
  Building2,
  Download,
  UserCheck,
  X,
} from 'lucide-react';

export const ReviewSignView: React.FC = () => {
  const {
    selectedRequestId,
    readOnly: connectedMode,
    recordProcessorRead,
    companyRequests,
    currentUser,
    approveRequest,
    returnRequest,
    rejectRequestAction,
    directorOverrideAction,
    cancelRoute,
    replaceSigner,
    acceptReplacement,
    readLatestRoute,
    downloadDocumentPdf,
    downloadAttachment,
    users,
    resubmitRequest,
    setActiveView,
    signatureReturn,
    setSignatureReturn,
    openSignatureProfile,
    selectedCompany,
  } = useApp();

  // Find active request
  const request = companyRequests.find((r) => r.id === selectedRequestId);

  const [selectedVersion, setSelectedVersion] = useState<number>(request ? request.documentVersion : 1);
  const [receiptError, setReceiptError] = useState('');
  const [copied, setCopied] = useState(false);
  const reviewToggle = useSlidingPill();
  const [actionsSheet, setActionsSheet] = useState<'closed' | 'open' | 'closing'>('closed');
  const sheetDrag = useRef<{ y: number; at: number } | null>(null);
  useEffect(() => {
    if (actionsSheet !== 'open') return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('dialog[open]')) closeActionsSheet(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  // Status label cross-morphs only when the status changes while the page is open (not on first paint).
  const shownStatus = useRef(request?.status);
  const statusChanged = shownStatus.current !== undefined && shownStatus.current !== request?.status;
  useEffect(() => { shownStatus.current = request?.status; }, [request?.status]);
  const [receiptAttempt, retryReceipt] = useState(0);
  const receiptId = connectedMode && request && selectedVersion === request.documentVersion && hasProcessorHandoff(request, currentUser.id)
    && !hasReadHandoff(request, currentUser.id) ? request.id : undefined;
  useEffect(() => {
    if (!receiptId) return;
    let cancelled = false;
    let sent = false;
    const recordWhenVisible = () => {
      if (sent || document.visibilityState !== 'visible') return;
      sent = true;
      void recordProcessorRead(receiptId, selectedVersion).catch(error => {
        if (!cancelled) setReceiptError(error instanceof Error ? error.message : 'Could not record that you opened this request.');
      });
    };
    recordWhenVisible();
    document.addEventListener('visibilitychange', recordWhenVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', recordWhenVisible);
    };
  }, [receiptId, receiptAttempt, selectedVersion, recordProcessorRead]);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [signatureAction, setSignatureAction] = useState<'approve' | 'resubmit' | 'override'>('approve');
  const [actionModal, setActionModal] = useState<'return' | 'reject' | 'cancel' | 'override' | 'resubmit' | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [returningFromProfile] = useState(() => signatureReturn?.requestId === selectedRequestId && signatureReturn.userId === currentUser.id ? signatureReturn : null);
  const [signingRemark, setSigningRemark] = useState(returningFromProfile?.remark || '');
  useEffect(() => {
    if (!returningFromProfile || !request) return;
    if (returningFromProfile.updatedAt !== request.updatedAt) {
      setActionError('The request changed while you were setting up your signature. Review the latest document and signing status.');
    }
  }, [returningFromProfile, request?.updatedAt]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [replacementStage, setReplacementStage] = useState('');
  const [replacementUser, setReplacementUser] = useState('');
  const [replacementReason, setReplacementReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const savingReason = useRef(false);
  const signingRecordTime = useRef<string | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const replacementRef = useRef<HTMLDivElement>(null);
  const completionRecordTime = useRef<string | null>(null);
  const [mobileViewTab, setMobileViewTab] = useState<'document' | 'sidebar'>(() => {
    const canCorrect = request?.status === 'Returned for Correction' && request.requesterId === currentUser.id;
    const canRespond = request?.status === 'Pending Approval' && request.pendingReplacement?.newUserId === currentUser.id;
    return request && (canCorrect || canRespond || needsProcessingAction(request, currentUser)) ? 'sidebar' : 'document';
  });

  // Full correction form state if resubmitting
  const [correctedForm, setCorrectedForm] = useState<AdminWorkFormData>(request ? request.formData : ({} as any));
  const [correctedAttachments, setCorrectedAttachments] = useState<AttachmentItem[]>(request?.attachments || []);
  const [resubmitChangeNote, setResubmitChangeNote] = useState('');

  useUnsavedWork(JSON.stringify({ signingRemark, actionReason: actionModal ? actionReason : '', replacementReason, resubmitChangeNote, correctedForm, files: correctedAttachments.map(file => file.id) }));

  if (!request) {
    return (
      <div className="p-12 text-center space-y-4">
        <div className="text-slate-500 text-sm">The selected request is unavailable in the current company view.</div>
        <button
          onClick={() => setActiveView('dashboard')}
          className="px-4 py-2 bg-[#365C78] text-white rounded-md text-xs font-semibold"
        >
          Back to requests
        </button>
      </div>
    );
  }

  const financialRequest = (request.formType === 'Cash Voucher' && !!request.formData.cashVoucher)
    || (request.formType === 'Expense Claim' && !!request.formData.expenseClaim);
  if (request.formType !== 'Admin Work Request' && request.formType !== 'Administrative & Payment Request' && !(request.formType === 'IT Request' && request.formData.itRequest) && !financialRequest && !(request.formType === 'R&D Initiative' && request.formData.rnd)) {
    return (
      <div className="p-12 text-center space-y-4">
        <div className="text-slate-500 text-sm">The {request.formType} document is not available for review yet.</div>
        <button onClick={() => setActiveView('dashboard')} className="px-4 py-2 bg-[#365C78] text-white rounded-md text-xs font-semibold">
          Back to requests
        </button>
      </div>
    );
  }

  const selectedDocument = getRequestDocumentVersion(request, selectedVersion);
  const activeFormData = selectedDocument?.data ?? request.formData;
  const visibleAttachments = selectedDocument?.attachments;
  const submission = request.approvalHistory.find(event => event.action === 'Submitted' && event.version === selectedVersion);
  const submissionNote = submission?.comments?.replace(/^Resubmitted: /, '').trim();
  const showSubmissionNote = submissionNote && !/^(Request submitted\.|Official request submitted\.|Request submitted with \d+ attachment\(s\)\.|Resubmitted Version \d+)$/.test(submissionNote);

  const currentStep = request.approvalSteps[request.currentStageIndex];
  const isAssignedApprover =
    request.status === 'Pending Approval' && currentStep?.assignedUserId === currentUser.id;
  const isRequester = request.requesterId === currentUser.id;
  const isFinalApprover = request.approvalSteps.at(-1)?.assignedUserId === currentUser.id;
  const finalAlreadySigned = request.approvalSteps.at(-1)?.status === 'Approved';
  const isReturned = request.status === 'Returned for Correction';
  const canSign = request.status === 'Pending Approval' && !isRequester && !(isFinalApprover && finalAlreadySigned) && (isAssignedApprover || (isFinalApprover && !finalAlreadySigned));
  const configuredBackups = usesConfiguredBackups(request) && request.workflowConfig.signerSelection !== 'company-directory';
  const replacementCandidates = replacementStage ? users.filter(user =>
    user.id !== request.requesterId && canBeAssignedApproval(user, request.companyId) &&
    !request.approvalSteps.some(step => step.assignedUserId === user.id) &&
    (!configuredBackups || configuredReplacementIds(request, replacementStage).includes(user.id))
  ) : [];
  const replaceableSteps = request.approvalSteps.filter((step, index) =>
    !['Approved', 'Bypassed', 'Rejected'].includes(step.status) &&
    (index === request.approvalSteps.length - 1 ? canProposeFinalReplacement(request, currentUser) : canAdministerWorkflows(currentUser))
  );
  const onLatestVersion = selectedVersion === request.documentVersion;
  const outstanding = outstandingSigners(request);
  const canOverride = canOfferEarlyCompletion(request, currentUser.id);
  const canManageAfterSigning = finalAlreadySigned && !isRequester && request.status === 'Pending Approval'
    && canCompleteWithOutstandingSteps(request, currentUser.id);
  const canRespond = request.status === 'Pending Approval' && request.pendingReplacement?.newUserId === currentUser.id;
  const canCorrect = isReturned && isRequester;
  const completionLabel = finalAlreadySigned ? 'Complete request' : 'Sign & complete';
  const companyName = INITIAL_COMPANIES.find(company => company.id === request.companyId)?.name ?? request.companyId;
  const correctionReason = [...request.approvalHistory].reverse().find(event => event.action === 'Returned for Correction')?.comments;
  const versionOptions = [...new Set([1, ...request.versionSnapshots.map(snapshot => snapshot.version), request.documentVersion])].sort((a, b) => b - a);

  function goToActions() {
    setMobileViewTab('sidebar');
    // Phones: lift the same actions column into a bottom sheet instead of scrolling the page.
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 1023px)').matches) setActionsSheet('open');
    requestAnimationFrame(() => (canRespond && onLatestVersion ? replacementRef : actionsRef).current?.focus({ preventScroll: true }));
  }
  function closeActionsSheet() {
    if (actionsSheet !== 'open') return;
    setActionsSheet('closing');
    window.setTimeout(() => setActionsSheet('closed'), 260);
  }

  function openAction(mode: NonNullable<typeof actionModal>) {
    setActionError(null);
    setActionReason('');
    if (mode === 'override') completionRecordTime.current = request?.updatedAt ?? null;
    setActionModal(mode);
  }

  const handleCopyId = () => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
    navigator.clipboard?.writeText(request.id);
    toast('Full request ID copied.', 'info');
  };

  const handleDownloadPdf = async () => {
    if (!downloadDocumentPdf || downloadingPdf) return;
    setDownloadingPdf(true);
    setActionError(null);
    try {
      const pdf = await downloadDocumentPdf(request.id, selectedVersion, request.updatedAt);
      const url = URL.createObjectURL(pdf);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${request.id}-v${selectedVersion}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Could not download PDF.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleDownloadRouteSummary = async () => {
    setActionError(null);
    let latest;
    try {
      latest = await readLatestRoute(request.id);
    } catch {
      setActionError('Could not verify access to the route summary.');
      return;
    }
    if (!latest || latest.status !== 'Approved') {
      setActionError('Completed route unavailable.');
      return;
    }
    const lines = [
      'PreciRoute Summary', latest.id, `Company: ${latest.companyId}`, `Document version: ${latest.documentVersion}`,
      'Status: Completed', '',
      ...latest.approvalSteps.map(step => `${step.stageName}: ${step.assignedUserName} — ${step.status} — ${step.actionDate || ''}`),
      '', 'History',
      ...latest.approvalHistory.map(event => `${event.dateTime} | v${event.version} | ${event.actionByName} | ${event.action} | ${event.comments || ''}`),
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${latest.id}-route-summary.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** Resolves true only when the browser was handed the file, so callers can confirm honestly. */
  const handleDownloadAttachment = async (file: AttachmentItem, version = selectedVersion): Promise<boolean> => {
    let href: string | undefined;
    let objectUrl: string | undefined;
    try {
      if (file.downloadUrl && downloadAttachment) {
        const blob = await downloadAttachment(request.id, version, file.id);
        href = objectUrl = URL.createObjectURL(blob);
      } else {
        const latest = await readLatestRoute(request.id);
        if (!latest) throw new Error('Route unavailable.');
        const current = attachmentsForVersion(latest, version)?.find(item => item.id === file.id)
          ?? latest.financeHoldHistory?.find(entry => entry.documentVersion === version && entry.attachment?.id === file.id)?.attachment;
        if (!current) throw new Error('Attachment unavailable.');
        href = current.dataUrl;
      }
      if (!href) {
        setActionSuccess(`Reference attachment: ${file.name} (${file.sizeFormatted})`);
        return false;
      }
      const link = document.createElement('a');
      link.href = href;
      link.download = file.name;
      link.click();
      return true;
    } catch (error) {
      captureFrontendError(error, { flow: 'attachment-download' });
      if (error instanceof ApiError) {
        if (error.status >= 500) {
          setActionError(error.message || 'Attachment storage is temporarily unavailable. Try again shortly.');
        } else if (error.status === 404) {
          setActionError('This attachment is unavailable.');
        } else {
          setActionError(error.message || 'Could not download attachment.');
        }
      } else if (error instanceof Error) {
        if (error.message.includes('unavailable')) {
          setActionError('This attachment is unavailable.');
        } else {
          setActionError(error.message || 'Could not download this attachment. Check your connection and try again.');
        }
      } else {
        setActionError('Could not download this attachment. Check your connection and try again.');
      }
      return false;
    } finally {
      const downloadUrl = objectUrl;
      if (downloadUrl) setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    }
  };

  const handleSignatureConfirmation = (signature: string, note?: string) => {
    if (signingRecordTime.current !== request.updatedAt) {
      return Promise.resolve({ success: false, error: 'The route changed. Close this dialog and review the current document before signing again.' });
    }
    if (signatureAction === 'resubmit') return handleResubmitSubmit(signature);
    if (signatureAction === 'override') return handleFinalRouteCompletionSubmit(signature);
    return handleConfirmedApproval(signature, note);
  };

  const handleApproveClick = () => {
    setActionError(null);
    if (!canSign || !onLatestVersion) {
      setActionError(`Unauthorized: Stage is assigned to ${currentStep?.assignedUserName}.`);
      return;
    }
    setSignatureAction('approve');
    signingRecordTime.current = request.updatedAt; setSignatureModalOpen(true);
  };

  const handleConfirmedApproval = async (signatureDataUrl: string, note?: string) => {
    const result = await approveRequest(request.id, note, signatureDataUrl);
    if (result.success) {
      setSignatureReturn(value => value?.requestId === request.id ? null : value);
      setSigningRemark('');
      setActionSuccess(isFinalApprover && outstanding.length ? 'You signed. The request stays open for the other signers.' : 'Signature saved.');
      setTimeout(() => setActionSuccess(null), 3500);
    } else {
      setActionError(result.error || 'Couldn’t record your signature. Refresh the request and try again.');
    }
    return result;
  };

  const handleReturnSubmit = async () => {
    if (savingReason.current) return;
    if (!actionReason.trim()) {
      setActionError('Reason is required to return document for correction.');
      return;
    }
    savingReason.current = true; setSaving(true); setActionError(null);
    const result = await returnRequest(request.id, actionReason.trim());
    savingReason.current = false; setSaving(false);
    if (result.success) {
      setActionModal(null);
      setActionReason('');
      setActionSuccess('Request returned to requester for correction.');
      setTimeout(() => setActionSuccess(null), 3500);
    } else {
      setActionError(result.error || 'Couldn’t return the request. Refresh the request and try again.');
    }
  };

  const handleRejectSubmit = async () => {
    if (savingReason.current) return;
    if (!actionReason.trim()) {
      setActionError('Reason is required to reject request.');
      return;
    }
    savingReason.current = true; setSaving(true); setActionError(null);
    const result = await (actionModal === 'cancel' ? cancelRoute : rejectRequestAction)(request.id, actionReason.trim());
    savingReason.current = false; setSaving(false);
    if (result.success) {
      setActionModal(null);
      setActionReason('');
      setActionSuccess(actionModal === 'cancel' ? 'PreciRoute cancelled.' : 'Request formally rejected and archived.');
      setTimeout(() => setActionSuccess(null), 3500);
    } else {
      setActionError(result.error || 'Couldn’t reject the request. Refresh the request and try again.');
    }
  };

  const handleFinalRouteCompletionSubmit = async (signatureDataUrl: string) => {
    if (savingReason.current) return { success: false, error: "Save already in progress." };
    if (!actionReason.trim()) {
      setActionError('A reason is required to bypass outstanding signers.');
      return;
    }
    savingReason.current = true; setSaving(true);
    const result = await directorOverrideAction(request.id, actionReason.trim(), signatureDataUrl);
    savingReason.current = false; setSaving(false);
    if (result.success) {
      setActionModal(null);
      setActionReason('');
      setActionSuccess('PreciRoute completed by the final approver.');
      setTimeout(() => setActionSuccess(null), 3500);
    } else {
      setActionError(result.error || 'Route completion failed');
    }
    return result;
  };

  const handleResubmitSubmit = async (signatureDataUrl: string) => {
    const result = await resubmitRequest(
      request.id,
      correctedForm,
      resubmitChangeNote.trim(),
      signatureDataUrl,
      correctedAttachments
    );
    if (result.success) {
      setActionModal(null);
      setActionSuccess('Corrected document resubmitted. Workflow restarted at Stage 1.');
      setSelectedVersion(request.documentVersion + 1);
      setTimeout(() => setActionSuccess(null), 3500);
    } else {
      setActionError(result.error || 'Resubmission failed');
    }
    return result;
  };

  return (
    <div className="request-review fade-in min-w-0 bg-[#edf3f8] p-3 sm:p-5 lg:p-6 max-w-[1680px] mx-auto space-y-4">
      <header className="no-print relative isolate overflow-hidden rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm sm:px-6 sm:py-5">
        <svg data-review-decoration aria-hidden="true" focusable="false" viewBox="0 0 420 200" className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden h-full w-[36%] text-[#365c78]/20 [mask-image:linear-gradient(to_right,transparent,black_55%)] lg:block" fill="none" stroke="currentColor" strokeWidth="1.2" preserveAspectRatio="xMaxYMid meet">
          <path d="M114 29h74l22 22v118h-96z M188 29v22h22 M132 72h57m-57 17h44m-44 17h50 M134 137h46 M210 105h42l26-41h47m-73 41 28 41h84 M325 64h45" />
          <path d="M92 50v133h100 M325 64v40h45" strokeDasharray="4 5" />
          <circle cx="252" cy="105" r="5" fill="white" /><circle cx="325" cy="64" r="7" fill="white" />
          <circle cx="370" cy="64" r="5" fill="white" /><circle cx="370" cy="104" r="5" fill="white" />
          <circle cx="364" cy="146" r="7" fill="white" />
        </svg>
        <div className="min-w-0 space-y-2.5 lg:max-w-[66%]">
          <button
            onClick={() => setActiveView('dashboard')}
            className="workspace-control inline-flex min-h-9 items-center gap-1 px-2.5 text-xs font-semibold"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </button>

          <h1 style={{ viewTransitionName: 'request-title' }} className="text-xl font-bold leading-tight tracking-tight text-[#192B3C] [overflow-wrap:anywhere] sm:text-3xl">{request.title || request.formType}</h1>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-700">
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className="font-mono font-semibold [overflow-wrap:anywhere]" title={request.id}>{formatRequestId(request.id, request.displayId)}</span>
              <button
                type="button"
                onClick={handleCopyId}
                className="workspace-control preci-press grid size-8 shrink-0 place-items-center"
                title="Copy full request ID"
                aria-label={'Copy full request ID ' + request.id}
              >
                <span className="icon-morph" aria-hidden="true">
                  <Copy data-active={!copied} className="w-3 h-3" />
                  <Check data-active={copied} className="w-3.5 h-3.5 text-teal-700" />
                </span>
              </button>
            </span>
            <span>{companyName}</span>
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${request.status === 'Approved'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : request.status === 'Returned for Correction'
                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                  : request.status === 'Rejected'
                    ? 'bg-rose-50 text-rose-800 border-rose-200'
                    : 'bg-sky-50 text-sky-800 border-sky-200'
                }`}
            >
              <span key={request.status} className={statusChanged ? 'status-morph inline-block' : undefined}>{request.status === 'Approved' ? 'Signing completed' : request.status}</span>
            </span>
          </div>
          <p className="text-xs text-slate-600 [overflow-wrap:anywhere]">
            <span>{request.formType}{request.formType === 'Admin Work Request' && ' (PR#21-001FA)'}</span>
            <span className="mx-1.5">·</span>
            <span>Submitted by {request.requesterName} ({request.department})</span>
          </p>
          {isReturned && <p className="border-l-2 border-amber-400 pl-2.5 text-sm text-amber-950 [overflow-wrap:anywhere]"><strong>With {request.requesterName} for correction.</strong> {correctionReason || 'The signer requested changes.'}</p>}
          {request.status === 'Pending Approval' && currentStep?.assignedUserName && <p className="text-sm text-slate-700"><strong className="text-[#192B3C]">Next to sign</strong> · {currentStep.assignedUserId === currentUser.id ? 'You' : currentStep.assignedUserName} · {currentStep.stageName}</p>}
          {request.status === 'Approved' && (() => {
            // What happens next, in plain words. "Opened" is a viewing receipt only; payment and fulfilment are tracked separately below.
            const people = assignedProcessorIds(request);
            if (!people.length) return <p className="text-sm text-slate-700"><strong className="text-[#192B3C]">Signing is complete.</strong></p>;
            const opened = (request.processorReads ?? []).filter(read => read.version === request.documentVersion && people.includes(read.userId)).length;
            const labels = processorTaskLabels(request.formType);
            const where = [...new Set((request.processorHandoff ?? []).map(task => labels[task.taskId]).filter(Boolean))].join(' & ') || 'the assigned people';
            return <p className="text-sm text-slate-700"><strong className="text-[#192B3C]">Signing is complete.</strong> Sent to {where} · {opened ? `opened by ${opened} of ${people.length}` : 'not opened yet'}. Payment and fulfilment are tracked separately.</p>;
          })()}
          {request.status === 'Pending Approval' && request.pendingReplacement && <p className="text-sm text-slate-700"><strong className="text-[#192B3C]">Final signer replacement pending.</strong> {canRespond ? 'Your response is needed.' : 'The current signer stays assigned until acceptance.'}</p>}
        </div>
      </header>

      {/* Mobile Tab Switcher */}
      <div ref={reviewToggle.group} role="group" aria-label="Review view" className="seg-group no-print sticky top-16 z-20 flex rounded-lg border border-slate-200 bg-white p-1 text-xs shadow-sm lg:hidden">
        <span aria-hidden="true" ref={reviewToggle.pill} className="seg-pill seg-pill-steel" />
        <button
          onClick={() => { setMobileViewTab('document'); closeActionsSheet(); document.getElementById('review-document')?.focus(); }}
          aria-pressed={mobileViewTab === 'document'}
          className={`min-h-10 flex-1 sm:flex-none px-3 py-1.5 font-semibold rounded transition-colors ${mobileViewTab === 'document' ? 'text-white' : 'text-slate-600'
            }`}
        >
          Document
        </button>
        <button
          onClick={goToActions}
          aria-pressed={mobileViewTab === 'sidebar'}
          className={`min-h-10 flex-1 sm:flex-none px-3 py-1.5 font-semibold rounded transition-colors ${mobileViewTab === 'sidebar' ? 'text-white' : 'text-slate-600'
            }`}
        >
          Go to actions
        </button>
      </div>

      {/* Notifications / Alerts */}
      {actionError && !actionModal && (
        <div key={actionError} role="alert" className="handoff-enter alert-nudge no-print p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{actionError}</span>
          </div>
          <button onClick={() => setActionError(null)} aria-label="Dismiss error" className="text-rose-600 hover:text-rose-800 p-1 rounded hover:bg-rose-100/60 transition-colors">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {actionSuccess && (
        <div key={actionSuccess} role="status" className="handoff-enter no-print p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            <span>{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} aria-label="Dismiss message" className="text-emerald-600 hover:text-emerald-800 p-1 rounded hover:bg-emerald-100/60 transition-colors">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {receiptId && receiptError && <div role="alert" className="no-print rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
        {receiptError} <button type="button" className="preci-link min-h-9" onClick={() => { setReceiptError(''); retryReceipt(value => value + 1); }}>Retry read receipt</button>
      </div>}
      {/* DocuSign-Style Recipient Tracking & Stepper Banner */}
      <div className="no-print">
        <DocuSignProgressBanner
          request={request}
          currentUserId={currentUser.id}
        />
      </div>

      {/* Split Layout: 62% Document Focus + 38% Actions & history on Desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* ================= LEFT: ORIGINAL A4 DOCUMENT (62%) ================= */}
        <section id="review-document" aria-labelledby="review-document-title" tabIndex={-1}
          className="min-w-0 lg:col-span-7 xl:col-span-8 space-y-3 scroll-mt-32"
        >
          <div className="workspace-panel no-print space-y-3 p-3 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="review-document-title" className="text-sm font-bold text-[#192B3C]">Document preview</h2>
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <label htmlFor="review-version">Version</label>
                <select id="review-version" className="workspace-control min-h-10 px-2 text-xs" value={selectedVersion} onChange={event => setSelectedVersion(Number(event.target.value))}>
                  {versionOptions.map(version => <option key={version} value={version}>
                    {version}{version === request.documentVersion ? ' · Latest' : version === 1 ? ' · Original' : ''}
                  </option>)}
                </select>
              </div>
            </div>
            {!onLatestVersion && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
              <span role="status"><strong>Historical version {selectedVersion} · Read-only</strong>{selectedDocument?.historicalStatus && ` · ${selectedDocument.historicalStatus}`}</span>
              <button type="button" className="workspace-control min-h-9 px-2 font-semibold" onClick={() => setSelectedVersion(request.documentVersion)}>Return to latest</button>
            </div>}
            {/* Display tools */}
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <div className="flex items-center gap-1 border border-[#E2E5E9] rounded px-1.5 py-0.5 bg-slate-50">
                <button
                  onClick={() => setZoomLevel((z) => Math.max(70, z - 10))}
                  className="p-1 rounded text-slate-500 hover:bg-slate-200"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-mono font-semibold text-slate-600 px-1 tabular-nums">
                  {zoomLevel}%
                </span>
                <button
                  onClick={() => setZoomLevel((z) => Math.min(130, z + 10))}
                  className="p-1 rounded text-slate-500 hover:bg-slate-200"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                onClick={async () => { try { const latest = await readLatestRoute(request.id); if (!latest || latest.updatedAt !== request.updatedAt) { setActionError('The route changed. Reload and review before printing.'); return; } window.print(); } catch { setActionError('Could not verify current access before printing.'); } }}
                className="flex items-center gap-1 px-2.5 py-1 border border-[#CBD5E1] bg-white hover:bg-slate-50 rounded text-xs font-medium text-slate-700 shadow-xs"
                title="Print or save the displayed document as a PDF"
              >
                <Printer className="w-3.5 h-3.5 text-slate-600" />
                <span>Print / Save as PDF</span>
              </button>
              {downloadDocumentPdf && <button type="button" onClick={handleDownloadPdf} disabled={downloadingPdf}
                className="flex items-center gap-1 px-2.5 py-1 border border-[#CBD5E1] bg-white hover:bg-slate-50 rounded text-xs font-medium text-slate-700 shadow-xs disabled:opacity-50">
                <Download className="w-3.5 h-3.5" />
                <span>{downloadingPdf ? 'Preparing PDF…' : 'Download PDF'}</span>
              </button>}

              <button
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="p-1.5 border border-[#CBD5E1] bg-white hover:bg-slate-50 rounded text-slate-600 shadow-xs"
                title={isFullscreen ? 'Exit Full Screen' : 'Expand Full Screen'}
              >
                {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {showSubmissionNote && <section aria-label="Note to signers" className="no-print rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Note to signers</h2>
            <p className="mt-1 text-xs text-slate-600">{submission?.actionByName} · Version {selectedVersion}</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">{submissionNote}</p>
          </section>}

          {/* Document Render Container */}
          <div
            role="region"
            aria-label="Scrollable document preview"
            tabIndex={0}
            className={`printable-area min-w-0 overflow-auto rounded-xl bg-[#dfe9f1] p-2 sm:p-4 border border-[#d2dee8] ${isFullscreen ? 'fixed inset-2 z-50 bg-slate-900/90 p-4 sm:p-8 max-h-none' : ''
              }`}
          >
            {isFullscreen && (
              <button
                onClick={() => setIsFullscreen(false)}
                className="fixed top-4 right-4 z-50 px-3 py-1.5 bg-[#192B3C] text-white rounded-md text-xs font-semibold flex items-center gap-1 shadow-lg"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Close Full Screen</span>
              </button>
            )}

            <div
              style={{
                zoom: zoomLevel / 100,
              }}
              className="document-preview-page min-w-0 flex items-start justify-center-safe [&>*]:shadow-md print:[&>*]:shadow-none"
            >
              {selectedDocument ? <RequestDocument
                formType={request.formType}
                data={activeFormData}
                attachments={visibleAttachments}
                processing={selectedDocument.processing}
              /> : <p role="status">This document version is unavailable.</p>}
            </div>
          </div>
        </section>

        {actionsSheet !== 'closed' && <div className="sheet-backdrop no-print lg:hidden" data-open={actionsSheet === 'open'} onClick={closeActionsSheet} />}
        <aside aria-label="Request details" data-sheet={actionsSheet} className="review-aside-sheet no-print min-w-0 space-y-4 lg:col-span-5 xl:col-span-4">
          {actionsSheet !== 'closed' && <div className="sheet-drag sticky top-0 z-10 -mx-3 bg-[#f3f6f9] lg:hidden"
            onPointerDown={event => { if ((event.target as HTMLElement).closest('button')) return; sheetDrag.current = { y: event.clientY, at: Date.now() }; event.currentTarget.setPointerCapture(event.pointerId); }}
            onPointerUp={event => { const start = sheetDrag.current; sheetDrag.current = null; if (!start) return; const distance = event.clientY - start.y; if (distance > 80 || distance / Math.max(1, Date.now() - start.at) > 0.11) closeActionsSheet(); }}>
            <div className="sheet-handle" aria-hidden="true" />
            <div className="flex items-center justify-between px-3 pb-2">
              <h2 className="text-sm font-semibold text-workspace-ink">Actions and details</h2>
              <button type="button" aria-label="Close actions" className="preci-press grid size-9 place-items-center rounded-md text-workspace-muted" onClick={closeActionsSheet}><X aria-hidden="true" className="size-4" /></button>
            </div>
          </div>}
          {request.formData.rnd && onLatestVersion && <RndEvaluationPanel key={`${request.id}:${request.documentVersion}:${request.approvalSteps.at(-1)?.assignedUserId}`} request={request} />}
          <div ref={actionsRef} tabIndex={-1} className="workspace-panel scroll-mt-32 space-y-4 border-t-2 border-t-[#365c78] p-4">
            <h3 className="text-sm font-bold">{request.status === 'Approved' ? 'Request overview' : 'Request actions'}</h3>
            {!onLatestVersion ? <div className="space-y-2 text-xs text-workspace-muted">
              <p>You’re viewing version {selectedVersion}. Open the latest version to act on this request.</p>
              <button type="button" className="workspace-control min-h-10 px-3 font-semibold" onClick={() => {
                setSelectedVersion(request.documentVersion);
                setMobileViewTab('document');
              }}>Open latest version</button>
            </div> : isReturned ? <div className="space-y-2 text-sm">
              <p className="font-semibold text-amber-900">Corrections requested</p>
              <p className="whitespace-pre-wrap text-xs text-workspace-muted">{correctionReason || 'The signer requested changes.'}</p>
              {isRequester && <button type="button" className="workspace-primary min-h-10 px-3 text-xs" onClick={() => openAction('resubmit')}>Edit &amp; resend</button>}
            </div> : (canSign || canOverride || canManageAfterSigning) ? <div className="space-y-3">
              {request.formData.rnd && request.status === 'Pending Approval' && isFinalApprover && finalAlreadySigned && (
                <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-3 space-y-2 text-xs">
                  <p className="font-bold text-teal-950">Next Action: Complete Section H Evaluation &amp; Route</p>
                  <p className="text-slate-700">
                    Your signature is saved. Section H evaluation and route completion are required to finalize this request.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById('rnd-evaluation-section');
                      el?.scrollIntoView({ behavior: 'smooth' });
                      el?.focus();
                    }}
                    className="workspace-primary min-h-9 px-3 text-xs font-semibold"
                  >
                    Go to Section H evaluation
                  </button>
                </div>
              )}
              {isFinalApprover && outstanding.length > 0 && <p className="text-xs leading-relaxed text-workspace-muted">
                {finalAlreadySigned ? 'Your signature is saved. The other signers can still sign.'
                  : 'You can sign now. The request stays open for the other signers.'}
                {canOverride && ' To finish early, give a reason for bypassing their signatures.'}
              </p>}
              {canSign && <label className="block space-y-1 text-xs">
                <span className="font-semibold text-slate-800">Signer remarks (optional)</span>
                <textarea className="workspace-control min-h-20 w-full p-2.5 text-xs rounded-lg border border-slate-300 focus:border-teal-600 focus:ring-1 focus:ring-teal-600" value={signingRemark} maxLength={2000} onChange={event => setSigningRemark(event.target.value)} placeholder="Add a remark for the signing history (optional)" />
                <span className="block text-slate-500 text-[11px]">Saved with Approve & sign in the request history, outside the form.</span>
              </label>}
              {canSign && <button type="button" onClick={handleApproveClick} className="workspace-primary flex min-h-11 w-full items-center justify-center gap-2 px-4 text-sm font-semibold shadow-sm">
                <Check aria-hidden="true" className="size-4" />{canOverride ? 'Approve & sign · keep open' : 'Approve & sign'}
              </button>}
              {canOverride && <button type="button" onClick={() => openAction('override')} className={`${finalAlreadySigned ? 'workspace-primary min-h-11 shadow-sm' : 'workspace-control min-h-10'} w-full px-3 text-xs font-semibold`}>{completionLabel}</button>}
              <div className="flex flex-wrap gap-2 pt-1">
                {(isFinalApprover || request.workflowConfig.stages[request.currentStageIndex]?.canReturnForCorrection) &&
                  <button type="button" className="workspace-control min-h-10 px-3 text-xs font-semibold text-amber-900 border-amber-300 bg-amber-50/60 hover:bg-amber-100/80" onClick={() => openAction('return')}>Request corrections</button>}
                {(isFinalApprover || request.workflowConfig.stages[request.currentStageIndex]?.canReject) &&
                  <button type="button" className="workspace-control min-h-10 px-3 text-xs font-semibold text-rose-800 border-rose-300 bg-rose-50/60 hover:bg-rose-100/80" onClick={() => openAction('reject')}>Reject request</button>}
              </div>
            </div> : request.status !== 'Approved' ? (
              request.formData.rnd && request.status === 'Pending Approval' && isFinalApprover && finalAlreadySigned ? (
                <div className="rounded-lg border border-teal-200 bg-teal-50/70 p-3 space-y-2 text-xs">
                  <p className="font-bold text-teal-950">Next Action: Complete Section H Evaluation &amp; Route</p>
                  <p className="text-slate-700">
                    Your signature is saved. Section H evaluation and route completion are required to finalize this request.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById('rnd-evaluation-section');
                      el?.scrollIntoView({ behavior: 'smooth' });
                      el?.focus();
                    }}
                    className="workspace-primary min-h-9 px-3 text-xs font-semibold"
                  >
                    Go to Section H evaluation
                  </button>
                </div>
              ) : (
                <p className="text-xs text-workspace-muted">{request.status === 'Cancelled' ? 'This request was cancelled.'
                  : request.status === 'Rejected' ? 'This request was rejected.'
                    : currentStep?.assignedUserName ? `Waiting for ${currentStep.assignedUserName} to sign.` : 'No signing action is available to you.'}</p>
              )
            ) : null}
            {onLatestVersion && <RouteProcessingPanel key={request.id} request={request} />}
            {!!request.omittedSigningSteps?.length && <div className="space-y-1 border-t border-workspace-line pt-3 text-xs">
              <p className="font-semibold">Signatures not requested</p>
              <p className="break-words text-workspace-muted">{request.omittedSigningSteps.join(', ')}</p>
            </div>}
            {isRequester && onLatestVersion && ['Pending Approval', 'Returned for Correction'].includes(request.status) && <div className="border-t border-workspace-line pt-3">
              <button type="button" className="workspace-control preci-press min-h-10 px-3 text-xs" onClick={() => openAction('cancel')}>Cancel request</button>
            </div>}
            {request.status === 'Approved' && <button type="button" className="workspace-control inline-flex min-h-10 w-full items-center justify-center gap-2 px-3 py-2 text-xs font-semibold" onClick={handleDownloadRouteSummary}>
              <Download aria-hidden="true" className="size-4 shrink-0" />
              {onLatestVersion ? 'Download route summary' : 'Download latest route summary'}
            </button>}
          </div>
          {onLatestVersion && <FinanceHoldPanel key={`finance-${request.id}`} request={request} onDownload={handleDownloadAttachment} />}

          {canRespond && onLatestVersion && <div ref={replacementRef} tabIndex={-1} className="workspace-panel scroll-mt-32 space-y-2 p-4 text-sm">
            <h3 className="font-semibold">Final approver invitation</h3>
            <p className="text-xs text-workspace-muted">Accept to take over signing and completion. The current approver stays assigned until you accept.</p>
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-xs"><strong>Reason:</strong> {request.pendingReplacement?.reason}</p>
            <div className="flex flex-wrap gap-2">
              {[true, false].map(accept => <button key={String(accept)} type="button" disabled={saving} className={`${accept ? 'workspace-primary' : 'workspace-control'} min-h-10 px-3 text-xs font-semibold`} onClick={async () => {
                setSaving(true);
                setActionError(null);
                const result = await acceptReplacement(request.id, accept);
                setSaving(false);
                if (result.success) setActionSuccess(accept ? 'You are now the final approver.' : 'Assignment declined.');
                else setActionError(result.error || 'Could not respond to the assignment.');
              }}>{accept ? 'Accept assignment' : 'Decline'}</button>)}
            </div>
          </div>}
          {onLatestVersion && request.status === 'Pending Approval' && (canProposeFinalReplacement(request, currentUser) || (!configuredBackups && canAdministerWorkflows(currentUser))) &&
            <details className="workspace-panel rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-xs group [&_summary::-webkit-details-marker]:hidden">
              <summary className="cursor-pointer list-none flex items-center justify-between font-semibold text-slate-800 hover:text-workspace-teal">
                <div className="flex items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-lg bg-workspace-tint text-workspace-teal">
                    <UserCheck aria-hidden="true" className="size-4" />
                  </span>
                  <span>Signer replacement &amp; delegation</span>
                </div>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 group-open:bg-teal-50 group-open:text-teal-700">
                  Delegate route step
                </span>
              </summary>
              <div className="mt-3.5 space-y-3 pt-3 border-t border-slate-100">
                {request.pendingReplacement ? <p>Waiting for the proposed final approver to accept. The current approver is still assigned.</p>
                  : replaceableSteps.length === 0 ? <p className="text-workspace-muted">No unsigned steps are available to replace.</p> : <>
                    <p className="text-xs text-workspace-muted">{configuredBackups
                      ? 'Choose a saved backup or restore the primary signer. The assignment changes as soon as you save.'
                      : 'Other replacements take effect immediately. A new final approver must accept first.'}</p>
                    <label className="block">Signer to replace
                      <select className="workspace-control mt-1 block min-h-10 w-full px-2" value={replacementStage} onChange={e => { setReplacementStage(e.target.value); setReplacementUser(''); }}>
                        <option value="">Choose a signer</option>
                        {replaceableSteps.map(step => <option key={step.stageId} value={step.stageId}>{step.assignedUserName} · {step.stageName}</option>)}
                      </select>
                    </label>
                    <label className="block">{configuredBackups ? 'Backup or original signer' : 'Replacement'}
                      <select disabled={replacementCandidates.length === 0} className="workspace-control mt-1 block min-h-10 w-full px-2" value={replacementUser} onChange={e => setReplacementUser(e.target.value)}>
                        <option value="">Choose a replacement</option>
                        {replacementCandidates.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
                      </select>
                    </label>
                    {replacementStage && replacementCandidates.length === 0 && <p role="status" className="text-xs text-workspace-muted">No eligible replacements are available for this signer.</p>}
                    <label className="block">Reason (required)
                      <textarea className="workspace-control mt-1 block w-full p-2" value={replacementReason} onChange={e => setReplacementReason(e.target.value)} />
                    </label>
                    <button type="button" disabled={saving || !replacementCandidates.some(user => user.id === replacementUser) || !replacementReason.trim()}
                      className="workspace-control min-h-10 px-3 font-semibold" onClick={async () => {
                        setSaving(true);
                        setActionError(null);
                        const result = await replaceSigner(request.id, replacementStage, replacementUser, replacementReason);
                        setSaving(false);
                        if (!result.success) { setActionError(result.error || 'Replacement failed.'); return; }
                        setReplacementReason('');
                        setReplacementStage('');
                        setReplacementUser('');
                        setActionSuccess(configuredBackups ? 'Signer replaced. The change is in the request history.' : 'Replacement saved. Check the request history for its status.');
                      }}>{configuredBackups ? 'Assign replacement' : 'Save replacement'}</button>
                  </>}
              </div>
            </details>}
          <ReviewSupportingFiles version={selectedVersion} attachments={visibleAttachments} onDownload={handleDownloadAttachment} />

          {/* Detailed approval history */}
          {!onLatestVersion && <p className="text-xs text-workspace-muted">Showing document version {selectedVersion}. The history below contains activity across versions; the progress summary above shows the latest route.</p>}
          <ApprovalJourneyPanel historyOnly
            request={request}
            currentUserId={currentUser.id}
          />

        </aside>
      </div>

      {/* Action Modal: Return for Correction */}
      {actionModal === 'return' && (
        <ReturnRequestDialog
          saving={saving}
          actionReason={actionReason}
          actionError={actionError}
          onReasonChange={setActionReason}
          onClose={() => { setActionError(null); setActionModal(null); }}
          onSubmit={handleReturnSubmit}
        />
      )}

      {/* Action Modal: Reject Request */}
      {(actionModal === 'reject' || actionModal === 'cancel') && (
        <CloseRequestDialog
          mode={actionModal}
          saving={saving}
          actionReason={actionReason}
          actionError={actionError}
          onReasonChange={setActionReason}
          onClose={() => setActionModal(null)}
          onSubmit={handleRejectSubmit}
        />
      )}

      {/* Action Modal: Route Completion / Override */}
      {actionModal === 'override' && !signatureModalOpen && (
        <CompleteRouteDialog
          saving={saving}
          completionLabel={completionLabel}
          outstanding={outstanding}
          actionReason={actionReason}
          actionError={actionError}
          finalAlreadySigned={finalAlreadySigned}
          onReasonChange={setActionReason}
          onClose={() => setActionModal(null)}
          onSubmit={() => {
            if (completionRecordTime.current !== request.updatedAt) {
              setActionError('The request changed. Close this dialog and review the latest request.');
              return;
            }
            if (!actionReason.trim()) {
              setActionError('Enter a reason before continuing.');
              document.getElementById('route-completion-reason')?.focus();
              return;
            }
            setActionError(null);
            if (finalAlreadySigned) void handleFinalRouteCompletionSubmit('');
            else {
              setSignatureAction('override');
              signingRecordTime.current = request.updatedAt;
              setSignatureModalOpen(true);
            }
          }}
        />
      )}

      {/* Action Modal: Resubmit Request */}
      {actionModal === 'resubmit' && (
        <CorrectionDialog
          request={request}
          currentUser={currentUser}
          saving={saving}
          actionError={actionError}
          correctedForm={correctedForm}
          correctedAttachments={correctedAttachments}
          resubmitChangeNote={resubmitChangeNote}
          onFormChange={setCorrectedForm}
          onAttachmentsChange={setCorrectedAttachments}
          onChangeNoteChange={setResubmitChangeNote}
          onClose={() => setActionModal(null)}
          onSubmit={() => {
            setSignatureAction('resubmit');
            signingRecordTime.current = request.updatedAt;
            setSignatureModalOpen(true);
          }}
        />
      )}

      {/* Signature Confirmation Modal */}
      {(
        <SignatureModal
          isOpen={signatureModalOpen}
          onClose={() => setSignatureModalOpen(false)}
          user={currentUser}
          onSignatureProfile={() => {
            setSignatureReturn({ userId: currentUser.id, requestId: request.id, remark: signingRemark, updatedAt: request.updatedAt });
            openSignatureProfile();
          }}
          reviewContext={{ version: request.documentVersion, responsibility: signatureAction === 'resubmit' ? 'Requester' : isFinalApprover ? 'Final approver' : currentStep?.stageName || 'Assigned signer' }}
          title={signatureAction === 'resubmit' ? 'Sign corrected request' : signatureAction === 'override' ? 'Sign & complete' : 'Approve & sign'}
          confirmLabel={signatureAction === 'override' ? 'Sign & complete' : 'Confirm & sign'}
          onConfirm={(signature) => handleSignatureConfirmation(signature, signatureAction === 'approve' ? signingRemark.trim() || undefined : undefined)}
        />
      )}

    </div>
  );
};
