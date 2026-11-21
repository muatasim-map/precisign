import { useSlidingPill } from '../common/useSlidingPill';
import { MorphButton } from '../common/MorphButton';
import { WorkspaceDialog } from '../common/WorkspaceDialog';
import React, { useRef, useState, useEffect } from 'react';
import { UserProfile } from '../../types/index';
import { X, PenTool, Type, Upload, Check, Shield } from 'lucide-react';
import { ActionButton, EditorInput, EditorTextarea } from '../create/RequestEditorControls';

export interface EmailPreviewConfig {
  formType: string;
  companyName: string;
  fields: { label: string; value: string }[];
  workDescription?: string;
  paymentDetails?: { amount: string; transferMode: string; purpose: string; transferDetails?: string };
  emailNote: string;
  onEmailNoteChange: (val: string) => void;
  stageNumber?: number;
  totalStages?: number;
}

interface SignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile;
  title?: string;
  confirmLabel?: string;
  noteLabel?: string;
  reviewContext?: { version: number; responsibility: string };
  onSignatureProfile?: () => void;
  emailPreviewConfig?: EmailPreviewConfig;
  onConfirm: (signatureDataUrl: string, note?: string, emailNote?: string) => Promise<{ success: boolean; error?: string } | undefined>;
}

export const SignatureModal: React.FC<SignatureModalProps> = ({
  isOpen,
  onClose,
  user,
  title = 'Confirm Digital E-Signature',
  confirmLabel = 'Confirm & Apply Signature',
  noteLabel,
  reviewContext,
  onSignatureProfile,
  emailPreviewConfig,
  onConfirm,
}) => {
  const [tab, setTab] = useState<'style' | 'draw' | 'upload' | 'saved'>('style');
  const [styledName, setStyledName] = useState(user.name);
  const tabPill = useSlidingPill<HTMLFieldSetElement>({ underline: true });
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const savingRef = useRef(false);
  const [drawnDataUrl, setDrawnDataUrl] = useState<string | null>(null);
  const [uploadedDataUrl, setUploadedDataUrl] = useState<string | null>(null);
  const [signatureError, setSignatureError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingPointer = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setStyledName(user.name);
      setSignatureError(null);
      if (reviewContext) setTab(onSignatureProfile || user.signatureDataUrl ? 'saved' : 'style');
    }
  }, [isOpen, user, reviewContext?.version, Boolean(onSignatureProfile)]);

  if (!isOpen) return null;

  // Unified Pointer events for mouse, pen, and touch/finger drawing
  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !e.isPrimary || e.button !== 0 || drawingPointer.current !== null) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    drawingPointer.current = e.pointerId;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(
      (e.clientX - rect.left) * canvas.width / rect.width,
      (e.clientY - rect.top) * canvas.height / rect.height
    );
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1e3a8a';
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingPointer.current !== e.pointerId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(
      (e.clientX - rect.left) * canvas.width / rect.width,
      (e.clientY - rect.top) * canvas.height / rect.height
    );
    ctx.stroke();
    setDrawnDataUrl(canvas.toDataURL('image/png'));
  };

  const stopDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingPointer.current === e.pointerId) {
      const canvas = canvasRef.current;
      if (canvas && canvas.hasPointerCapture(e.pointerId)) {
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {}
      }
      drawingPointer.current = null;
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setDrawnDataUrl(null);
    drawingPointer.current = null;
  };

  // Convert styled text to data URL via offscreen canvas
  const generateStyleDataUrl = (text: string): string => {
    const offCanvas = document.createElement('canvas');
    offCanvas.width = 400;
    offCanvas.height = 120;
    const ctx = offCanvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, offCanvas.width, offCanvas.height);
      ctx.font = "italic 44px 'Caveat', cursive, sans-serif";
      ctx.fillStyle = '#1e3a8a';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 24, 60);
    }
    return offCanvas.toDataURL('image/png');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024 || !['image/png', 'image/jpeg'].includes(file.type)) {
      setSignatureError('Choose a PNG or JPEG signature up to 2 MiB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedDataUrl(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveAndConfirm = async () => {
    if (savingRef.current) return;
    if ((tab === 'saved' && !user.signatureDataUrl) || (tab === 'style' && !styledName.trim()) || (tab === 'draw' && !drawnDataUrl) || (tab === 'upload' && !uploadedDataUrl)) {
      setSignatureError('Please provide a signature using the selected method.');
      return;
    }
    setSignatureError(null);
    let finalDataUrl = '';
    if (tab === 'saved' && user.signatureDataUrl) {
      finalDataUrl = user.signatureDataUrl;
    } else if (tab === 'draw' && drawnDataUrl) {
      finalDataUrl = drawnDataUrl;
    } else if (tab === 'upload' && uploadedDataUrl) {
      finalDataUrl = uploadedDataUrl;
    } else {
      finalDataUrl = generateStyleDataUrl(styledName);
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await onConfirm(
        finalDataUrl,
        noteLabel ? note.trim() || undefined : undefined,
        emailPreviewConfig ? emailPreviewConfig.emailNote.trim() || undefined : undefined
      );
      if (result?.success) onClose();
      else setSignatureError(result?.error || 'The save was not confirmed. Your signature and entries are preserved.');
    } catch {
      setSignatureError('The save was not confirmed. Your signature and entries are preserved. Check the connection before trying again.');
    } finally { savingRef.current = false; setSaving(false); }
  };

  return (
    <WorkspaceDialog titleId="signature-dialog-title" onClose={onClose} busy={saving} className="max-w-lg overscroll-contain">
      <div className="w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-[#E2E5E9] bg-[#F5F6F8]">
          <div className="min-w-0 pr-2">
            <h2 id="signature-dialog-title" className="text-sm font-bold text-workspace-ink">{title}</h2>
            <p className="text-[11px] sm:text-xs text-slate-500 truncate">
              Signing as <span className="font-semibold text-slate-800">{user.name}</span>
            </p>
          </div>
          <button
            type="button"
            aria-label="Close signature dialog"
            data-dialog-focus
            disabled={saving}
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {reviewContext && <div className="px-4 py-3 sm:px-6 text-xs border-b border-workspace-line"><p className="font-semibold">{user.name} · {reviewContext.responsibility}</p><p className="mt-1 text-workspace-muted">Document version {reviewContext.version}. Your signature is recorded only after the save succeeds.</p></div>}
        {/* Tab selection */}
        {!onSignatureProfile && <fieldset ref={tabPill.group} disabled={saving} className="seg-group flex border-b border-[#E2E5E9] px-4 sm:px-6 pt-2.5 sm:pt-3 bg-white overflow-x-auto">
          <span aria-hidden="true" ref={tabPill.pill} className="seg-pill seg-pill-underline" />
          {reviewContext && user.signatureDataUrl && <button type="button" aria-pressed={tab === 'saved'} onClick={() => setTab('saved')} className={`min-h-10 border-b-2 px-3 text-xs font-semibold ${tab === 'saved' ? 'border-transparent text-workspace-teal' : 'border-transparent text-workspace-muted'}`}>Saved signature</button>}
          <button
            type="button"
            aria-pressed={tab === 'style'}
            onClick={() => setTab('style')}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap shrink-0 ${
              tab === 'style'
                ? 'border-transparent text-[#192B3C]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Type className="w-3.5 h-3.5" />
            <span>Type</span>
          </button>
          <button
            type="button"
            aria-pressed={tab === 'draw'}
            onClick={() => setTab('draw')}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors ${
              tab === 'draw'
                ? 'border-transparent text-[#192B3C]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>Draw</span>
          </button>
          <button
            type="button"
            aria-pressed={tab === 'upload'}
            onClick={() => setTab('upload')}
            className={`flex items-center gap-2 pb-2.5 px-3 text-xs font-semibold border-b-2 transition-colors ${
              tab === 'upload'
                ? 'border-transparent text-[#192B3C]'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload</span>
          </button>
        </fieldset>}

        {/* Content */}
        <fieldset disabled={saving} className="p-6 space-y-4">
          {signatureError && <p role="alert" className="text-xs text-rose-700">{signatureError}</p>}
          {onSignatureProfile && !user.signatureDataUrl && <p className="text-sm text-workspace-muted">Save a signature in your profile before signing this request.</p>}
          {emailPreviewConfig && (
            <div className="rounded-lg border border-teal-200 bg-teal-50/30 p-3.5 space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-teal-200/80 pb-2">
                <div>
                  <span className="font-bold text-teal-950 block text-xs">Notification Email Preview</span>
                  <span className="text-[10px] text-teal-700">What signers will see in their inbox</span>
                </div>
                <span className="px-2 py-0.5 rounded bg-teal-100 text-teal-800 text-[10px] font-bold tracking-wider">ACTION REQUIRED</span>
              </div>

              {/* Email Body Simulation — Approved Variant 3 Layout */}
              <div className="rounded-lg border border-slate-200 bg-white overflow-hidden shadow-sm text-[11px]">
                {/* Corporate Navy Header Banner */}
                <div className="bg-[#0A1E35] px-3 py-2.5 border-b-2 border-[#0D9488] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 bg-white rounded flex items-center justify-center shadow-xs">
                      <img src="/assets/precisign-p-logo.png" alt="P" className="h-4 w-auto object-contain" />
                    </div>
                    <span className="text-white font-bold text-xs tracking-tight">PreciSign</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full bg-teal-900/60 border border-teal-500/50 text-[#5EEAD4] text-[9px] font-bold tracking-wider">
                    {emailPreviewConfig.totalStages && emailPreviewConfig.totalStages > 0
                      ? `STAGE ${emailPreviewConfig.stageNumber ?? 1} OF ${emailPreviewConfig.totalStages}`
                      : 'ACTION REQUIRED'}
                  </span>
                </div>

                <div className="p-3 space-y-2.5">
                  <div>
                    <span className="inline-block px-2 py-0.5 rounded-full bg-teal-50 text-teal-800 text-[9px] font-bold uppercase tracking-wider mb-1">
                      Action Required
                    </span>
                    <div className="text-xs font-bold text-slate-900">Your signature is needed</div>
                    <div className="text-[10px] text-slate-500">Hi [Signer], {user.name} submitted this request for your review.</div>
                  </div>

                  {/* Payment Amount Box */}
                  {emailPreviewConfig.paymentDetails ? (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50/70 p-2.5 flex items-center justify-between">
                      <div>
                        <div className="text-[9px] font-bold text-emerald-800 uppercase tracking-wider">Payment Amount</div>
                        <div className="text-sm font-extrabold text-emerald-950 mt-0.5">
                          {emailPreviewConfig.paymentDetails.amount}
                        </div>
                      </div>
                      <div className="bg-[#0D9488] text-white px-3 py-1 rounded font-bold text-[10px] shadow-xs flex items-center gap-1">
                        <span>Open in PreciSign</span>
                        <span>&rarr;</span>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-0.5">
                      <div className="inline-flex items-center gap-1 bg-[#0D9488] text-white px-3.5 py-1 rounded font-bold text-[10px] shadow-xs">
                        <span>Open in PreciSign</span>
                        <span>&rarr;</span>
                      </div>
                    </div>
                  )}

                  {/* Simulated Dynamic Request Summary Card */}
                  <div className="rounded-md border border-slate-200 bg-[#F8FAFC] p-2.5 space-y-1.5">
                    <div className="font-bold text-slate-900 text-[10px]">Request summary</div>
                    <div className="space-y-1 divide-y divide-slate-200/60 text-[10px]">
                      <div className="flex justify-between py-0.5"><span className="text-slate-500">Company</span><span className="font-semibold text-slate-900">{emailPreviewConfig.companyName}</span></div>
                      <div className="flex justify-between py-0.5"><span className="text-slate-500">Form</span><span className="text-slate-900">{emailPreviewConfig.formType}</span></div>
                      <div className="flex justify-between py-0.5"><span className="text-slate-500">Reference</span><span className="font-mono font-semibold text-slate-800">Assigned on submit</span></div>
                      <div className="flex justify-between py-0.5"><span className="text-slate-500">Requester</span><span className="text-slate-900">{user.name}</span></div>
                      {emailPreviewConfig.workDescription && (
                        <div className="flex justify-between py-0.5"><span className="text-slate-500">Work</span><span className="text-slate-900 text-right truncate max-w-[180px]">{emailPreviewConfig.workDescription}</span></div>
                      )}
                      {emailPreviewConfig.paymentDetails?.purpose && (
                        <div className="flex justify-between py-0.5"><span className="text-slate-500">Purpose</span><span className="text-slate-900 text-right truncate max-w-[180px]">{emailPreviewConfig.paymentDetails.purpose}</span></div>
                      )}
                    </div>
                  </div>

                  {/* PreciRoute Trail Simulation */}
                  <div className="rounded-md border border-slate-200 bg-white p-2.5 space-y-1.5">
                    <div className="font-bold text-slate-900 text-[9px] uppercase tracking-wider">PreciRoute Trail</div>
                    <div className="flex items-start gap-2 pt-0.5">
                      <div className="w-5 h-5 rounded-full bg-teal-100 text-teal-800 flex items-center justify-center font-bold text-[9px] shrink-0">
                        {user.name.trim()[0]?.toUpperCase() || 'R'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px]">
                          <strong className="text-slate-900">{user.name} (Requester)</strong>
                          <span className="text-slate-400">&nbsp;&middot;&nbsp;Submitted</span>
                        </div>
                        <div className="mt-1 bg-slate-50 border-l-2 border-teal-600 px-2 py-1 rounded-r text-[10px] text-slate-700 italic">
                          {emailPreviewConfig.emailNote.trim() ? emailPreviewConfig.emailNote : '(Note entered below will appear here)'}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Clean Footer note */}
                  <div className="pt-1 border-t border-slate-100 text-center text-[9px] text-slate-400">
                    View the full form and attachments in <span className="text-teal-700 font-semibold underline">PreciSign</span>.
                  </div>
                </div>
              </div>

              {/* Note input field */}
              <div className="pt-1">
                <label className="block space-y-1 text-xs">
                  <span className="font-bold text-teal-950">Note for email (optional)</span>
                  <textarea
                    rows={2}
                    maxLength={1000}
                    value={emailPreviewConfig.emailNote}
                    onChange={e => emailPreviewConfig.onEmailNoteChange(e.target.value)}
                    placeholder="e.g. Please review before the next workshop shift."
                    className="workspace-control block w-full rounded-md px-3 py-1.5 text-xs bg-white border border-teal-300"
                  />
                  <span className="block text-[11px] text-slate-600">
                    Rendered below the form in the notification email. Separate from internal workflow remarks.
                  </span>
                </label>
              </div>
            </div>
          )}
          {tab === 'saved' && user.signatureDataUrl && <div className="rounded-lg border border-workspace-line bg-workspace p-4"><p className="mb-3 text-xs font-medium">Your saved signature</p><img src={user.signatureDataUrl} alt={`Saved signature for ${user.name}`} className="mx-auto h-20 max-w-full object-contain" /></div>}
          {tab === 'style' && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-slate-700">
                Signed-in name on official document:
              </label>
              <EditorInput
                type="text"
                value={styledName}
                readOnly
                className="w-full text-xs"
                placeholder="Your full name"
              />
              <div className="p-4 bg-[#F5F6F8] border border-dashed border-[#CBD5E1] rounded-md flex items-center justify-center min-h-[90px]">
                <div
                  className="text-blue-900 text-3xl font-bold tracking-wider italic select-none"
                  style={{ fontFamily: "'Caveat', cursive" }}
                >
                  {styledName || user.name}
                </div>
              </div>
            </div>
          )}

          {tab === 'draw' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Draw signature on canvas below:</span>
                <button
                  type="button"
                  onClick={clearCanvas}
                  className="text-[#365C78] hover:underline font-semibold"
                >
                  Clear Canvas
                </button>
              </div>
              <div className="border border-[#CBD5E1] rounded-md overflow-hidden bg-[#F5F6F8]">
                <canvas
                  ref={canvasRef}
                  width={420}
                  height={130}
                  aria-label="Signature drawing area"
                  onPointerDown={startDrawing}
                  onPointerMove={draw}
                  onPointerUp={stopDrawing}
                  onPointerCancel={stopDrawing}
                  onLostPointerCapture={stopDrawing}
                  style={{ touchAction: 'none' }}
                  className="w-full h-[130px] cursor-crosshair bg-white touch-none"
                />
              </div>
            </div>
          )}

          {tab === 'upload' && (
            <div className="space-y-3">
              {user.signatureDataUrl && <button type="button" className="text-xs underline" onClick={() => setUploadedDataUrl(user.signatureDataUrl!)}>Use saved signature</button>}
              <div className="border-2 border-dashed border-[#CBD5E1] rounded-md p-6 text-center hover:bg-[#F9FAFB] transition-colors has-[:focus-visible]:border-teal-700 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-teal-700/20">
                <input
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={handleFileUpload}
                  className="peer sr-only"
                  id="sig-file-upload"
                  aria-label="Upload signature image, PNG or JPEG up to 2MB"
                />
                <label
                  htmlFor="sig-file-upload"
                  className="cursor-pointer space-y-2 block rounded peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-teal-700"
                >
                  <Upload className="w-6 h-6 mx-auto text-slate-400 peer-focus-visible:text-teal-700" aria-hidden="true" />
                  <span className="text-xs font-semibold text-[#365C78] hover:underline block">
                    Choose PNG or JPEG image
                  </span>
                  <span className="text-[10px] text-slate-400 block">Maximum file size 2MB</span>
                </label>
              </div>
              {uploadedDataUrl && (
                <div className="p-2 bg-[#F5F6F8] border rounded-md flex items-center justify-center max-h-[80px]">
                  <img src={uploadedDataUrl} alt="Uploaded signature" className="max-h-[60px] object-contain" />
                </div>
              )}
            </div>
          )}

          {noteLabel && (
            <label className="block space-y-1 text-xs">
              <span className="font-semibold text-slate-800">{noteLabel} (optional)</span>
              <EditorTextarea
                rows={2}
                maxLength={2000}
                value={note}
                onChange={event => setNote(event.target.value)}
                placeholder="Add an internal note for signers..."
              />
              <span className="block text-slate-500">People who can open this request can read this note in its history. It stays off the official form.</span>
            </label>
          )}

          {/* Governance Notice */}
          <div className="p-2.5 bg-slate-100 rounded-lg border border-slate-200 text-[11px] text-slate-700 leading-snug flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#365C78] shrink-0" />
            <span>
              Your signature mark will be recorded with the request.
            </span>
          </div>
        </fieldset>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-3.5 border-t border-[#E2E5E9] bg-[#F5F6F8]">
          <ActionButton
            variant="quiet"
            size="sm"
            disabled={saving}
            onClick={onClose}
          >
            Cancel
          </ActionButton>
          {onSignatureProfile && <ActionButton variant={user.signatureDataUrl ? 'quiet' : 'primary'} size="sm" disabled={saving} onClick={onSignatureProfile}>
            {user.signatureDataUrl ? 'Update in profile' : 'Set up signature'}
          </ActionButton>}
          {(!onSignatureProfile || user.signatureDataUrl) && <MorphButton
            variant="primary"
            size="sm"
            icon={Check}
            state={saving ? 'busy' : 'idle'}
            busyLabel={/submit/i.test(confirmLabel) ? 'Submitting…' : 'Signing…'}
            onClick={handleSaveAndConfirm}
          >
            {confirmLabel}
          </MorphButton>}
        </div>
      </div>
    </WorkspaceDialog>
  );
};
