import { WorkspaceDialog } from './components/common/WorkspaceDialog';
import { canConfigureSigningRoutes } from './utils/workflowAdministration';
import { isShowcaseBuild } from './config/demo';
import { ShowcaseAdministration } from './services/showcaseAdministration';
import { ShowcaseBar } from './components/layout/ShowcaseBar';
import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AppSidebar } from './components/layout/AppSidebar';
import { AppHeader } from './components/layout/AppHeader';
import { DashboardView } from './components/dashboard/DashboardView';
import { CreateRequestView } from './components/create/CreateRequestView';
import { ReviewSignView } from './components/review/ReviewSignView';
import { WorkflowSettingsView } from './components/settings/WorkflowSettingsView';
import { UserProfileView } from './components/profile/UserProfileView';
import { companyForms, FormsLibraryView } from './components/library/FormsLibraryView';
import { ArchiveRegisterView } from './components/archive/ArchiveRegisterView';
import { ApiPreciSignRepository } from './services/apiRepository';
import { ApiError } from './services/apiTypes';
import { ApiSession, type SessionState } from './services/apiSession';
import { RequestPdfView } from './components/document/RequestPdfView';
import { SignatureModal } from './components/modals/SignatureModal';
import { CompanyBrandingView } from './components/settings/CompanyBrandingView';
import { AccountDirectoryView } from './components/settings/AccountDirectoryView';
import type { UserProfile } from './types';
import { RequestCompanyField } from './components/create/RequestCompanyField';
import { canUserStartForm } from './utils/companyAccess';
import { Building2, Check, Mail, PenLine, UserRound, ArrowRight } from 'lucide-react';
import { AuthLayout } from './components/layout/AuthLayout';
import { Router, Route, Switch, Redirect, useLocation, Link } from 'wouter';
import { PageTitle } from './navigation/PageTitle';
import { ScrollToTop } from './navigation/ScrollToTop';
import { ProtectedRoute } from './components/common/ProtectedRoute';
import { NotFoundPage } from './components/common/NotFoundPage';
import { useProductTour } from './components/tour/useProductTour';
import { Toaster } from './components/common/Toaster';
import { PasswordField } from './components/common/PasswordField';
import { MorphButton } from './components/common/MorphButton';
import { AuthCard } from './components/layout/AuthCard';
import { passwordProblem } from '../../shared/utils/passwordPolicy';
import { RequestSkeleton } from './components/common/Skeletons';
import { CommandPalette } from './components/common/CommandPalette';

const formSlugMap: Record<string, string> = {
  'administrative-payment': 'Administrative & Payment Request',
  'admin-payment': 'Administrative & Payment Request',
  'it-request': 'IT Request',
  'it': 'IT Request',
  'cash-voucher': 'Cash Voucher',
  'expense-claim': 'Expense Claim',
  'rnd': 'R&D Initiative',
  'rnd-initiative': 'R&D Initiative',
  'admin-work': 'Admin Work Request',
};

const RequestDetailRoute: React.FC<{ id: string }> = ({ id }) => {
  const { requestRouteStatus, retryRequestRoute, currentUser, selectedScope, selectedRequestId } = useApp();
  if (requestRouteStatus === 'loading') {
    return <RequestSkeleton />;
  }
  if (requestRouteStatus === 'unavailable') {
    return (
      <section className="workspace-panel m-6 max-w-xl space-y-3 p-6" role="alert">
        <h1 className="text-xl font-bold">Request unavailable</h1>
        <p className="text-sm text-workspace-muted">This request may not exist or may not be available to your account.</p>
        <Link href="/dashboard" className="workspace-primary inline-flex min-h-10 items-center px-4 text-sm font-semibold">
          Return to Dashboard
        </Link>
      </section>
    );
  }
  if (requestRouteStatus === 'error') {
    return (
      <section role="alert" className="workspace-panel m-6 max-w-xl space-y-3 p-6">
        <h1 className="text-xl font-bold">Could not load request</h1>
        <p className="text-sm text-workspace-muted">Check your connection or sign in again, then try again.</p>
        <button type="button" className="workspace-primary min-h-10 px-4" onClick={retryRequestRoute}>Try again</button>
      </section>
    );
  }
  return <ReviewSignView key={`${currentUser.id}:${selectedScope}:${id || selectedRequestId}`} />;
};

const MainLayout: React.FC<{ repository?: ApiPreciSignRepository; onSignOut?: () => void }> = ({ repository, onSignOut }) => {
  const {
    navigationPrompt,
    currentUser,
    selectedScope,
    draftReady,
    draftError,
    retryDraft,
    readOnly,
    draftCompanyId,
    selectDraftCompany,
    companies,
  } = useApp();
  const [location] = useLocation();
  const administration = React.useMemo(() => repository ?? (isShowcaseBuild ? new ShowcaseAdministration(currentUser.id) : undefined), [repository, currentUser.id]);
  const canOpenDirectory = Boolean(administration && currentUser.isSuperAdmin);
  const [sidebarHidden, setSidebarHidden] = React.useState(false);
  const awaitingAccess = readOnly && companies.length === 0;
  const revealSidebar = React.useCallback(() => setSidebarHidden(false), []);
  useProductTour({ awaitingAccess, canOpenDirectory, revealSidebar });

  function renderFormEditor(formType: string) {
    const shortcut = companyForms.find(f => f.name === formType)?.name;
    const libraryEditor = shortcut === 'Administrative & Payment Request' ? undefined : shortcut;
    if (libraryEditor) return <FormsLibraryView key={libraryEditor} initialForm={libraryEditor} />;

    if (readOnly && !draftCompanyId) return (
      <section className="mx-auto max-w-xl space-y-5 px-5 py-8">
        <Link href="/forms" className="text-sm font-semibold text-workspace-teal hover:underline">← Back to forms</Link>
        <div>
          <p className="text-sm font-medium text-slate-600">{formType}</p>
          <h1 className="mt-1 text-2xl font-semibold text-workspace-ink">Choose the request company</h1>
        </div>
        <RequestCompanyField form={formType} value="" onChange={selectDraftCompany} />
      </section>
    );

    if (readOnly && draftCompanyId && !canUserStartForm(currentUser, draftCompanyId, formType)) {
      return (
        <div className="p-6">
          <p>You don’t have access to start this form in the current company.</p>
          <Link href="/forms" className="mt-3 inline-block underline">Back to forms</Link>
        </div>
      );
    }

    if (draftReady || formType === 'Administrative & Payment Request') {
      return <CreateRequestView key={`${currentUser.id}:${selectedScope}:${draftCompanyId}:${formType}`} />;
    }

    return (
      <div className="p-6 text-sm">
        {draftError ? (
          <>
            <p role="alert">{draftError}</p>
            <button onClick={retryDraft} className="mt-2 underline">Retry</button>
          </>
        ) : (
          <p role="status">Loading draft…</p>
        )}
      </div>
    );
  }

  return (
    <div className="preci-shell flex min-h-screen bg-workspace text-workspace-ink">
      <PageTitle />
      <ScrollToTop />
      <AppSidebar canOpenDirectory={canOpenDirectory} onSignOut={onSignOut} desktopHidden={sidebarHidden} onHideDesktop={() => setSidebarHidden(true)} />

      <div className="flex-1 flex flex-col min-w-0">
        <AppHeader onSignOut={onSignOut} sidebarHidden={sidebarHidden} onToggleSidebar={() => setSidebarHidden(value => !value)} />
        {isShowcaseBuild && <ShowcaseBar />}
        <main className="flex-1 pb-16">
          {awaitingAccess ? (
            <section className="workspace-panel mx-4 my-6 max-w-xl space-y-3 p-6 sm:mx-6">
              <span className="grid size-12 place-items-center rounded-xl bg-workspace-tint text-workspace-teal">
                <Building2 aria-hidden="true" />
              </span>
              <h1 className="text-2xl font-bold">Welcome, {currentUser.name}</h1>
              <p className="text-sm text-workspace-muted">You haven’t been assigned a company yet. Ask your account administrator for access.</p>
              <Link href="/settings/profile" className="workspace-control preci-press inline-flex min-h-10 items-center px-3 text-sm font-semibold">
                Set up your signature
              </Link>
            </section>
          ) : (
            <div key={location} className="route-view-enter flex-1">
              <Switch>
                <Route path="/" component={DashboardView} />
                <Route path="/dashboard" component={DashboardView} />
                <Route path="/requests" component={DashboardView} />
                <Route path="/requests/:id">
                  {params => <RequestDetailRoute id={decodeURIComponent(params.id)} />}
                </Route>
                <Route path="/forms">
                  <FormsLibraryView />
                </Route>
                <Route path="/forms/:slug/new">
                  {params => {
                    const formType = formSlugMap[params.slug];
                    if (!formType) return <NotFoundPage />;
                    return renderFormEditor(formType);
                  }}
                </Route>
                <Route path="/rnd">
                  <Redirect to="/forms/rnd/new" replace />
                </Route>
                <Route path="/archive" component={ArchiveRegisterView} />
                <Route path="/settings">
                  <Redirect to="/settings/profile" replace />
                </Route>
                <Route path="/settings/profile" component={UserProfileView} />
                <ProtectedRoute
                  path="/settings/signing-routes"
                  isAllowed={canConfigureSigningRoutes(currentUser) || (!repository && !isShowcaseBuild)}
                  component={WorkflowSettingsView}
                  title="Signing routes restricted"
                  message="Only workflow administrators can configure signing routes."
                />
                <ProtectedRoute
                  path="/settings/users"
                  isAllowed={canOpenDirectory}
                  component={() => <AccountDirectoryView repository={administration!} />}
                  title="User directory restricted"
                  message="Only Super Administrators can manage user accounts and directory grants."
                />
                <ProtectedRoute
                  path="/settings/branding"
                  isAllowed={canOpenDirectory}
                  component={() => <CompanyBrandingView repository={administration!} />}
                  title="Company branding restricted"
                  message="Only Super Administrators can configure company logos and branding."
                />
                <Route component={NotFoundPage} />
              </Switch>
            </div>
          )}
        </main>
        <Toaster />
        {!awaitingAccess && <CommandPalette canOpenDirectory={canOpenDirectory} />}
        {navigationPrompt && (
          <WorkspaceDialog titleId="leave-page-heading" onClose={navigationPrompt.stay} className="max-w-md p-6">
            <h2 id="leave-page-heading" className="text-lg font-bold">Leave this page?</h2>
            <p className="mt-2 text-sm text-workspace-muted">You have unsaved changes. Leaving may discard them. Existing saved drafts remain available.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" data-dialog-focus className="workspace-control min-h-10 px-4" onClick={navigationPrompt.stay}>Stay</button>
              <button type="button" className="workspace-primary min-h-10 px-4" onClick={navigationPrompt.leave}>{location === '/settings/profile' ? 'Discard' : 'Leave'}</button>
            </div>
          </WorkspaceDialog>
        )}
      </div>
    </div>
  );
};

const RoutedMainLayout: React.FC<{ repository?: ApiPreciSignRepository; onSignOut?: () => void }> = ({ repository, onSignOut }) => {
  const { locationHook } = useApp();
  return (
    <Router hook={locationHook}>
      <MainLayout repository={repository} onSignOut={onSignOut} />
    </Router>
  );
};

const ApiApp: React.FC = () => {
  const [state, setState] = React.useState<SessionState>({ status: 'loading' });
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [signup, setSignup] = React.useState(false);
  const [name, setName] = React.useState('');
  const [department, setDepartment] = React.useState('');
  const [signatureDataUrl, setSignatureDataUrl] = React.useState<string>();
  const [showSignature, setShowSignature] = React.useState(false);
  const [signupBusy, setSignupBusy] = React.useState(false);
  const [loginBusy, setLoginBusy] = React.useState(false);
  const [signupError, setSignupError] = React.useState('');
  const [newPassword, setNewPassword] = React.useState('');
  const [passwordChangeError, setPasswordChangeError] = React.useState('');
  const [passwordChangeBusy, setPasswordChangeBusy] = React.useState(false);
  const [connectionError, setConnectionError] = React.useState('');
  const [expired, setExpired] = React.useState(false);
  const [minutesLeft, setMinutesLeft] = React.useState<number | null>(null);
  const [reauthPassword, setReauthPassword] = React.useState('');
  const [reauthBusy, setReauthBusy] = React.useState(false);
  const [resetToken, setResetToken] = React.useState(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('reset') || '';
    if (token) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return token;
  });
  const [resetMessage, setResetMessage] = React.useState('');
  const [resetRequestBusy, setResetRequestBusy] = React.useState(false);
  const [forgot, setForgot] = React.useState(false);
  const repository = React.useMemo(() => new ApiPreciSignRepository(), []);
  const session = React.useMemo(() => new ApiSession(repository, setState), [repository]);
  React.useEffect(() => {
    const onHashChange = () => {
      const token = new URLSearchParams(window.location.hash.slice(1)).get('reset');
      if (token) { window.history.replaceState(null, '', window.location.pathname + window.location.search); setResetToken(token); }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  React.useEffect(() => { void session.restore(); }, [session]);
  React.useEffect(() => {
    if (state.status !== 'authenticated') return;
    let active = true;
    const timer = window.setInterval(() => { void repository.getCurrentUser().then(() => { if (active) setConnectionError(''); }).catch(error => { if (!active) return; if (error instanceof ApiError && error.status === 401) setExpired(true); else setConnectionError('Connection lost. Your entered information is kept here. Check the connection before saving again.'); }); }, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, [state.status, repository, session]);
  // Learn when this session ends as soon as we're signed in (the 30s check above refreshes it afterwards).
  React.useEffect(() => { if (state.status === 'authenticated') void repository.getCurrentUser().catch(() => undefined); }, [state.status, repository]);
  // Warn in the last 5 minutes of the session; the end time comes from /auth/me.
  React.useEffect(() => {
    if (state.status !== 'authenticated' || expired) { setMinutesLeft(null); return undefined; }
    const check = () => {
      const end = repository.sessionExpiresAt;
      const left = end ? Math.ceil((end - Date.now()) / 60000) : null;
      setMinutesLeft(left !== null && left > 0 && left <= 5 ? left : null);
    };
    check();
    const timer = window.setInterval(check, 15000);
    return () => window.clearInterval(timer);
  }, [state.status, expired, repository]);
  if (resetToken) return <AuthCard eyebrow="Password reset" title="Set a new password" intro="Choose a password you’ll remember. This link works once.">
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault(); if (passwordChangeBusy) return;
      const weak = passwordProblem(newPassword);
      if (weak) { setResetMessage(weak); return; }
      setPasswordChangeBusy(true); setResetMessage('');
      try { await repository.resetPassword(resetToken, newPassword); setResetToken(''); setNewPassword(''); setResetMessage('Password changed. Sign in with your new password.'); await session.restore(); }
      catch (error) { setResetMessage(error instanceof ApiError && error.status === 400 && error.code === 'PASSWORD_POLICY' ? error.message : 'This reset link has expired or was already used. Ask your super admin for a new one.'); }
      finally { setPasswordChangeBusy(false); }
    }}>
      {resetMessage && <p role="alert" className="preci-error">{resetMessage}</p>}
      <PasswordField label="New password" autoComplete="new-password" value={newPassword} onChange={setNewPassword} showRules />
      <MorphButton type="submit" variant="primary" size="lg" className="w-full" state={passwordChangeBusy ? 'busy' : 'idle'} busyLabel="Saving…" disabled={!!passwordProblem(newPassword)}>Set password</MorphButton>
      <button type="button" className="preci-link" onClick={() => setResetToken('')}>Back to sign in</button>
    </form>
  </AuthCard>;
  if (state.status === 'authenticated') return <AppProvider apiData={state} apiRepository={repository}>
    {connectionError && <p role="alert" className="px-6 py-2 text-xs text-rose-700">{connectionError}</p>}
    {minutesLeft !== null && !expired && <div role="status" className="session-warning no-print">
      <span className="min-w-0 flex-1">Your session ends in {minutesLeft} minute{minutesLeft === 1 ? '' : 's'}. Save your work.</span>
      <button type="button" className="workspace-control preci-press min-h-9 px-3 text-xs font-semibold text-slate-800" onClick={() => setExpired(true)}>Sign in again</button>
    </div>}
    <div hidden={expired} inert={expired}><RoutedMainLayout repository={repository} onSignOut={() => { setPassword(''); void session.logout(); }} /></div>
    {expired && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-6"><form className="auth-card w-full space-y-4 rounded-2xl bg-white p-6 shadow-xl" onSubmit={async event => {
      event.preventDefault(); if (reauthBusy) return; setReauthBusy(true);
      try {
        const user = await repository.login(state.bootstrap.user.email, reauthPassword);
        if (user.id !== state.bootstrap.user.id) throw new Error('Sign in as the original user to continue.');
        await repository.getCurrentUser();
        setExpired(false); setConnectionError(''); setReauthPassword('');
      } catch (error) { setConnectionError(error instanceof ApiError && error.status === 429 ? (error.message || 'Too many attempts. Try again in a few minutes.') : 'That password didn’t work, or the connection dropped. Check both and try again.'); }
      finally { setReauthBusy(false); }
    }}>
      <div><p className="preci-eyebrow">Session ended</p><h2 className="mt-1 text-xl font-bold text-workspace-ink">Sign in again to keep working</h2>
        <p className="mt-1 text-sm text-workspace-muted">You were signed in as {state.bootstrap.user.name}. Your open page and entries are kept exactly as you left them.</p></div>
      {connectionError && <p role="alert" className="preci-error">{connectionError}</p>}
      <PasswordField label="Password" autoComplete="current-password" value={reauthPassword} onChange={setReauthPassword} />
      <MorphButton type="submit" variant="primary" size="lg" className="w-full" state={reauthBusy ? 'busy' : 'idle'} busyLabel="Signing in…">Restore session</MorphButton>
      <button type="button" className="preci-link" onClick={() => { setExpired(false); void session.logout(); }}>Sign out instead</button>
    </form></div>}
  </AppProvider>;
  if (state.status === 'loading' && !loginBusy && !signupBusy) return <AuthLayout><p role="status" className="text-sm font-semibold text-workspace-muted">Connecting to PreciSign…</p></AuthLayout>;
  if (state.status === 'password-change') return <AuthCard eyebrow="First sign-in" title="Choose a new password" intro={<>Change your temporary password to continue as {state.user.name}.</>}>
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault();
      if (passwordChangeBusy) return;
      const weak = passwordProblem(newPassword, state.user.email);
      if (weak) { setPasswordChangeError(weak); return; }
      setPasswordChangeBusy(true);
      setPasswordChangeError('');
      try {
        await repository.changePassword(password, newPassword);
        setPassword(''); setNewPassword('');
        setResetMessage('Password changed. Sign in with your new password.');
        await session.restore();
      } catch (error) {
        setPasswordChangeError(error instanceof ApiError && error.status === 403 ? 'Your current (temporary) password didn’t match. Check it and try again.' : error instanceof ApiError && error.status === 400 && error.code === 'PASSWORD_POLICY' ? error.message : 'Couldn’t change the password. Check your connection and try again.');
      } finally { setPasswordChangeBusy(false); }
    }}>
      {passwordChangeError && <p role="alert" className="preci-error">{passwordChangeError}</p>}
      <PasswordField label="Current (temporary) password" autoComplete="current-password" value={password} onChange={setPassword} />
      <PasswordField label="New password" autoComplete="new-password" value={newPassword} onChange={setNewPassword} email={state.user.email} showRules />
      <MorphButton type="submit" variant="primary" size="lg" className="w-full" state={passwordChangeBusy ? 'busy' : 'idle'} busyLabel="Saving…" disabled={!!passwordProblem(newPassword, state.user.email) || !password}>Change password</MorphButton>
      <button type="button" className="preci-link" onClick={() => { setPassword(''); setNewPassword(''); void session.logout(); }}>Sign out</button>
    </form>
  </AuthCard>;
  const signatureUser: UserProfile = { id: '', name: name.trim(), email, role: 'Admin', department, initials: '', avatarColor: '#365C78', companyId: 'PEW' };
  return <AuthLayout><form className="preci-auth-form" onSubmit={async (event) => {
    event.preventDefault();
    if (!signup) {
      if (loginBusy) return;
      setLoginBusy(true);
      try { await session.login(email, password); }
      finally { setPassword(''); setLoginBusy(false); }
      return;
    }
    if (signupBusy) return;
    setSignupBusy(true);
    setSignupError('');
    try {
      await repository.signup({ name, email, department, password, signatureDataUrl });
      setSignup(false);
      setPassword('');
      await session.login(email, password);
    } catch (error) {
      setSignupError(error instanceof ApiError && error.status === 409
        ? 'Could not create this account. If you already registered, try signing in.'
        : 'Could not create the account. Check your details and try again.');
    } finally { setSignupBusy(false); }
  }}>
    <div>
      <p className="preci-eyebrow">{signup ? 'Employee registration' : 'Employee access'}</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-workspace-ink sm:text-4xl">{signup ? 'Create your account' : 'Welcome back'}</h1>
      <p className="mt-2 text-sm leading-relaxed text-workspace-muted">{signup ? 'Set up your profile. Your administrator will assign company and form access.' : 'Sign in to review, sign, and track your PreciRoutes.'}</p>
    </div>
    {resetMessage && <p role="status" className="rounded-lg bg-workspace-tint p-3 text-sm text-teal-900">{resetMessage}</p>}
    {signupError && signup && <p role="alert" className="preci-error">{signupError}</p>}
    {state.status === 'failed' && !signup && <p role="alert" className="preci-error">{state.error}</p>}
    <fieldset disabled={signupBusy || loginBusy} className="space-y-4">
      {signup && <div className="grid gap-4 sm:grid-cols-2">
        <label className="preci-field">Name<span className="preci-auth-input"><UserRound aria-hidden="true" /><input autoComplete="name" required maxLength={150} value={name} onChange={e => { setName(e.target.value); setSignatureDataUrl(undefined); }} /></span></label>
        <label className="preci-field">Department<span className="preci-auth-input"><Building2 aria-hidden="true" /><input required maxLength={150} value={department} onChange={e => setDepartment(e.target.value)} /></span></label>
      </div>}
      <label className="preci-field">Email<span className="preci-auth-input"><Mail aria-hidden="true" /><input type="email" autoComplete={signup ? 'email' : 'username'} required value={email} onChange={e => setEmail(e.target.value)} /></span></label>
      <div>
        <PasswordField id="account-password" label="Password" autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={setPassword} email={signup ? email : undefined} showRules={signup} />
        {!signup && <button className="preci-link mt-2" type="button" aria-expanded={forgot} onClick={() => setForgot(value => !value)}>Forgot password?</button>}

        {!signup && forgot && <div className="mt-2 space-y-2 rounded-lg bg-workspace p-3 text-sm text-workspace-muted">
          <p>Super admins can request a reset by email. For other accounts, contact your super admin for a private reset link.</p>
          <button type="button" className="preci-link" disabled={resetRequestBusy || !email.trim()} onClick={async () => {
            setResetRequestBusy(true);
            try {
              await repository.requestPasswordReset(email);
              setResetMessage('If this email belongs to an active super admin, check your inbox for a reset link.');
            } catch {
              setResetMessage('Could not request a reset link. Please try again shortly.');
            } finally {
              setResetRequestBusy(false);
            }
          }}>{resetRequestBusy ? 'Requesting…' : 'Send super admin reset link'}</button>
        </div>}
      </div>
      {signup && <div className="rounded-lg border border-workspace-line bg-workspace/50 p-3">
        <button type="button" className="preci-link flex items-center gap-2" disabled={!name.trim()} onClick={() => setShowSignature(true)}>{signatureDataUrl ? <Check aria-hidden="true" className="size-4" /> : <PenLine aria-hidden="true" className="size-4" />}{signatureDataUrl ? 'Edit saved signature' : 'Add a signature (optional)'}</button>
        {!name.trim() && <p className="mt-1 pl-6 text-xs text-workspace-muted">Enter your name to set up a signature.</p>}
      </div>}
      <MorphButton type="submit" variant="primary" size="lg" className="w-full" icon={ArrowRight}
        state={signupBusy || loginBusy ? 'busy' : 'idle'} busyLabel={signup ? 'Creating account…' : 'Signing in…'}
        disabled={signup && !!passwordProblem(password, email)}>
        {signup ? 'Create account' : 'Sign in'}
      </MorphButton>
    </fieldset>
    <p className="border-t border-workspace-line pt-4 text-center text-sm text-workspace-muted">
      Need an account? Contact your administrator.
    </p>
  </form>
  {showSignature && <SignatureModal isOpen user={signatureUser} title="Set up your signature" confirmLabel="Use this signature" onClose={() => setShowSignature(false)} onConfirm={async value => {
    setSignatureDataUrl(value);
    setShowSignature(false);
    return { success: true };
  }} />}
  </AuthLayout>;
};

export default function App() {
  if (import.meta.env.VITE_DATA_MODE === 'api') {
    if (window.location.pathname === '/document-export') {
      const params = new URLSearchParams(window.location.search);
      const requestId = params.get('request');
      const version = Number(params.get('version'));
      if (!requestId || !Number.isSafeInteger(version) || version < 1) return <p data-pdf-error>Invalid document version.</p>;
      return <RequestPdfView requestId={requestId} version={version} />;
    }
    return <ApiApp />;
  }
  if (import.meta.env.VITE_DATA_MODE && import.meta.env.VITE_DATA_MODE !== 'demo') return <div className="p-6 text-sm" role="alert">Invalid data mode. Check the application configuration.</div>;
  return (
    <AppProvider>
      {!isShowcaseBuild && import.meta.env.VITE_DEMO_NOTICE === 'true' && <p role="status" className="demo-workspace-notice bg-teal-50 px-6 py-2 text-xs text-teal-900">Demo workspace · Changes stay in this browser. Use sample information only.</p>}
      <RoutedMainLayout />
    </AppProvider>
  );
}
