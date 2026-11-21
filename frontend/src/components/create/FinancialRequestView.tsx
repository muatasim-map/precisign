import { checkSupportingFiles, SupportingFiles } from './SupportingFiles';
import { EditorInput, EditorTextarea, EditorSelect, FormField, ActionButton } from './RequestEditorControls';
import { EditorViewToggle } from './EditorViewToggle';
import { useFieldErrors } from './useFieldErrors';
import { useState } from 'react';
import { AlertCircle, ArrowLeft, Printer, Plus, Trash2, Send } from 'lucide-react';
import { useApp, useUnsavedWork } from '../../context/AppContext';
import type { AdminWorkFormData, AttachmentItem, CompanyId } from '../../types';
import { canUserAccessCompany, canUserStartForm } from '../../utils/companyAccess';
import { applySignerChoices, type SignerChoices as Choices } from '../../utils/signingSelection';
import { ProcessorChoicesFields, useProcessorSelection } from './ProcessorChoices';
import { SignerChoices } from './SignerChoices';
import { FinancialRequestDocument } from '../document/FinancialRequestDocument';
import { SignatureModal } from '../modals/SignatureModal';
import { RequestCompanyField } from './RequestCompanyField';
import { expenseEvidenceError } from '../../utils/expenseEvidence';

type FinancialForm = 'Cash Voucher' | 'Expense Claim';
const control = 'workspace-control mt-1 block min-h-10 w-full px-3 py-2';
const blankDocuments = {
  onlineDocumentChamber: false, physicalDocumentChamber: false, companyDocumentAjeer: false,
  employeeSalaryCertificate: false, permanentEmploymentVisa: false, workVisitVisa: false,
  businessVisitVisa: false, agencyWakala: false, others: false, othersDescription: '',
};

export function FinancialRequestView({ form, onBack }: { form: FinancialForm; onBack: () => void }) {
  const { currentUser, selectedScope, companies, workflows, users, readOnly: connectedMode, submitNewRequest, openReviewRequest } = useApp();
  const [view, setView] = useState<'editor' | 'preview'>('editor');
  const validation = useFieldErrors();
  const eligibleCompanies = companies.filter(company => canUserStartForm(currentUser, company.id, form));
  const [companyId, setCompanyId] = useState<CompanyId | ''>(() => {
    if (selectedScope && selectedScope !== 'PEG' && eligibleCompanies.some(company => company.id === selectedScope)) return selectedScope as CompanyId;
    return eligibleCompanies[0]?.id ?? '';
  });
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const [voucher, setVoucher] = useState<NonNullable<AdminWorkFormData['cashVoucher']>>({ payee: '', amount: '', amountInWords: '', source: 'Admin petty cash' });
  const [claim, setClaim] = useState<NonNullable<AdminWorkFormData['expenseClaim']>>({ designation: '', project: '', lines: [{ date, particulars: '', amount: '' }] });
  const [purpose, setPurpose] = useState('');
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [reading, setReading] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const isVoucher = form === 'Cash Voucher';
  const company = eligibleCompanies.find(item => item.id === companyId);
  const eligibleRecipients = company ? users.filter(user => canUserAccessCompany(user, company.id)) : [];
  const route = workflows.find(item => item.companyId === company?.id && item.formType === form && item.stages.length > 0);
  const processors = useProcessorSelection(route);
  const [choices, setChoices] = useState<Choices>({});
  useUnsavedWork(JSON.stringify({ companyId, date, voucher, claim, purpose, choices, reading, attachments: attachments.map(file => file.id) }));
  const data: AdminWorkFormData = {
    companyId: company?.id ?? currentUser.companyId, companyName: company?.fullName ?? '', companyLogoDataUrl: company?.logoDataUrl,
    dateOfRequest: date, requesterName: currentUser.name, requesterId: currentUser.id,
    department: currentUser.department || 'Administration', priority: 'Medium', documents: blankDocuments,
    workDescription: isVoucher ? purpose : claim.lines[0]?.particulars ?? '',
    cashVoucher: isVoucher ? voucher : undefined, expenseClaim: isVoucher ? undefined : claim,
  };

  function review() {
    const validAmount = (amount: string) => /^\d{1,9}(\.\d{1,2})?$/.test(amount) && Number(amount) > 0;
    const evidenceError = isVoucher ? undefined : expenseEvidenceError(claim, attachments);
    const valid = isVoucher
      ? eligibleRecipients.some(user => user.id === voucher.recipientUserId) && voucher.amountInWords.trim() && purpose.trim() && validAmount(voucher.amount)
      : claim.designation.trim() && claim.project.trim() && claim.lines.every(line => line.date && line.particulars.trim() && validAmount(line.amount));
    setView('editor');
    const rules: [string, boolean, string][] = [
      ['company', !!company, 'Select a legal company.'], ['date', !!date, 'Choose a date.'],
      ...(isVoucher ? [
        ['payee', eligibleRecipients.some(user => user.id === voucher.recipientUserId), 'Choose the person receiving cash.'],
        ['amount', validAmount(voucher.amount), 'Enter a positive amount with up to two decimal places.'],
        ['words', !!voucher.amountInWords.trim(), 'Enter the amount in words.'],
        ['purpose', !!purpose.trim(), 'Describe the purpose.'],
      ] as [string, boolean, string][] : [
        ['designation', !!claim.designation.trim(), 'Enter your designation.'],
        ['project', !!claim.project.trim(), 'Enter the project.'],
        ...claim.lines.flatMap((line, index): [string, boolean, string][] => [
          ['date-' + index, !!line.date, 'Choose an expense date.'],
          ['particulars-' + index, !!line.particulars.trim(), 'Describe the expense.'],
          ['amount-' + index, validAmount(line.amount), 'Enter a positive amount.'],
          ['receipt-' + index, line.receiptIndex !== undefined || !!line.noBillReason?.trim(), 'Select a receipt or enter a no-bill reason.'],
        ]),
      ] as [string, boolean, string][]),
    ];
    if (!validation.validate(rules)) {
      setError('Please complete all required fields highlighted below before submitting.');
      return;
    }
    const selection = route && applySignerChoices(route, users, currentUser.id, choices);
    if (!company || !selection || selection.error) {
      setError(selection?.error || (!company ? 'Select a legal company.' : 'Complete signer selection.'));
      requestAnimationFrame(() => document.getElementById('signer-review')?.focus());
    } else if (!date || !valid) {
      setError('Complete the form and enter positive amounts with up to two decimal places.');
    } else if (evidenceError) {
      setError(evidenceError);
    } else {
      setError('');
      setSigning(true);
    }
  }

  function removeReceipt(index: number) {
    setAttachments(previous => previous.filter((_, position) => position !== index));
    setClaim(previous => ({
      ...previous,
      lines: previous.lines.map(line => {
        if (line.receiptIndex === undefined || line.receiptIndex < index) return line;
        return { ...line, receiptIndex: line.receiptIndex === index ? undefined : line.receiptIndex - 1 };
      }),
    }));
  }

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files);
    const issue = checkSupportingFiles(selected, attachments, 10);
    setAttachmentError(issue ?? '');
    if (issue) return;
    setReading(true);
    try {
      const added = await Promise.all(selected.map(file => new Promise<AttachmentItem>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => resolve({
          id: crypto.randomUUID(), name: file.name, sizeBytes: file.size, sizeFormatted: `${Math.ceil(file.size / 1024)} KB`,
          uploadedAt: new Date().toISOString(), uploadedBy: currentUser.name, mimeType: file.type, dataUrl: String(reader.result),
        });
        reader.readAsDataURL(file);
      })));
      setAttachments([...attachments, ...added]);
      setError('');
    } catch {
      setAttachmentError('One of the receipts could not be opened.');
    } finally {
      setReading(false);
    }
  }

  return (
    <div data-editor-view={view} className="request-editor mx-auto max-w-7xl space-y-4 p-5">
      <header className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <ActionButton variant="quiet" size="sm" icon={ArrowLeft} onClick={onBack}>
            Back to forms
          </ActionButton>
          <h1 className="text-2xl font-semibold tracking-tight text-workspace-ink mt-1">{form}</h1>
        </div>
        <ActionButton variant="secondary" size="md" icon={Printer} onClick={() => window.print()}>
          Print / Save as PDF
        </ActionButton>
      </header>
      <EditorViewToggle value={view} onChange={setView} />
      <div className="editor-columns it-request-layout">
        <section className="editor-fields request-field-polish no-print workspace-panel space-y-5 p-4 text-sm sm:p-5">
          {error && (
            <div role="alert" className="rounded-lg bg-rose-50 border border-rose-200 p-3.5 text-sm text-rose-900 flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}
          {validation.summary()}
          <div>
            <RequestCompanyField
              fieldProps={validation.props("company")}
              form={form}
              value={companyId}
              onChange={eligibleCompanies.length > 1 ? next => {
                setCompanyId(next);
                setChoices({});
                setVoucher(previous => ({ ...previous, payee: '', recipientUserId: undefined }));
                setError('');
              } : undefined}
            />
            {validation.message("company")}
          </div>

          {isVoucher ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Date" required>
                  <EditorInput type="date" {...validation.props("date")} value={date} onChange={event => setDate(event.target.value)} />
                  {validation.message("date")}
                </FormField>
                <FormField label="Cash source" required>
                  <EditorSelect value={voucher.source} onChange={e => setVoucher({ ...voucher, source: e.target.value as typeof voucher.source })}>
                    <option>Admin petty cash</option>
                    <option>Accounts cash</option>
                  </EditorSelect>
                </FormField>
                <FormField label="Payee" required hint="Person receiving cash disbursement">
                  <EditorSelect {...validation.props("payee")} value={voucher.recipientUserId ?? ''} onChange={event => {
                    const recipient = eligibleRecipients.find(user => user.id === event.target.value);
                    setVoucher({ ...voucher, payee: recipient?.name ?? '', recipientUserId: recipient?.id });
                  }}>
                    <option value="">Select the person receiving the cash</option>
                    {eligibleRecipients.map(user => <option value={user.id} key={user.id}>{user.name}</option>)}
                  </EditorSelect>
                  {validation.message("payee")}
                </FormField>
                <FormField label="Amount (SAR)" required>
                  <EditorInput inputMode="decimal" placeholder="0.00" {...validation.props("amount")} value={voucher.amount} onChange={e => setVoucher({ ...voucher, amount: e.target.value })} />
                  {validation.message("amount")}
                </FormField>
                <FormField label="Amount in words" required className="sm:col-span-2" hint="Written currency in words">
                  <EditorInput maxLength={250} placeholder="e.g. One thousand five hundred Saudi Riyals only" {...validation.props("words")} value={voucher.amountInWords} onChange={e => setVoucher({ ...voucher, amountInWords: e.target.value })} />
                  {validation.message("words")}
                </FormField>
                <FormField label="Purpose" required className="sm:col-span-2" hint="Detailed justification for cash disbursement">
                  <EditorTextarea rows={3} maxLength={20000} placeholder="Describe the purpose of this cash voucher in detail." {...validation.props("purpose")} value={purpose} onChange={e => setPurpose(e.target.value)} />
                  {validation.message("purpose")}
                </FormField>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField label="Submission date" required>
                  <EditorInput type="date" {...validation.props("date")} value={date} onChange={event => setDate(event.target.value)} />
                  {validation.message("date")}
                </FormField>
                <FormField label="Designation" required hint="Your official job title">
                  <EditorInput maxLength={150} placeholder="e.g. Senior Project Engineer" {...validation.props("designation")} value={claim.designation} onChange={e => setClaim({ ...claim, designation: e.target.value })} />
                  {validation.message("designation")}
                </FormField>
                <FormField label="Project" required className="sm:col-span-2" hint="Project or cost center reference">
                  <EditorInput maxLength={200} placeholder="e.g. Facility Expansion / Client Visit" {...validation.props("project")} value={claim.project} onChange={e => setClaim({ ...claim, project: e.target.value })} />
                  {validation.message("project")}
                </FormField>
              </div>

              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-workspace-ink">Expense line items</h3>
                  <span className="text-xs text-slate-500">{claim.lines.length} of 20 items</span>
                </div>
                {claim.lines.map((line, index) => {
                  const update = (changes: Partial<typeof line>) => setClaim({ ...claim, lines: claim.lines.map((item, i) => i === index ? { ...item, ...changes } : item) });
                  return (
                    <fieldset key={index} className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                      <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                        <legend className="text-xs font-bold uppercase tracking-wider text-slate-700">Expense item #{index + 1}</legend>
                        {claim.lines.length > 1 && (
                          <ActionButton variant="quiet" size="sm" icon={Trash2} className="text-rose-700 hover:bg-rose-50" onClick={() => setClaim({ ...claim, lines: claim.lines.filter((_, i) => i !== index) })}>
                            Remove
                          </ActionButton>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <FormField label="Expense date" required>
                          <EditorInput type="date" {...validation.props("date-" + index)} value={line.date} onChange={e => update({ date: e.target.value })} />
                          {validation.message("date-" + index)}
                        </FormField>
                        <FormField label="Amount (SAR)" required>
                          <EditorInput inputMode="decimal" placeholder="0.00" {...validation.props("amount-" + index)} value={line.amount} onChange={e => update({ amount: e.target.value })} />
                          {validation.message("amount-" + index)}
                        </FormField>
                        <FormField label="Particulars" required className="sm:col-span-2">
                          <EditorInput maxLength={1000} placeholder="Describe the incurred expense" {...validation.props("particulars-" + index)} value={line.particulars} onChange={e => update({ particulars: e.target.value })} />
                          {validation.message("particulars-" + index)}
                        </FormField>
                        <FormField label="Receipt" required className="sm:col-span-2">
                          <EditorSelect {...validation.props("receipt-" + index)} value={line.receiptIndex ?? ''} onChange={event => {
                            const value = event.target.value;
                            update(value === '' ? { receiptIndex: undefined } : { receiptIndex: Number(value), noBillReason: undefined });
                          }}>
                            <option value="">Select an uploaded receipt</option>
                            {attachments.map((file, receiptIndex) => <option key={file.id} value={receiptIndex}>{receiptIndex + 1}. {file.name}</option>)}
                          </EditorSelect>
                          {validation.message("receipt-" + index)}
                        </FormField>
                        {line.receiptIndex === undefined && (
                          <FormField label="No bill reason" hint="Explain why no tax invoice/receipt is available" className="sm:col-span-2">
                            <EditorInput maxLength={500} placeholder="e.g. Incidental taxi receipt not provided" value={line.noBillReason ?? ''} onChange={e => update({ noBillReason: e.target.value || undefined })} />
                          </FormField>
                        )}
                      </div>
                    </fieldset>
                  );
                })}
                <ActionButton variant="secondary" size="sm" icon={Plus} disabled={claim.lines.length >= 20} onClick={() => setClaim({ ...claim, lines: [...claim.lines, { date, particulars: '', amount: '' }] })}>
                  Add expense item
                </ActionButton>
                <SupportingFiles title="Receipts" files={attachments} maxFiles={10} busy={reading} error={attachmentError}
                  onSelect={files => { void addFiles(files); }} onRemove={index => { removeReceipt(index); setAttachmentError(''); }} numbered />
              </div>
            </div>
          )}

          <div className="space-y-3 border-t border-slate-200 pt-4">
            <SignerChoices
              form={form}
              workflow={route}
              companySelected={!!company}
              users={users}
              requester={currentUser}
              value={choices}
              onChange={setChoices}
              recipientUserId={isVoucher ? voucher.recipientUserId : undefined}
              cashSource={isVoucher ? voucher.source : undefined}
            />
            <ProcessorChoicesFields workflow={route} users={users} {...processors} connected={connectedMode} />
            {error && <p role="alert" className="text-rose-700">{error}</p>}
            <ActionButton variant="primary" size="md" icon={Send} busy={reading} busyText="Reading receipts..." onClick={review}>
              Sign &amp; send
            </ActionButton>
          </div>
        </section>
        <div className="editor-preview printable-area min-w-0">
          <h2 className="workspace-panel no-print mb-2 px-3 py-2 text-sm font-bold">Live document preview</h2>
          <FinancialRequestDocument data={data} attachments={attachments} />
        </div>
      </div>
      {signing && <SignatureModal isOpen onClose={() => setSigning(false)} title={`Sign ${form}`} user={currentUser} confirmLabel="Sign & send" noteLabel="Note to signers" onConfirm={async (signature, note) => {
        const result = await submitNewRequest(data, attachments, note, signature, choices, undefined, processors.choices);
        if (result.success && result.newId) openReviewRequest(result.newId);
        if (result.routeChanged) { setSigning(false); setChoices({}); setError(result.error ?? 'Review the updated route.'); }
        return result;
      }} />}
    </div>
  );
}
