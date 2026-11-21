import { toast } from '../common/Toaster';
import { PageHeader } from '../common/PageHeader';
import { useEffect, useState } from 'react';
import { ImageIcon } from 'lucide-react';
import type { Company } from '../../types';
import type { IAccountAdministrationRepository } from '../../services/repository';
import { ActionButton } from '../create/RequestEditorControls';

export function CompanyBrandingView({ repository }: { repository: IAccountAdministrationRepository }) {
  const [companies, setCompanies] = useState<Company[]>();
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    repository.listCompanyBranding().then(result => {
      if (!cancelled) setCompanies(result);
    }).catch(() => {
      if (!cancelled) setLoadError(true);
    });
    return () => { cancelled = true; };
  }, [repository, attempt]);

  return (
    <section className="settings-page space-y-5">
      <PageHeader motif="brand" eyebrow="Administration" title="Company branding" subtitle="Manage the logo used on new requests for each legal company. PNG or JPEG, up to 2 MiB. Submitted requests keep their original branding permanently." />
      {loadError ? <div className="workspace-panel space-y-2 p-5">
        <p role="alert">Could not load company branding.</p>
        <ActionButton variant="secondary" size="sm" onClick={() => { setLoadError(false); setAttempt(value => value + 1); }}>Retry</ActionButton>
      </div> : !companies ? <div role="status" aria-label="Loading companies" className="space-y-3">{[0, 1, 2].map(index => <div key={index} className="workspace-panel flex items-center gap-4 p-5"><div className="skeleton size-14 shrink-0" /><div className="flex-1 space-y-2"><div className="skeleton h-3.5 w-1/3" /><div className="skeleton h-3 w-1/2" /></div></div>)}<span className="sr-only">Loading companies…</span></div> : <div className="fade-in space-y-5">{companies.map(company =>
        <CompanyLogoEditor key={company.id} company={company} repository={repository} />
      )}</div>}
    </section>
  );
}

function CompanyLogoEditor({ company, repository }: { company: Company; repository: IAccountAdministrationRepository }) {
  const [logo, setLogo] = useState(company.logoDataUrl ?? null);
  const [preview, setPreview] = useState<string>();
  const [file, setFile] = useState<File>();
  const [inputKey, setInputKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!file) { setPreview(undefined); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function save(remove: boolean) {
    if (saving || (!remove && !file)) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const dataUrl = remove ? null : await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read the image.'));
        reader.readAsDataURL(file!);
      });
      setLogo(await repository.updateCompanyLogo(company.id, dataUrl));
      setFile(undefined);
      setInputKey(value => value + 1);
      setMessage('');
      toast(remove ? `${company.code} logo removed.` : `${company.code} logo saved for new requests.`);
    } catch {
      setError('Could not save the change. Use a readable PNG or JPEG up to 2 MiB and try again.');
    } finally {
      setSaving(false);
    }
  }

  const hasLogo = Boolean(preview || logo);

  return (
    <article className="workspace-panel grid gap-4 p-5 sm:grid-cols-[9rem_minmax(0,1fr)] items-start">
      <div className="flex flex-col items-center gap-2">
        <div className="grid h-24 w-36 place-items-center rounded-lg border border-slate-200 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:8px_8px] bg-slate-50 p-2 shadow-xs">
          {hasLogo ? (
            <img className="max-h-full max-w-full object-contain" src={preview || logo || undefined} alt={`${company.code} logo`} />
          ) : (
            <span className="text-center text-xs text-workspace-muted">
              <ImageIcon aria-hidden="true" className="mx-auto mb-1 size-5 text-slate-400" /> Blank logo area
            </span>
          )}
        </div>
        {hasLogo ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            Logo active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
            No logo yet
          </span>
        )}
      </div>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">{company.code}</span>
            <h2 className="font-semibold text-base text-[#192B3C]">{company.fullName}</h2>
          </div>
        </div>

        {file && <p role="status" className="break-all text-xs font-semibold text-workspace-teal">Unsaved preview · {file.name}</p>}
        {!hasLogo && <p className="text-xs text-workspace-muted">Documents show a blank logo area until an image is uploaded.</p>}
        <label className="logo-drop">
          <span className="sr-only">Choose a new logo image for {company.code}</span>
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="logo-drop-glyph size-6 shrink-0">
            <rect x="3" y="5" width="18" height="14" rx="2.5" opacity="0.55" />
            <path d="M3.5 16.5l4.6-4.3a1.5 1.5 0 0 1 2 0l3.4 3.2" opacity="0.55" />
            <path d="M12 3v7.5M9 6l3-3 3 3" />
          </svg>
          <span className="logo-drop-text">{file ? file.name : 'Drop an image here, or click to choose'}</span>
          <input key={inputKey} type="file" accept="image/png,image/jpeg" disabled={saving} className="logo-drop-input"
            onChange={event => {
              const selected = event.currentTarget.files?.[0];
              setMessage('');
              const invalid = selected && (!['image/png', 'image/jpeg'].includes(selected.type) || selected.size > 2 * 1024 * 1024);
              setError(invalid ? 'Choose a PNG or JPEG up to 2 MiB.' : '');
              setFile(invalid ? undefined : selected);
              if (invalid) event.currentTarget.value = '';
            }} />
        </label>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <ActionButton variant="primary" size="sm" disabled={!file} busy={saving} busyText="Saving..." onClick={() => void save(false)}>Save logo</ActionButton>
          {!file && !saving && <span className="text-xs text-workspace-muted">Choose an image to enable saving</span>}
          {file && <ActionButton variant="quiet" size="sm" disabled={saving} onClick={() => { setFile(undefined); setInputKey(value => value + 1); setError(''); }}>Discard preview</ActionButton>}
          {logo && <ActionButton variant="danger" size="sm" disabled={saving} onClick={() => void save(true)}>Remove logo</ActionButton>}
        </div>
        {error && <p role="alert" className="text-xs text-red-700 font-medium">{error}</p>}
        {(saving || message) && <p role="status" className="text-xs text-workspace-muted">{saving ? 'Saving...' : message}</p>}
      </div>
    </article>
  );
}
