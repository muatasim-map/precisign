import { toast } from '../common/Toaster';
import { MorphButton } from '../common/MorphButton';
import { checkSupportingFiles, SupportingFiles } from './SupportingFiles';
import { canUserStartForm } from '../../utils/companyAccess';
import { EditorInput, EditorTextarea, EditorSelect, FormField, ActionButton } from './RequestEditorControls';
import { EditorViewToggle } from './EditorViewToggle';
import { DraftConfirmDialog } from './DraftConfirmDialog';
import { useFieldErrors } from './useFieldErrors';
import React, { useState, useEffect, useRef } from 'react';
import { ApiError } from '../../services/apiTypes';
import { useApp, useUnsavedWork } from '../../context/AppContext';
import { AdminWorkFormData, PriorityLevel, AttachmentItem, CompanyId } from '../../types/index';
import { AdminWorkRequestDocument } from '../document/AdminWorkRequestDocument';
import { AdministrativePaymentDocument } from '../document/AdministrativePaymentDocument';
import { SignatureModal } from '../modals/SignatureModal';
import { canAdministerWorkflows, resolveConfiguredSigner } from '../../utils/workflowAdministration';
import { applySignerChoices, type SignerChoices as Choices } from '../../utils/signingSelection';
import { ProcessorChoicesFields, useProcessorSelection } from './ProcessorChoices';
import { SignerChoices } from './SignerChoices';
import { RequestCompanyField } from './RequestCompanyField';
import {
  FileText,
  Printer,
  Maximize2,
  Minimize2,
  Save,
  RotateCcw,
  Send,
  Calendar,
  AlertCircle,
  CheckCircle,
  Upload,
  ZoomIn,
  ZoomOut,
  Eye,
  Check,
} from 'lucide-react';

export const CreateRequestView: React.FC = () => {
  const {
    currentUser,
    readOnly: connected,
    draftCompanyId,
    selectDraftCompany,
    reloadDraft,
    companies,
    selectedScope,
    selectedCompany,
    workflows,
    users,
    draftFormData: savedDraft,
    selectedRequestFormType,
    saveDraft,
    clearDraft,
    submitNewRequest,
    setActiveView,
    openReviewRequest,
  } = useApp();
  const combined = selectedRequestFormType === 'Administrative & Payment Request';
  const formName = combined ? 'Administrative & Payment Request' : 'Admin Work Request';
  const validation = useFieldErrors();
  const availableCompanies = companies.filter(company => canUserStartForm(currentUser, company.id, formName));
  const [draftDialog, setDraftDialog] = useState<'clear' | 'reload' | null>(null);
  const [choices, setChoices] = useState<Choices>({});
  const draftFormData = combined ? null : savedDraft;
  const [documentDescription, setDocumentDescription] = useState('');
  const [payment, setPayment] = useState<NonNullable<NonNullable<AdminWorkFormData['administrativePayment']>['payment']>>();

  const [originatingCompanyId, setOriginatingCompanyId] = useState<CompanyId>(() => {
    if (connected && draftCompanyId) return draftCompanyId;
    if (draftFormData?.companyId) return draftFormData.companyId;
    if (selectedScope && selectedScope !== 'PEG') {
      return selectedScope as CompanyId;
    }
    return currentUser.companyId || 'PEW';
  });

  const [dateOfRequest, setDateOfRequest] = useState(() => {
    return (
      draftFormData?.dateOfRequest ??
      new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    );
  });

  const [department, setDepartment] = useState(
    draftFormData?.department ?? (currentUser.department || 'Administration')
  );

  const [priority, setPriority] = useState<PriorityLevel | undefined>(
    draftFormData?.priority ?? (combined ? undefined : 'Urgent')
  );

  const [workDescription, setWorkDescription] = useState(
    draftFormData?.workDescription ??
      (connected ? '' : 'Attestation of commercial contract with Ministry of Commerce & Chamber of Commerce for the new facility expansion project.')
  );

  const [documents, setDocuments] = useState(
    draftFormData?.documents || {
      onlineDocumentChamber: !combined,
      physicalDocumentChamber: false,
      companyDocumentAjeer: false,
      employeeSalaryCertificate: false,
      permanentEmploymentVisa: false,
      workVisitVisa: false,
      businessVisitVisa: false,
      agencyWakala: false,
      others: false,
      othersDescription: '',
    }
  );

  const [attachments, setAttachments] = useState<AttachmentItem[]>(draftFormData?.attachments || []);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [emailNote, setEmailNote] = useState('');
  const submitting = useRef(false);
  const [submittingNow, setSubmittingNow] = useState(false);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [attachmentError, setAttachmentError] = useState('');
  const savedGeneration = useRef(0);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [activeMobileTab, setActiveMobileTab] = useState<'editor' | 'preview'>('editor');

  useUnsavedWork(JSON.stringify({ originatingCompanyId, dateOfRequest, department, priority, workDescription, documents, documentDescription, payment, choices, pendingUploads, attachments: attachments.map(file => file.id) }));

  const resolvedCompany = companies.find((c) => c.id === originatingCompanyId) || selectedCompany;
  const signingWorkflow = workflows.find(workflow => workflow.companyId === originatingCompanyId && workflow.formType === formName && workflow.stages.length > 0);
  const canStartSelectedCompany = companies.some(company => company.id === originatingCompanyId && canUserStartForm(currentUser, company.id, formName));
  const signingSteps = signingWorkflow?.stages ?? [];
  const processors = useProcessorSelection(signingWorkflow);

  const draftData = () => ({ dateOfRequest, department, priority, workDescription, documents, companyId: originatingCompanyId, attachments });
  const reportDraftError = (error: unknown) => {
    setLastSavedTime(null);
    setDraftSaveError(error instanceof ApiError && error.status === 409
      ? 'Your draft changed in another tab. Your entries are kept here. Load the saved draft to review the other version before editing again.'
      : `Draft not saved: ${error instanceof Error ? error.message : 'storage error'}. Your entries are kept here.`);
  };
  // Each edit is queued for its own user/company key. No timer can fire after switching editors.
  useEffect(() => {
    if (combined) return;
    const generation = ++savedGeneration.current;
    let active = true;
    setLastSavedTime(null); setDraftSaving(true);
    void saveDraft(draftData()).then(() => {
      if (active && generation === savedGeneration.current) {
        setDraftSaveError(null);
        setLastSavedTime(new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' }));
      }
    }).catch(error => { if (active && generation === savedGeneration.current) reportDraftError(error); })
      .finally(() => { if (active && generation === savedGeneration.current) setDraftSaving(false); });
    return () => { active = false; };
  }, [combined, dateOfRequest, department, priority, workDescription, documents, originatingCompanyId, attachments]);

  const retrySave = async () => {
    setDraftSaving(true);
    try { await saveDraft(draftData(), true); setDraftSaveError(null); setLastSavedTime(new Date().toLocaleTimeString()); }
    catch (error) { reportDraftError(error); }
    finally { setDraftSaving(false); }
  };

  // Preview form data
  const previewData: AdminWorkFormData = {
    dateOfRequest,
    companyId: resolvedCompany.id,
    companyName: resolvedCompany.fullName,
    companyLogoDataUrl: resolvedCompany.logoDataUrl,
    requesterId: currentUser.id,
    requesterName: currentUser.name,
    department,
    priority: priority ?? 'Urgent',
    workDescription,
    documents,
    administrativePayment: combined ? { documentDescription, payment } : undefined,
    requesterSignatureName: undefined,
    requesterSignatureDataUrl: undefined,
    approvalAuthoritySignatureName: undefined,
    approvalAuthoritySignatureDataUrl: undefined,
  };

  const handleDocumentToggle = (key: keyof typeof documents) => {
    setDocuments((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleFileUpload = (files: FileList) => {
    const selected = Array.from(files);
    const issue = checkSupportingFiles(selected, attachments, 20);
    setAttachmentError(issue ?? '');
    if (issue) return;

    setPendingUploads(count => count + selected.length);
    selected.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        const sizeFormatted =
          file.size > 1024 * 1024
            ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
            : `${Math.ceil(file.size / 1024)} KB`;

        const newAtt: AttachmentItem = {
          id: `att-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          name: file.name,
          sizeBytes: file.size,
          sizeFormatted,
          uploadedAt: new Date().toISOString(),
          uploadedBy: currentUser.name,
          mimeType: file.type || 'application/octet-stream',
          dataUrl,
        };

        setAttachments((prev) => [...prev, newAtt]);
        setPendingUploads(count => count - 1);
      };
      reader.onerror = () => { setPendingUploads(count => count - 1); setAttachmentError(`Could not read ${file.name}. Please select it again.`); };
      reader.readAsDataURL(file);
    });
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handleClear = async () => {
    {
      try {
        if (!combined) await clearDraft();
      } catch (error) {
        setValidationError(`Draft could not be cleared: ${error instanceof Error ? error.message : 'storage error'}`);
        return false;
      }
      setWorkDescription('');
      setDocumentDescription('');
      setPayment(undefined);
      setAttachments([]);
      if (combined) setPriority(undefined);
      setDocuments({
        onlineDocumentChamber: false,
        physicalDocumentChamber: false,
        companyDocumentAjeer: false,
        employeeSalaryCertificate: false,
        permanentEmploymentVisa: false,
        workVisitVisa: false,
        businessVisitVisa: false,
        agencyWakala: false,
        others: false,
        othersDescription: '',
      });
      toast('Draft cleared.', 'info');
      return true;
    }
  };

  const handleTriggerSubmit = () => {
    if (submitting.current || pendingUploads) return;
    setValidationError(null);
    setActiveMobileTab('editor');
    if (combined) {
      if (!validation.validate([
        ['company', canStartSelectedCompany, 'Choose a company where you can start this form.'],
        ['date', !!dateOfRequest, 'Choose a date.'],
        ['department', !!department.trim(), 'Enter your department.'],
        ['priority', !!priority, 'Choose a priority.'],
        ['description', !!workDescription.trim(), 'Describe the work.'],
        ['amount', !payment || (/^\d{1,9}(\.\d{1,2})?$/.test(payment.amount) && Number(payment.amount) > 0), 'Enter a positive SAR amount.'],
        ['other', !payment || payment.purpose !== 'Other' || !!payment.otherPurpose?.trim(), 'Describe the payment purpose.'],
      ])) return;
      const selection = signingWorkflow && applySignerChoices(signingWorkflow, users, currentUser.id, choices);
      if (!selection || selection.error) {
        requestAnimationFrame(() => document.getElementById('signer-review')?.focus());
        return;
      }
      if (payment && (!/^\d{1,9}(\.\d{1,2})?$/.test(payment.amount) || Number(payment.amount) <= 0 || (payment.purpose === 'Other' && !payment.otherPurpose?.trim()))) {
        setValidationError('Enter a positive SAR amount and describe the purpose if you selected Other.');
        return;
      }
    } else {
      if (!validation.validate([
        ['priority', !!priority, 'Choose a priority before submitting.'],
        ['description', !!workDescription.trim(), 'Please enter a work description before submitting.'],
      ])) return;
    }
    // Open signature confirmation modal
    setSignatureModalOpen(true);
  };

  const handleConfirmedSubmit = async (signatureDataUrl: string, note?: string, emailNoteValue?: string) => {
    if (submitting.current) return;
    submitting.current = true; setSubmittingNow(true);
    const result = await submitNewRequest(
      previewData,
      attachments,
      note,
      signatureDataUrl,
      combined ? choices : undefined,
      emailNoteValue ?? (combined ? emailNote : undefined),
      processors.choices
    );
    if (result.success && result.newId) {
      // The page changes right away, so the confirmation travels with the user as a toast.
      toast('Request submitted. It’s now with the first signer.');
      openReviewRequest(result.newId);
    } else {
      submitting.current = false; setSubmittingNow(false);
      if (result.routeChanged) { setSignatureModalOpen(false); setChoices({}); }
      setValidationError(result.error || 'Couldn’t send the request. Your entries are kept. Check your connection and try again.');
    }
    return result;
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div data-editor-view={activeMobileTab} className="request-editor request-create p-3.5 sm:p-6 md:p-8 max-w-[1600px] mx-auto space-y-4 sm:space-y-6">
      {draftDialog && <DraftConfirmDialog mode={draftDialog} onClose={() => setDraftDialog(null)} onConfirm={async () => {
        if (draftDialog === 'reload') { reloadDraft(); return true; }
        return await handleClear() ?? false;
      }} />}
      {/* Top Header & Context */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-[#E2E5E9]">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 mb-1">
            <button
              onClick={() => setActiveView('dashboard')}
              className="hover:text-[#365C78] transition-colors"
            >
              Dashboard
            </button>
            <span>/</span>
            <span className="text-slate-400">Request Creation</span>
            <span>/</span>
            <span className="text-[#192B3C] font-semibold">{formName}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#EBF2F7] text-[#365C78] flex items-center justify-center border border-[#C2D5E3]">
              <FileText aria-hidden="true" className="size-4" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-[#192B3C] tracking-tight">
                Create {formName}
              </h1>
              <p className="text-xs text-slate-500">
                {combined ? 'Request administrative work and add payment details when needed. Entries stay here until you leave.' : 'Official bilingual administrative request form (PR#21-001FA) with live A4 preview.'}
              </p>
            </div>
          </div>
        </div>

        {/* Status Actions: Auto-save status + Save Draft + Submit */}
        <div className="flex flex-wrap items-center gap-2">
          {draftSaving && <span role="status" className="text-[11px] text-slate-500">Saving draft…</span>}
          {lastSavedTime && (
            <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-500 mr-2">
              <Check className="w-3.5 h-3.5 text-emerald-600" />
              <span>Draft saved at {lastSavedTime}</span>
            </div>
          )}

          <ActionButton
            variant="quiet"
            size="sm"
            className="max-md:hidden"
            disabled={submittingNow || draftSaving}
            onClick={() => setDraftDialog('clear')}
          >
            Clear Form
          </ActionButton>

          <MorphButton
            variant="primary"
            size="md"
            className="max-md:hidden"
            icon={Send}
            state={submittingNow ? 'busy' : 'idle'}
            busyLabel="Submitting…"
            disabled={pendingUploads > 0}
            onClick={handleTriggerSubmit}
          >
            Sign &amp; Submit Request
          </MorphButton>
        </div>
      </div>

      <EditorViewToggle value={activeMobileTab} onChange={setActiveMobileTab} />

      {/* Alerts */}
      {draftSaveError && <div key={draftSaveError} role="alert" className="handoff-enter p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 space-y-2"><p>{draftSaveError}</p><button disabled={draftSaving} className="underline mr-3" onClick={retrySave}>Retry draft save</button>{connected && <button className="underline" onClick={() => setDraftDialog('reload')}>Load saved draft</button>}</div>}
      {validationError && (
        <div key={validationError} role="alert" className="handoff-enter alert-nudge p-3 bg-rose-50 border border-rose-200 rounded-md text-xs text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
          <span>{validationError}</span>
        </div>
      )}

      {feedbackSuccess && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-800 flex items-center gap-2">
          <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{feedbackSuccess}</span>
        </div>
      )}

      {!combined && <section className="no-print rounded-lg border border-slate-200 bg-white p-4 text-sm" aria-label="PreciRoute signers">
        <h2 className="font-bold text-[#192B3C]">Review signers</h2>
        <ol className="mt-2 space-y-2">
          <li><strong>{currentUser.name}</strong> · Requester (you)</li>
          {signingSteps.map((stage, index) => {
            const signer = resolveConfiguredSigner(stage, users, originatingCompanyId);
            return <li key={stage.id}><strong>{signer?.name ?? 'Signer not configured'}</strong> · {index === signingSteps.length - 1 ? 'Final approver' : stage.name}</li>;
          })}
        </ol>
        <p className="mt-2 text-xs text-slate-600">{signingSteps.length ? 'You sign as requester when you send.' : 'No approval route is configured for this company.'}</p>
      </section>}
      {/* Split-Screen: Left Editor (50%) + Right Live A4 Preview (50%) */}
      <div className="editor-columns items-start">
        {/* Left Column: Focused Form Editor */}
        <fieldset disabled={submittingNow}
          className={`editor-fields workspace-panel no-print space-y-6 p-4 sm:p-6 ${combined ? 'request-field-polish admin-payment-fields' : ''}`}
        >
          {validation.summary()}

          {/* Section 1: Entity & Requester Details */}
          <div className="space-y-4">
            <div className="pb-2 border-b border-[#E2E5E9] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-workspace-ink">
                Request details
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Date */}
              <FormField id={combined ? validation.props("date").id : "request-date"} label="Date of Request" required>
                <div className="relative">
                  <Calendar aria-hidden="true" className="request-date-icon w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <EditorInput
                    id="request-date" {...(combined ? validation.props("date") : {})}
                    type="text"
                    value={dateOfRequest}
                    onBlur={combined ? () => validation.checkField("date", !!dateOfRequest, 'Choose a date.') : undefined}
                    onChange={(e) => setDateOfRequest(e.target.value)}
                    className="pl-9"
                  />
                </div>
                {combined && validation.message("date")}
              </FormField>

              {/* Department */}
              <FormField id={combined ? validation.props("department").id : "request-department"} label="Department" required>
                <EditorInput
                  id="request-department" {...(combined ? validation.props("department") : {})}
                  type="text"
                  value={department}
                  onBlur={combined ? () => validation.checkField("department", !!department.trim(), 'Enter your department.') : undefined}
                  onChange={(e) => setDepartment(e.target.value)}
                />
                {combined && validation.message("department")}
              </FormField>

              {/* Requester (read-only) */}
              <FormField id="request-requester" label="Requester name" className="sm:col-span-2">
                <EditorInput id="request-requester" value={currentUser.name} readOnly />
              </FormField>

              <div className="sm:col-span-2">
                <RequestCompanyField fieldProps={combined ? validation.props("company") : undefined} form={formName} value={originatingCompanyId} onChange={(!connected || selectedScope === 'PEG' || availableCompanies.length > 1) ? next => {
                  setChoices({});
                  if (connected && !combined) selectDraftCompany(next);
                  else setOriginatingCompanyId(next);
                } : undefined} />
                {combined && validation.message("company")}
              </div>
            </div>
          </div>

          {/* Section 2: Priority Selection */}
          <div className="space-y-3">
            <div className="pb-2 border-b border-[#E2E5E9]">
              <h2 id="request-priority" className="text-sm font-semibold text-workspace-ink">
                Priority
              </h2>
            </div>

            <div role="group" tabIndex={-1} aria-labelledby="request-priority" {...validation.props("priority")} className="grid grid-cols-3 gap-2">
              {(['Urgent', 'Medium', 'Low'] as PriorityLevel[]).map((level) => {
                const isSelected = priority === level;
                return (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setPriority(level)}
                    className={`workspace-control ${combined ? 'admin-payment-priority' : 'preci-press'} min-h-10 px-2 text-center text-xs font-semibold rounded-lg ${
                      isSelected
                        ? 'border-teal-700 bg-teal-50/80 text-teal-950 ring-1 ring-teal-700 shadow-xs'
                        : 'border-slate-300 bg-slate-50/60 text-slate-700 hover:bg-white hover:border-slate-400'
                    }`}
                  >
                    {combined && isSelected && <Check aria-hidden="true" className="size-3.5 shrink-0" />}
                    {level}
                  </button>
                );
              })}
            </div>
            {validation.message("priority")}
          </div>

          {/* Section 3: Work Description */}
          <div className="space-y-2">
            <FormField id={validation.props("description").id} label="Work description" required hint={combined ? undefined : "Describe the work you're requesting in detail"}>
              <EditorTextarea
                {...validation.props("description")}
                rows={4}
                value={workDescription}
                onBlur={combined ? () => validation.checkField("description", !!workDescription.trim(), 'Describe the work.') : undefined}
                onChange={(e) => setWorkDescription(e.target.value)}
                placeholder={combined ? "e.g. Replace the damaged workbench in the assembly area." : "Describe the work you’re requesting."}
              />
              {validation.message("description")}
            </FormField>
          </div>

          {combined && <section className="space-y-4 border-t border-slate-200 pt-4 text-sm">
            <FormField id="admin-payment-documents" label="Documents" optional>
              <EditorTextarea id="admin-payment-documents" placeholder="e.g. Supplier quote or reference letter" maxLength={1000} rows={2} value={documentDescription} onChange={event => setDocumentDescription(event.target.value)} />
            </FormField>
            <label className="admin-payment-toggle editor-option flex min-h-11 items-center gap-2.5 rounded-xl border border-slate-300 bg-white p-3 cursor-pointer">
              <input type="checkbox" className="accent-teal-700 size-4 rounded" checked={!!payment} onChange={event => setPayment(event.target.checked ? { amount: '', transferMode: 'Bank', purpose: 'Government Payment' } : undefined)} />
              <span className="font-semibold text-slate-800">Company payment required</span>
            </label>
            {payment && <div data-slot="payment-fields" className="space-y-3 rounded-xl border border-slate-200 p-3 sm:p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField id={validation.props("amount").id} label="Amount (SAR)" required>
                  <EditorInput inputMode="decimal" placeholder="0.00" {...validation.props("amount")} value={payment.amount}
                    onBlur={() => validation.checkField("amount", /^\d{1,9}(\.\d{1,2})?$/.test(payment.amount) && Number(payment.amount) > 0, 'Enter a positive SAR amount.')}
                    onChange={event => setPayment({ ...payment, amount: event.target.value })} />
                  {combined && validation.message("amount")}
                </FormField>
                <FormField id="admin-payment-transfer-mode" label="Mode of transfer" required>
                  <EditorSelect id="admin-payment-transfer-mode" value={payment.transferMode} onChange={event => setPayment({ ...payment, transferMode: event.target.value as typeof payment.transferMode })}>
                    <option>Bank</option><option>Cash</option><option>Cheque</option>
                  </EditorSelect>
                </FormField>
                <FormField id="admin-payment-transfer-details" label="Transfer details" optional className="sm:col-span-2">
                  <EditorInput id="admin-payment-transfer-details" maxLength={200} placeholder="e.g. Bank name, account number, or check details" value={payment.transferDetails ?? ''} onChange={event => setPayment({ ...payment, transferDetails: event.target.value || undefined })} />
                </FormField>
                <FormField id="admin-payment-purpose" label="Purpose" required className={payment.purpose === 'Other' ? '' : 'sm:col-span-2'}>
                  <EditorSelect id="admin-payment-purpose" value={payment.purpose} onChange={event => setPayment({ ...payment, purpose: event.target.value as typeof payment.purpose })}>
                    <option>Government Payment</option><option>Advance Cash</option><option>Other</option>
                  </EditorSelect>
                </FormField>
                {payment.purpose === 'Other' && (
                  <FormField id={validation.props("other").id} label="Other purpose" required>
                    <EditorInput maxLength={500} placeholder="Specify payment purpose" {...validation.props("other")} value={payment.otherPurpose ?? ''}
                      onBlur={() => validation.checkField("other", !!payment.otherPurpose?.trim(), 'Describe the payment purpose.')}
                      onChange={event => setPayment({ ...payment, otherPurpose: event.target.value })} />
                    {combined && validation.message("other")}
                  </FormField>
                )}
              </div>
            </div>}
          </section>}
          {/* Section 4: Required Documents Checklist (9 Items) */}
          {!combined && <div className="space-y-3">
            <div className="pb-2 border-b border-[#E2E5E9] flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#192B3C]">
                4. Required Documents Checklist
              </h2>
              <span className="text-[11px] text-slate-400">Official PR#21-001FA Checklist</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {[
                { key: 'onlineDocumentChamber', en: '1. Online Document Chamber' },
                { key: 'physicalDocumentChamber', en: '2. Physical Document Chamber' },
                { key: 'companyDocumentAjeer', en: '3. Company document Ajeer' },
                { key: 'employeeSalaryCertificate', en: '4. Employee Salary Certificate' },
                { key: 'permanentEmploymentVisa', en: '5. Permanent Employment Visa' },
                { key: 'workVisitVisa', en: '6. Work Visit Visa' },
                { key: 'businessVisitVisa', en: '7. Business Visit Visa' },
                { key: 'agencyWakala', en: '8. Agency Wakala' },
              ].map(({ key, en }) => (
                <label
                  key={key}
                  className="flex items-center justify-between p-2.5 rounded border border-[#E2E5E9] hover:bg-[#F9FAFB] cursor-pointer"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-medium text-slate-800 text-xs truncate">{en}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(documents[key as keyof typeof documents])}
                    onChange={() => handleDocumentToggle(key as keyof typeof documents)}
                    className="rounded text-[#365C78] focus:ring-[#365C78] w-4 h-4 cursor-pointer"
                  />
                </label>
              ))}
            </div>

            {/* Item 9: Others */}
            <div className="p-2.5 rounded border border-[#E2E5E9] space-y-2">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-xs font-medium text-slate-800">9. Others</span>
                <input
                  type="checkbox"
                  checked={documents.others}
                  onChange={() => handleDocumentToggle('others')}
                  className="rounded text-[#365C78] focus:ring-[#365C78] w-4 h-4 cursor-pointer"
                />
              </label>
              {documents.others && (
                <EditorInput
                  type="text"
                  placeholder="Specify other required documentation or letters..."
                  value={documents.othersDescription}
                  onChange={(e) =>
                    setDocuments((prev) => ({ ...prev, othersDescription: e.target.value }))
                  }
                  className="w-full px-2.5 py-1 text-xs border border-[#E2E5E9] rounded focus:outline-none focus:ring-1 focus:ring-[#365C78]"
                />
              )}
            </div>
          </div>

          }
          <SupportingFiles title="Attachments" files={attachments} maxFiles={20} busy={pendingUploads > 0}
            error={attachmentError} onSelect={handleFileUpload} onRemove={index => {
              handleRemoveAttachment(attachments[index].id);
              setAttachmentError('');
            }} />
          {combined && <SignerChoices form="Administrative & Payment Request" workflow={signingWorkflow} companySelected={canStartSelectedCompany} users={users} requester={currentUser} value={choices} onChange={setChoices} />}
          <ProcessorChoicesFields workflow={signingWorkflow} users={users} {...processors} connected={connected} />
        </fieldset>

        {/* Right Column: Live A4 Document Preview */}
        <div
          className="editor-preview space-y-3"
        >
          {/* Document Preview Toolbar */}
          <div className="workspace-panel no-print sticky top-16 z-10 flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#192B3C] flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-[#365C78]" />
                <span>Live A4 Preview</span>
              </span>
              <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                190mm × 277mm
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.max(75, z - 10))}
                className="p-1 rounded text-slate-500 hover:bg-slate-100"
                title="Zoom out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] font-mono text-slate-600 tabular-nums px-1">
                {zoomLevel}%
              </span>
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.min(130, z + 10))}
                className="p-1 rounded text-slate-500 hover:bg-slate-100"
                title="Zoom in"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <span className="text-slate-300">|</span>
              <button
                type="button"
                onClick={handlePrint}
                className="p-1 rounded text-slate-600 hover:bg-slate-100 flex items-center gap-1 text-xs"
                title="Print official document"
              >
                <Printer className="w-3.5 h-3.5" />
                <span className="hidden sm:inline text-[11px]">Print</span>
              </button>
              <button
                type="button"
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="p-1 rounded text-slate-500 hover:bg-slate-100"
                title={isFullscreen ? 'Exit full screen' : 'Expand full screen'}
              >
                {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          {/* Printable / Preview Area with zoom scale */}
          <div
            className={`printable-area overflow-auto rounded-lg bg-slate-200/80 p-2 sm:p-4 border border-[#E2E5E9] flex items-start justify-center ${
              isFullscreen ? 'fixed inset-2 sm:inset-4 z-50 bg-slate-900/80 p-4 sm:p-8' : ''
            }`}
          >
            <div
              style={{
                zoom: zoomLevel / 100,
              }}
              className="w-full flex justify-center"
            >
              {combined ? <AdministrativePaymentDocument data={{ ...previewData, priority }} /> : <AdminWorkRequestDocument data={previewData} isPrintMode={false} />}
            </div>
          </div>
        </div>
      </div>
      {/* Mobile: the submit action stays reachable at the bottom while filling the form. */}
      <div className="no-print route-savebar workspace-panel sticky bottom-3 z-20 flex items-center justify-between gap-2 p-2 md:hidden">
        <ActionButton variant="quiet" size="sm" disabled={submittingNow || draftSaving} onClick={() => setDraftDialog('clear')}>
          Clear Form
        </ActionButton>
        <MorphButton variant="primary" size="md" icon={Send} state={submittingNow ? 'busy' : 'idle'} busyLabel="Submitting…" disabled={pendingUploads > 0} onClick={handleTriggerSubmit}>
          Sign &amp; Submit Request
        </MorphButton>
      </div>

      {/* Signature Confirmation Modal */}
      {(() => {
        const previewSelection = signingWorkflow && applySignerChoices(signingWorkflow, users, currentUser.id, choices);
        const resolvedStagesCount = (previewSelection && !('error' in previewSelection))
          ? previewSelection.workflow.stages.length
          : (signingWorkflow?.stages.length ?? 1);

        return (
          <SignatureModal
            isOpen={signatureModalOpen}
            onClose={() => setSignatureModalOpen(false)}
            user={currentUser}
            title={`Sign & Submit ${formName}`}
            confirmLabel="Apply Signature & Submit"
            noteLabel="Note to signers"
            emailPreviewConfig={combined ? {
              formType: formName,
              companyName: resolvedCompany.fullName,
              fields: [
                { label: 'Date of Request', value: dateOfRequest },
                { label: 'Name of the Requester', value: currentUser.name },
                { label: 'Department', value: department },
                { label: 'Priority', value: priority || 'Medium' },
                { label: 'Documents', value: documentDescription || (documents?.others ? documents.othersDescription || 'Supporting documents' : 'Checklist attached') },
              ],
              workDescription,
              paymentDetails: payment ? {
                amount: payment.amount ? `${payment.amount} SAR` : '—',
                transferMode: payment.transferMode,
                transferDetails: payment.transferDetails,
                purpose: payment.purpose === 'Other' ? (payment.otherPurpose || 'Other') : payment.purpose,
              } : undefined,
              emailNote,
              onEmailNoteChange: setEmailNote,
              stageNumber: 1,
              totalStages: resolvedStagesCount,
            } : undefined}
            onConfirm={handleConfirmedSubmit}
          />
        );
      })()}
    </div>
  );
};
