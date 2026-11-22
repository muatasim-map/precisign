import { useEffect, useState } from 'react';
import type { ApiPreciSignRepository } from '../../services/apiRepository';
import { ActionButton, EditorInput, FormField } from '../create/RequestEditorControls';

type DisplayProfile = Awaited<ReturnType<ApiPreciSignRepository['getDisplayProfile']>>;

export function ProfileDetails({ repository, name, email }: { repository: ApiPreciSignRepository; name: string; email: string }) {
  const [profile, setProfile] = useState<DisplayProfile>();
  const [saved, setSaved] = useState<DisplayProfile>();
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void repository.getDisplayProfile().then(value => {
      if (active) { setProfile(value); setSaved(value); }
    }).catch(() => { if (active) setError('Could not load your profile.'); });
    return () => { active = false; };
  }, [repository, loadAttempt]);

  return <div className="space-y-4 border-t border-workspace-line pt-4">
    <h3 className="text-sm font-semibold text-workspace-ink">Display profile</h3>
    {!profile && !error && <p role="status" className="text-sm text-workspace-muted">Loading your profile…</p>}
    {!profile && error && <ActionButton type="button" size="sm" onClick={() => setLoadAttempt(attempt => attempt + 1)}>Try loading again</ActionButton>}
    {profile && <form className="space-y-3" onSubmit={async event => {
      event.preventDefault();
      if (busy || reading) return;
      setBusy(true); setMessage(''); setError('');
      try {
        const updated = await repository.saveDisplayProfile(profile);
        setProfile(updated); setSaved(updated); setMessage('Display profile saved.');
      } catch { setError('Could not save your profile. Check the photo and try again.'); }
      finally { setBusy(false); }
    }}>
      <div className="flex items-center gap-3">
        {profile.photo && <img src={profile.photo} alt="Your profile photo" className="size-14 rounded-xl object-cover" />}
        <FormField id="profile-photo" label="Profile photo">
          <input id="profile-photo" type="file" accept="image/png,image/jpeg" disabled={busy || reading} className="max-w-full text-xs" onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setMessage(''); setError('');
            if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024) {
              setError('Choose a PNG or JPEG up to 2 MB.'); return;
            }
            setReading(true);
            const reader = new FileReader();
            reader.onload = () => setProfile(current => current && { ...current, photo: String(reader.result) });
            reader.onerror = () => setError('Could not read that photo.');
            reader.onloadend = () => setReading(false);
            reader.readAsDataURL(file);
          }} />
        </FormField>
      </div>
      {profile.photo && <ActionButton type="button" variant="quiet" size="sm" disabled={busy || reading} onClick={() => { setMessage(''); setProfile({ ...profile, photo: null }); }}>Remove photo</ActionButton>}
      <FormField id="display-department" label="Display department">
        <EditorInput id="display-department" value={profile.department} maxLength={100} disabled={busy} onChange={event => { setMessage(''); setProfile({ ...profile, department: event.target.value }); }} aria-describedby="display-department-help" />
        <p id="display-department-help" className="mt-1 text-xs text-workspace-muted">Shown here as profile information. Access is managed separately.</p>
      </FormField>
      <ActionButton type="submit" size="sm" disabled={reading || busy || (saved?.department === profile.department && saved.photo === profile.photo)}>{busy ? 'Saving…' : 'Save display profile'}</ActionButton>
    </form>}
    {message && <p role="status" className="text-sm text-workspace-muted">{message}</p>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <ProfileHelp label="Request a name change" submitLabel="Send name change request" request={value => repository.requestNameChange(value)} valueRequired currentName={name} />
    <ProfileHelp label="Password help" submitLabel="Request password reset" request={() => repository.requestPasswordReset(email)} />
  </div>;
}

function ProfileHelp({ label, submitLabel, request, valueRequired = false, currentName }: { label: string; submitLabel: string; request: (value: string) => Promise<void>; valueRequired?: boolean; currentName?: string }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>();
  return <details className="border-t border-workspace-line pt-3">
    <summary className="cursor-pointer text-sm font-semibold text-workspace-ink">{label}</summary>
    <form className="mt-3 space-y-2" onSubmit={async event => {
      event.preventDefault();
      if (busy) return;
      setBusy(true); setFeedback(undefined);
      try {
        await request(value.trim());
        setValue('');
        setFeedback({ text: valueRequired ? 'Your request was sent to a super admin.' : 'Recovery requested. Super admins receive a link by email. Employee requests go to a super admin for review.' });
      } catch { setFeedback({ text: 'Could not send your request. Try again shortly.', error: true }); }
      finally { setBusy(false); }
    }}>
      {valueRequired && <FormField id="requested-name" label="Requested name"><EditorInput id="requested-name" autoComplete="name" required maxLength={150} value={value} disabled={busy} onChange={event => setValue(event.target.value)} /></FormField>}
      <ActionButton type="submit" size="sm" disabled={busy || (valueRequired && (!value.trim() || value.trim() === currentName))}>{busy ? 'Sending…' : submitLabel}</ActionButton>
      {feedback && <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'text-sm text-rose-700' : 'text-sm text-workspace-muted'}>{feedback.text}</p>}
    </form>
  </details>;
}
