import { MorphButton, useMorphState } from '../common/MorphButton';
import { PageHeader } from '../common/PageHeader';
import React, { useEffect, useState, useRef } from 'react';
import { useApp, useUnsavedWork } from '../../context/AppContext';
import { PenTool, Upload, Check, RotateCcw } from 'lucide-react';
import { ActionButton, EditorSelect, FormField } from '../create/RequestEditorControls';

import { SignatureCropEditor } from './SignatureCropEditor';
import { WorkspaceDialog } from '../common/WorkspaceDialog';

export const UserProfileView: React.FC = () => {
  const { currentUser, updateUserSignature, users, setCurrentUserId, readOnly: connected, signatureReturn, openReviewRequest } = useApp();

  const [activeTab, setActiveTab] = useState<'draw' | 'upload'>('upload');
  const [source, setSource] = useState<string | null>(null);
  const [drawPreview, setDrawPreview] = useState<string | null>(null);
  const isLoadingEmployee = currentUser.id === 'loading-employee';
  useUnsavedWork(source || drawPreview ? 'editing' : 'idle');
  const [returnAfterSave, setReturnAfterSave] = useState(false);
  useEffect(() => {
    if (returnAfterSave && signatureReturn) openReviewRequest(signatureReturn.requestId);
  }, [returnAfterSave, signatureReturn, openReviewRequest]);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [revealSignature, setRevealSignature] = useState(false);
  const [reading, setReading] = useState(false);
  // Only a finished save shows "Saved"; reading a file is busy but never "done".
  const savedState = useMorphState(saving, saveFailed);
  const saveState = reading ? 'busy' : savedState;
  const saveLock = useRef(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const [cropId, setCropId] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingPointer = useRef<number | null>(null);
  const hasDrawn = useRef(false);

  // Canvas drawing
  const startDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !e.isPrimary || e.button !== 0 || drawingPointer.current !== null) return;
    canvas.setPointerCapture(e.pointerId);
    drawingPointer.current = e.pointerId;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo((e.clientX - rect.left) * canvas.width / rect.width, (e.clientY - rect.top) * canvas.height / rect.height);
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
    ctx.lineTo((e.clientX - rect.left) * canvas.width / rect.width, (e.clientY - rect.top) * canvas.height / rect.height);
    ctx.stroke();
    hasDrawn.current = true;
  };

  const stopDrawing = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingPointer.current !== e.pointerId) return;
    drawingPointer.current = null;
    if (hasDrawn.current && canvasRef.current) setDrawPreview(canvasRef.current.toDataURL('image/png'));
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn.current = false;
    setDrawPreview(null);
  };

  const handleSaveSignature = async (image: string | undefined) => {
    if (saveLock.current || reading || isLoadingEmployee) return;
    saveLock.current = true;
    setSaving(true);
    setSaveFailed(false);
    try {
      await updateUserSignature(currentUser.id, image, image ? currentUser.name : undefined);
      setSource(null);
      setUploaded(null);
      setDrawPreview(null);
      clearCanvas();
      setFeedback(image ? 'Signature saved.' : 'Signature removed.');
      setRevealSignature(Boolean(image));
      if (image && signatureReturn?.userId === currentUser.id) setReturnAfterSave(true);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Could not update signature.');
      setSaveFailed(true);
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2*1024*1024 || !['image/png','image/jpeg'].includes(file.type)) { setFeedback('Choose a PNG or JPEG up to 2 MiB.'); return; }
    setReading(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const data = String(reader.result);
      try {
        const image = new Image();
        image.src = data;
        await image.decode();
        setUploaded(null);
        setSource(data);
        setCropId(id => id + 1);
        setFeedback(null);
      } catch {
        setFeedback('Could not open the selected image.');
      } finally {
        setReading(false);
      }
    };
    reader.onerror = () => { setReading(false); setFeedback('Could not read the selected image.'); };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <section className="settings-page space-y-6" aria-labelledby="profile-title">
      <PageHeader motif="signature" eyebrow="Signature & profile" title="My profile" headingId="profile-title" subtitle="Manage the signature you use on requests." />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <aside className="workspace-panel min-w-0 space-y-5 p-5">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="grid size-12 shrink-0 place-items-center rounded-xl text-base font-bold text-white"
              style={{ backgroundColor: currentUser.avatarColor || '#365C78' }}
            >
              {currentUser.initials}
            </div>
            <div className="min-w-0">
              <h2 className="break-words font-semibold text-workspace-ink">{currentUser.name}</h2>
              <p className="text-sm text-workspace-muted">{currentUser.role}</p>
            </div>
          </div>

          <dl className="space-y-3 border-t border-workspace-line pt-4 text-sm">
            <div>
              <dt className="text-xs font-medium text-workspace-muted">Department</dt>
              <dd className="mt-0.5 break-words text-workspace-ink">{currentUser.department}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-workspace-muted">Email</dt>
              <dd className="mt-0.5 [overflow-wrap:anywhere] text-workspace-ink">{currentUser.email}</dd>
            </div>
          </dl>

          {!connected && (
            <FormField id="profile-persona" label="Demo persona">
              <EditorSelect id="profile-persona" value={currentUser.id} onChange={event => setCurrentUserId(event.target.value)}>
                {users.map(user => <option key={user.id} value={user.id}>{user.name} — {user.role}</option>)}
              </EditorSelect>
            </FormField>
          )}

          <div className="border-t border-workspace-line pt-4">
            <h3 className="mb-2 text-sm font-semibold text-workspace-ink">Saved signature</h3>
            {currentUser.signatureDataUrl ? (
              <div className="grid min-h-20 place-items-center rounded-lg bg-slate-50 px-3 py-2">
                <img key={currentUser.signatureDataUrl.length + currentUser.signatureDataUrl.slice(-24)} src={currentUser.signatureDataUrl} alt="Saved signature" className={'max-h-20 max-w-full object-contain' + (revealSignature ? ' signature-reveal' : '')} />
              </div>
            ) : <p className="text-sm text-workspace-muted">No signature saved yet.</p>}
            {currentUser.signatureDataUrl && <ActionButton variant="quiet" size="sm" disabled={saving || reading}
              onClick={() => void handleSaveSignature(undefined)}>Remove saved signature</ActionButton>}
          </div>
        </aside>

        <section className="workspace-panel min-w-0 overflow-hidden" aria-labelledby="signature-title">
          <header className="border-b border-workspace-line px-5 py-4 sm:px-6">
            <h2 id="signature-title" className="text-lg font-semibold text-workspace-ink">Signature settings</h2>
            <p className="mt-1 text-sm text-workspace-muted">Requests still require signature confirmation. Previously signed documents keep their original signatures.</p>
          </header>

          <div className="space-y-5 p-5 sm:p-6">
            <div role="group" aria-label="Signature method" className="grid grid-cols-2 gap-1 rounded-xl border border-workspace-line bg-slate-50 p-1">
              {([
                { value: 'upload', label: 'Upload signature', Icon: Upload },
                { value: 'draw', label: 'Draw signature', Icon: PenTool },
              ] as const).map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={activeTab === value}
                  disabled={saving || reading}
                  onClick={() => {
                    if (value === activeTab) return;
                    const switchMethod = () => {
                      setSource(null);
                      setUploaded(null);
                      clearCanvas();
                      setActiveTab(value);
                    };
                    if (source || drawPreview) setDiscard(() => switchMethod);
                    else switchMethod();
                  }}
                  className="flex min-h-10 items-center justify-center gap-1.5 rounded-lg border border-transparent px-2 text-sm font-semibold text-workspace-muted hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-700 aria-pressed:border-workspace-line aria-pressed:bg-white aria-pressed:text-workspace-ink aria-pressed:shadow-xs"
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {label}
                </button>
              ))}
            </div>

            {activeTab === 'draw' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-workspace-muted">Draw with your pointer or finger.</p>
                  <ActionButton variant="quiet" size="sm" icon={RotateCcw} onClick={clearCanvas}>Clear canvas</ActionButton>
                </div>
                <div className="signature-drop relative overflow-hidden rounded-xl border border-slate-400 bg-white">
                  {!drawPreview && <svg aria-hidden="true" focusable="false" viewBox="0 0 200 60" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="signature-guide">
                    <path pathLength={1} d="M12 40c8-14 14-26 20-26 7 0-8 30-2 30 5 0 12-20 18-20 4 0-2 14 3 14 6 0 9-12 14-12 3 0 1 9 5 9 6 0 10-8 16-8 4 0 3 6 8 6 9 0 18-6 30-8" />
                    <path pathLength={1} d="M20 50h160" strokeDasharray="2 5" opacity="0.6" />
                  </svg>}
                  <canvas
                    ref={canvasRef}
                    width={500}
                    height={150}
                    aria-label="Signature drawing area"
                    onPointerDown={startDrawing}
                    onPointerMove={draw}
                    onPointerUp={stopDrawing}
                    onPointerCancel={stopDrawing}
                    onLostPointerCapture={stopDrawing}
                    className="h-[150px] w-full touch-none cursor-crosshair"
                  />
                </div>
                {drawPreview && <img alt="Drawn signature preview" src={drawPreview} className="h-16 max-w-full object-contain" />}
              </div>
            )}

            {activeTab === 'upload' && (
              <div className="space-y-3">
                <input ref={fileInput} id="profile-sig-file" type="file" accept="image/png,image/jpeg" onChange={handleImageUpload} hidden />
                <button type="button" disabled={saving || reading} onClick={() => {
                  if (source) setDiscard(() => () => fileInput.current?.click());
                  else fileInput.current?.click();
                }} className="workspace-control flex w-full items-center gap-3 rounded-xl border-dashed bg-slate-50 p-4 text-left">
                  <Upload aria-hidden="true" className="size-5 shrink-0 text-workspace-teal" />
                  <span>
                    <span className="block text-sm font-semibold text-workspace-ink">{source ? 'Choose another image' : 'Choose signature image'}</span>
                    <span className="text-xs text-workspace-muted">PNG or JPEG, up to 2 MiB</span>
                  </span>
                </button>
                {source && <SignatureCropEditor key={cropId} source={source} onSelect={setUploaded} />}

              </div>
            )}
          </div>

          <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-workspace-line bg-slate-50/60 px-5 py-4 sm:px-6">
            <p role="status" className="flex-1 text-sm text-workspace-muted">{feedback}</p>
            <MorphButton variant="primary" size="md" icon={Check} state={saveState} disabled={isLoadingEmployee || !(activeTab === 'draw' ? drawPreview : uploaded)} busyLabel={reading ? 'Reading file…' : 'Saving…'} doneLabel="Saved" errorLabel="Try again" onClick={() => void handleSaveSignature((activeTab === 'draw' ? drawPreview : uploaded) || undefined)}>
              Save signature
            </MorphButton>
          </footer>
        </section>
      </div>
      {discard && <WorkspaceDialog titleId="discard-signature-edit" onClose={() => setDiscard(null)} className="max-w-sm p-5">
        <h2 id="discard-signature-edit" className="font-semibold">Discard your signature edit?</h2>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" data-dialog-focus className="workspace-control min-h-10 px-3 text-sm" onClick={() => setDiscard(null)}>Stay</button>
          <ActionButton variant="primary" size="sm" onClick={() => { setDiscard(null); discard(); }}>Discard</ActionButton>
        </div>
      </WorkspaceDialog>}
    </section>
  );
};

