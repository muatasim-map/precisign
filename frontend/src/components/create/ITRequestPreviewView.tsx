import { EditorInput, EditorTextarea, FormField, ActionButton } from './RequestEditorControls';
import { EditorViewToggle } from './EditorViewToggle';
import { useFieldErrors } from './useFieldErrors';
import { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Printer, AlertCircle, Info, Send, Trash2 } from 'lucide-react';
import { useApp, useUnsavedWork } from '../../context/AppContext';
import type { CompanyId, PriorityLevel } from '../../types';
import { canUserStartForm } from '../../utils/companyAccess';
import { ITRequestDocument, type ITRequestFields } from '../document/ITRequestDocument';
import { SignatureModal } from '../modals/SignatureModal';
import { RequestCompanyField } from './RequestCompanyField';
import { applySignerChoices, type SignerChoices as Choices } from '../../utils/signingSelection';
import { ProcessorChoicesFields, useProcessorSelection } from './ProcessorChoices';
import { SignerChoices } from './SignerChoices';

const priorities = ['Urgent', 'Medium', 'Low'] as const;

function getDraftStorageKey(userId: string, company: string): string {
  return `precisign_draft_${userId}_${company}_IT_Request`;
}

export function ITRequestPreviewView({ onBack }: { onBack: () => void }) {
  const { currentUser, companies, selectedScope, workflows, users, readOnly: connectedMode, submitNewRequest, openReviewRequest, loadITDraft, saveITDraft, clearITDraft } = useApp();
  const [view, setView] = useState<'editor' | 'preview'>('editor');
  const validation = useFieldErrors();
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const availableCompanies = companies.filter(company => canUserStartForm(currentUser, company.id, 'IT Request'));
  const [companyId, setCompanyId] = useState<CompanyId | ''>(() => {
    if (selectedScope && selectedScope !== 'PEG' && availableCompanies.some(company => company.id === selectedScope)) return selectedScope as CompanyId;
    return availableCompanies[0]?.id ?? '';
  });
  const organization = availableCompanies.find(company => company.id === companyId);
  const workflow = workflows.find(route => route.companyId === organization?.id && route.formType === 'IT Request' && route.stages.length > 0);
  const processors = useProcessorSelection(workflow);
  
  const storageKey = organization?.id && currentUser?.id ? getDraftStorageKey(currentUser.id, organization.id) : null;

  const draftRevisionRef = useRef(1);
  const draftSavedAtRef = useRef(0);
  const isSubmittingRef = useRef(false);
  const [draftConflict, setDraftConflict] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const loadedKeyRef = useRef<string | null>(null);

  const [choices, setChoices] = useState<Choices>({});
  const [fields, setFields] = useState<ITRequestFields>(() => ({
    department: currentUser.department,
    requester: currentUser.name,
    date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
    requestType: '',
    priority: '',
    details: '',
    justification: '',
  }));

  // Sync and load draft from server coordinator or local fallback
  useEffect(() => {
    if (!organization?.id || loadedKeyRef.current === storageKey) return;
    let cancelled = false;
    const currentKey = storageKey;
    const comp = organization.id;

    loadITDraft(comp).then(draft => {
      if (cancelled) return;
      if (draft?.fields) {
        setFields({
          department: draft.fields.department || currentUser.department,
          requester: currentUser.name,
          date: draft.fields.date || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
          requestType: draft.fields.requestType || '',
          priority: draft.fields.priority || '',
          details: draft.fields.details || '',
          justification: draft.fields.justification || '',
        });
        setChoices(draft.choices || {});
        setHasDraft(true);
        setDraftConflict(false);
        setStorageError(null);
        loadedKeyRef.current = currentKey;
      } else {
        // Fall back to localStorage if present
        if (currentKey) {
          try {
            const raw = localStorage.getItem(currentKey);
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed?.fields) {
                setFields({
                  department: parsed.fields.department || currentUser.department,
                  requester: currentUser.name,
                  date: parsed.fields.date || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
                  requestType: parsed.fields.requestType || '',
                  priority: parsed.fields.priority || '',
                  details: parsed.fields.details || '',
                  justification: parsed.fields.justification || '',
                });
                setChoices(parsed.choices || {});
                setHasDraft(true);
                setDraftConflict(false);
                setStorageError(null);
                loadedKeyRef.current = currentKey;
                return;
              }
            }
          } catch {}
        }
        setFields({
          department: currentUser.department,
          requester: currentUser.name,
          date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
          requestType: '',
          priority: '',
          details: '',
          justification: '',
        });
        setChoices({});
        setHasDraft(false);
        setDraftConflict(false);
        setStorageError(null);
        loadedKeyRef.current = currentKey;
      }
    }).catch(() => {
      if (!cancelled) {
        setStorageError('Could not load draft from server. Using local copy if available.');
        loadedKeyRef.current = currentKey;
      }
    });

    return () => { cancelled = true; };
  }, [organization?.id, currentUser?.id, loadITDraft, storageKey]);

  // Listen for storage events from other windows
  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === storageKey && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          if (parsed?.savedAt > draftSavedAtRef.current && parsed?.revision > draftRevisionRef.current) {
            setDraftConflict(true);
          }
        } catch {}
      }
    }
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [storageKey]);

  // Auto-save draft on changes to server and local storage
  useEffect(() => {
    if (!storageKey || loadedKeyRef.current !== storageKey || isSubmittingRef.current || !organization?.id) return;
    const isDirty = !!(fields.requestType || fields.priority || fields.details || fields.justification || Object.keys(choices).length > 0);
    if (!isDirty) {
      if (hasDraft) {
        clearITDraft(organization.id).catch(() => {});
        try { localStorage.removeItem(storageKey); } catch {}
        setHasDraft(false);
      }
      return;
    }

    const comp = organization.id;
    const timeout = setTimeout(() => {
      saveITDraft(comp, { fields, choices }).then(() => {
        setHasDraft(true);
        setDraftConflict(false);
        setStorageError(null);
      }).catch((error) => {
        if (error?.status === 409 || error?.message?.includes?.('409') || error?.message?.includes?.('another session')) {
          setDraftConflict(true);
        } else {
          setStorageError('Couldn’t save your draft to the server. Your changes are kept on this device. Retry when you’re back online.');
        }
      });
      try {
        localStorage.setItem(storageKey, JSON.stringify({
          revision: Date.now(),
          savedAt: Date.now(),
          fields,
          choices,
        }));
      } catch {}
    }, 300);

    return () => clearTimeout(timeout);
  }, [fields, choices, storageKey, organization?.id, saveITDraft, clearITDraft, hasDraft]);

  function clearDraft() {
    if (organization?.id) {
      clearITDraft(organization.id).catch(() => {});
    }
    if (storageKey) {
      try { localStorage.removeItem(storageKey); } catch {}
    }
    setFields({
      department: currentUser.department,
      requester: currentUser.name,
      date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
      requestType: '',
      priority: '',
      details: '',
      justification: '',
    });
    setChoices({});
    setHasDraft(false);
    setDraftConflict(false);
    setStorageError(null);
    draftRevisionRef.current = 1;
    draftSavedAtRef.current = 0;
  }

  useUnsavedWork(JSON.stringify({ fields, choices, companyId }));

  function update<K extends keyof ITRequestFields>(field: K, value: ITRequestFields[K]) {
    setFields(previous => ({ ...previous, [field]: value }));
  }

  function reviewAndSign() {
    setView('editor');
    setError('');
    if (!validation.validate([
      ['company', !!organization, 'Select a legal company.'],
      ...(['department', 'date', 'requestType', 'priority', 'details', 'justification'] as const).map(key => [key, !!fields[key].trim(), 'Complete this field.'] as [string, boolean, string]),
    ])) {
      setError('Please complete all required fields highlighted below before submitting.');
      return;
    }
    const selection = workflow && applySignerChoices(workflow, users, currentUser.id, choices);
    if (!organization || !selection || selection.error) {
      setError(selection?.error || (!organization ? 'Select a legal company.' : 'Complete signer selection.'));
      requestAnimationFrame(() => document.getElementById('signer-review')?.focus());
    } else {
      setError('');
      setSigning(true);
    }
  }

  async function submit(signature: string, note?: string) {
    if (!organization || !fields.priority) return { success: false, error: 'Review the organization and priority before sending.' };
    isSubmittingRef.current = true;
    const result = await submitNewRequest({
      companyId: organization.id,
      companyName: organization.fullName,
      requesterId: currentUser.id,
      requesterName: currentUser.name,
      dateOfRequest: fields.date,
      department: fields.department,
      priority: fields.priority,
      workDescription: fields.details,
      documents: {
        onlineDocumentChamber: false, physicalDocumentChamber: false, companyDocumentAjeer: false,
        employeeSalaryCertificate: false, permanentEmploymentVisa: false, workVisitVisa: false,
        businessVisitVisa: false, agencyWakala: false, others: false, othersDescription: '',
      },
      itRequest: { requestType: fields.requestType, justification: fields.justification },
    }, [], note, signature, choices, undefined, processors.choices);
    if (result.success) {
      if (storageKey) {
        try { localStorage.removeItem(storageKey); } catch {}
      }
      setFields({
        department: currentUser.department,
        requester: currentUser.name,
        date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
        requestType: '',
        priority: '',
        details: '',
        justification: '',
      });
      setChoices({});
      setHasDraft(false);
      setDraftConflict(false);
      setStorageError(null);
      draftRevisionRef.current = 1;
      draftSavedAtRef.current = 0;
      if (result.newId) openReviewRequest(result.newId);
    } else {
      isSubmittingRef.current = false;
    }
    if (result.routeChanged) { setSigning(false); setChoices({}); setError(result.error ?? 'Review the updated route.'); }
    return result;
  }

  return (
    <div data-editor-view={view} className="request-editor it-request-preview mx-auto max-w-[1450px] space-y-5 p-4 md:p-6">
      <header className="no-print space-y-3">
        <ActionButton variant="quiet" size="sm" icon={ArrowLeft} onClick={onBack}>
          Back to forms
        </ActionButton>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-workspace-ink">IT Request Form</h1>
            </div>
            <p className="mt-1 text-sm text-slate-600">Fill in the form and review your approver before sending. Entries stay here until you leave.</p>
          </div>
          <ActionButton variant="secondary" size="md" icon={Printer} onClick={() => window.print()}>
            Print / Save as PDF
          </ActionButton>
        </div>
      </header>

      <EditorViewToggle value={view} onChange={setView} />
      <div className="editor-columns it-request-layout">
        <section aria-label="Request fields" className="editor-fields request-field-polish no-print workspace-panel space-y-5 p-4 sm:p-5">
          {error && (
            <div role="alert" className="rounded-lg bg-rose-50 border border-rose-200 p-3.5 text-sm text-rose-900 flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}
          {storageError && (
            <div role="alert" className="rounded-lg bg-amber-50 border border-amber-200 p-3.5 text-sm text-amber-900 flex items-center gap-2.5">
              <Info className="w-4 h-4 shrink-0 text-amber-600" />
              <span>{storageError}</span>
            </div>
          )}
          {draftConflict && (
            <div role="alert" className="rounded-lg bg-amber-50 border border-amber-200 p-3.5 text-sm text-amber-900 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Info className="w-4 h-4 shrink-0 text-amber-600" />
                <span>A newer draft was saved in another window.</span>
              </div>
              <div className="flex gap-2">
                <ActionButton
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    if (!storageKey) return;
                    try {
                      const raw = localStorage.getItem(storageKey);
                      if (raw) {
                        const p = JSON.parse(raw);
                        if (p?.fields) setFields(p.fields);
                        if (p?.choices) setChoices(p.choices);
                        draftRevisionRef.current = p.revision || 1;
                        draftSavedAtRef.current = p.savedAt || Date.now();
                      }
                    } catch {}
                    setDraftConflict(false);
                  }}
                >
                  Load newer draft
                </ActionButton>
                <ActionButton
                  variant="quiet"
                  size="sm"
                  onClick={() => {
                    setDraftConflict(false);
                    draftSavedAtRef.current = Date.now();
                    draftRevisionRef.current = draftRevisionRef.current + 1;
                  }}
                >
                  Keep my edits
                </ActionButton>
              </div>
            </div>
          )}
          {validation.summary()}
          <div className="space-y-4">
            <h2 className="text-base font-bold text-workspace-ink">Requester information</h2>
            <div>
              <RequestCompanyField
                fieldProps={validation.props("company")}
                form="IT Request"
                value={organization?.id ?? ''}
                onChange={availableCompanies.length > 1 ? next => {
                  setCompanyId(next);
                  setChoices({});
                  setError('');
                } : undefined}
              />
              {validation.message("company")}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField id="it-requester-name" label="Name of the requester">
                <EditorInput id="it-requester-name" value={fields.requester} readOnly />
              </FormField>
              <FormField label="Department" required>
                <EditorInput {...validation.props("department")} value={fields.department} onChange={event => update('department', event.target.value)} />
                {validation.message("department")}
              </FormField>
              <FormField label="Date of request" required className="sm:col-span-2">
                <EditorInput type="date" {...validation.props("date")} value={fields.date} onChange={event => update('date', event.target.value)} />
                {validation.message("date")}
              </FormField>
            </div>
          </div>
          <div className="space-y-4 border-t border-slate-200 pt-4">
            <h2 className="text-base font-bold text-workspace-ink">Request information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label="Type of request" required hint="Specific category or service needed">
                <EditorInput maxLength={150} placeholder="e.g. Network access, hardware setup" {...validation.props("requestType")} value={fields.requestType} onChange={event => update('requestType', event.target.value)} />
                {validation.message("requestType")}
              </FormField>
              <fieldset {...validation.props("priority")} tabIndex={-1} className="space-y-1.5">
                <legend className="block text-sm font-semibold text-slate-800">
                  Priority <span className="ml-1 text-rose-600 font-bold" aria-hidden="true">*</span>
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {priorities.map(priority => (
                    <label
                      key={priority}
                      className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border text-xs font-semibold ${
                        fields.priority === priority
                          ? 'border-teal-700 bg-teal-50/80 text-teal-950 ring-1 ring-teal-700 shadow-xs'
                          : 'border-slate-300 bg-slate-50/60 text-slate-700 hover:bg-white hover:border-slate-400'
                      }`}
                    >
                      <input
                        type="radio"
                        name="it-priority"
                        value={priority}
                        checked={fields.priority === priority}
                        onChange={event => update('priority', event.target.value as PriorityLevel)}
                        className="accent-teal-700"
                      />
                      {priority}
                    </label>
                  ))}
                </div>
                {validation.message("priority")}
              </fieldset>
              <FormField label="Request in detail" required className="sm:col-span-2" hint="Describe the exact requirements, equipment, or access needed">
                <EditorTextarea rows={4} maxLength={20000} placeholder="Describe what you need from IT in detail." {...validation.props("details")} value={fields.details} onChange={event => update('details', event.target.value)} />
                {validation.message("details")}
              </FormField>
              <FormField label="Business justification" required className="sm:col-span-2" hint="Explain the business operations or project this request supports">
                <EditorTextarea rows={3} maxLength={10000} placeholder="Explain what work this request will support." {...validation.props("justification")} value={fields.justification} onChange={event => update('justification', event.target.value)} />
                {validation.message("justification")}
              </FormField>
            </div>
          </div>
          <div className="space-y-3 border-t border-slate-200 pt-4 text-sm">
            <SignerChoices form="IT Request" workflow={workflow} companySelected={!!organization} users={users} requester={currentUser} value={choices} onChange={setChoices} />
            <ProcessorChoicesFields workflow={workflow} users={users} {...processors} connected={connectedMode} />
            {error && <p role="alert" className="text-rose-700">{error}</p>}
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-200">
              <ActionButton variant="primary" size="md" icon={Send} onClick={reviewAndSign}>
                Sign &amp; send
              </ActionButton>
              {hasDraft && (
                <ActionButton variant="quiet" size="sm" icon={Trash2} onClick={clearDraft} className="text-slate-500 hover:text-rose-700">
                  Clear draft
                </ActionButton>
              )}
            </div>
          </div>
        </section>
        <section aria-labelledby="it-live-preview-heading" className="editor-preview it-request-preview-panel min-w-0 rounded-lg border border-slate-200 bg-[#E8EDF1]">
          <div className="no-print flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
            <h2 id="it-live-preview-heading" className="flex items-center gap-2 text-sm font-bold">
              <span aria-hidden="true" className="size-2 rounded-full bg-teal-600" /> Live document preview
            </h2>
            <span className="text-xs font-medium text-slate-600">A4 portrait</span>
          </div>
          <div className="it-request-paper-wrap p-2 sm:p-5">
            <ITRequestDocument fields={fields} organization={organization?.fullName ?? ''} logoUrl={organization?.logoDataUrl} />
          </div>
        </section>
      </div>
      {signing && <SignatureModal isOpen onClose={() => setSigning(false)} user={currentUser} title="Sign IT Request" confirmLabel="Sign & send" noteLabel="Note to signers" onConfirm={submit} />}
    </div>
  );
}
