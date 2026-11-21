import React, { useState } from 'react';
import { Link } from 'wouter';
import { useApp } from '../../context/AppContext';
import {
  Inbox,
  FileText,
  House,
  FolderOpen,
  Library,
  Archive,
  Sliders,
  PenTool,
  ChevronDown,
  RotateCcw,
  Shield,
  X,
  CheckCircle2,
  AlertCircle,
  UsersRound,
  ImageIcon,
  PanelLeftClose,
} from 'lucide-react';
import { BrandLockup } from './BrandLockup';
import { AccountMenu } from './AccountMenu';
import { Ticker } from '../common/Ticker';
import { RouteRailMotif } from '../decor/RouteMotifs';
import { canConfigureSigningRoutes } from '../../utils/workflowAdministration';

export const AppSidebar: React.FC<{ canOpenDirectory?: boolean; onSignOut?: () => void; desktopHidden: boolean; onHideDesktop: () => void }> = ({ canOpenDirectory, onSignOut, desktopHidden, onHideDesktop }) => {
  const {
    readOnly,
    activeView,
    setActiveView,
    isMobileSidebarOpen,
    setIsMobileSidebarOpen,
    requestsFilter,
    setRequestsFilter,
    companyRequests,
    currentUser,
    users,
    setCurrentUserId,
    resetDemoData,
    companies,
    signingQueue: pendingApprovals,
    showSigningInbox: showApprovals,
    selectedScope,
  } = useApp();

  const [adminOpen, setAdminOpen] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const pendingApprovalsCount = pendingApprovals.length;
  const scopedCompanies = companies.filter(company => selectedScope === 'PEG' || company.id === selectedScope).map(company => company.id);
  const showRouteSettings = !readOnly || scopedCompanies.some(company => canConfigureSigningRoutes(currentUser, company));

  // Count user's own active requests
  const myRequestsCount = companyRequests.filter(
    (r) => r.requesterId === currentUser.id
  ).length;

  const hasSignature = Boolean(currentUser.signatureDataUrl || currentUser.signatureStyleText);

  const handleNav = (
    view: typeof activeView,
    filter?: 'pending' | 'my' | 'all' | 'approved'
  ) => {
    if (filter) {
      setRequestsFilter(filter);
    }
    setActiveView(view);
    setIsMobileSidebarOpen(false);
  };

  const isMyApprovalsActive =
    activeView === 'requests' && requestsFilter === 'pending';
  const isMyRequestsActive =
    activeView === 'requests' && requestsFilter === 'my';
  const isAllRequestsActive =
    activeView === 'requests' && requestsFilter === 'all';


  React.useEffect(() => {
    if (!isMobileSidebarOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsMobileSidebarOpen(false);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobileSidebarOpen, setIsMobileSidebarOpen]);

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileSidebarOpen && (
        <div
          onClick={() => setIsMobileSidebarOpen(false)}
          className="fixed inset-0 bg-slate-950/60 z-40 lg:hidden backdrop-blur-xs transition-opacity"
          aria-hidden="true"
        />
      )}

      <aside
        id="workspace-sidebar"
        className={`app-sidebar preci-rail w-64 text-slate-200 flex flex-col justify-between shrink-0 h-dvh border-r border-workspace-rail-line select-none fixed inset-y-0 left-0 z-50 ${
          isMobileSidebarOpen ? 'visible translate-x-0 shadow-2xl' : 'invisible -translate-x-full'
        } ${desktopHidden ? 'lg:hidden' : 'lg:sticky lg:top-0 lg:self-start lg:visible lg:translate-x-0 lg:shadow-none lg:z-30'}`}
      >
        <RouteRailMotif className="rail-motif" />
        {/* TOP SECTION: Header & Scrollable Nav */}
        <div className="relative z-10 flex flex-col min-h-0 flex-1">
          {/* Company & Product Header */}
          <div className="h-16 flex items-center justify-between px-4 border-b border-white/12 shrink-0">
            <BrandLockup />
            <button type="button" aria-label="Hide sidebar" title="Hide sidebar" onClick={onHideDesktop}
              className="hidden shrink-0 rounded-md p-1.5 text-slate-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-teal-200 lg:block">
              <PanelLeftClose aria-hidden="true" className="size-4" />
            </button>

            {/* Mobile close button */}
            <button
              onClick={() => setIsMobileSidebarOpen(false)}
              className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-[#24394E]"
              title="Close Navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable Navigation List */}
          <nav data-tour="sidebar-nav" aria-label="Workspace navigation" className="flex-1 space-y-1 overflow-y-auto p-3 text-xs font-medium [&_button:focus-visible]:outline-2 [&_button:focus-visible]:-outline-offset-2 [&_button:focus-visible]:outline-teal-200">
            {/* Section: Workflow Operations */}
            <div className="px-3 py-1.5 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">
              Workspace
            </div>

            <Link
              href="/dashboard"
              onClick={() => handleNav('dashboard', 'all')}
              aria-current={activeView === 'dashboard' ? 'page' : undefined}
              className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-semibold transition-colors ${activeView === 'dashboard' ? 'bg-[#075c70] text-white' : 'text-slate-200 hover:bg-[#24394E]'}`}
            >
              <House aria-hidden="true" className="size-4 shrink-0" /> Overview
            </Link>

            {(!readOnly || companies.length > 0) && <>
            {/* 1. My Approvals */}
            {showApprovals && <Link
              data-tour="nav-approvals"
              href="/requests?filter=pending"
              onClick={() => handleNav('requests', 'pending')}
              aria-current={isMyApprovalsActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md border-s-2 border-transparent transition-colors ${
                isMyApprovalsActive
                  ? 'border-s-teal-300 bg-workspace-rail-selected font-semibold text-white'
                  : 'text-slate-300 hover:bg-[#24394E] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Inbox aria-hidden="true" className={`size-4 shrink-0 ${isMyApprovalsActive ? 'text-teal-200' : 'text-slate-300'}`} />
                <span className="truncate">Needs my action</span>
              </div>
              {pendingApprovalsCount > 0 ? (
                <span className="sidebar-count-badge bg-cyan-200 text-[#12374d] text-[10px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center tabular-nums shadow-xs overflow-hidden">
                  <Ticker value={pendingApprovalsCount} />
                </span>
              ) : (
                <span className="text-[10px] text-slate-400 tabular-nums font-mono">0</span>
              )}
            </Link>}

            {/* 2. My Requests */}
            <Link
              data-tour="nav-my-requests"
              href="/requests?filter=my"
              onClick={() => handleNav('requests', 'my')}
              aria-current={isMyRequestsActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md border-s-2 border-transparent transition-colors ${
                isMyRequestsActive
                  ? 'border-s-teal-300 bg-workspace-rail-selected font-semibold text-white'
                  : 'text-slate-300 hover:bg-[#24394E] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText aria-hidden="true" className={`size-4 shrink-0 ${isMyRequestsActive ? 'text-teal-200' : 'text-slate-300'}`} />
                <span className="truncate">My PreciRoutes</span>
              </div>
              <span className="text-[10px] text-slate-400 tabular-nums font-mono overflow-hidden"><Ticker value={myRequestsCount} /></span>
            </Link>

            {/* 4. All Requests */}
            <Link
              href="/requests?filter=all"
              onClick={() => handleNav('requests', 'all')}
              aria-current={isAllRequestsActive ? 'page' : undefined}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-md border-s-2 border-transparent transition-colors ${
                isAllRequestsActive
                  ? 'border-s-teal-300 bg-workspace-rail-selected font-semibold text-white'
                  : 'text-slate-300 hover:bg-[#24394E] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <FolderOpen aria-hidden="true" className={`size-4 shrink-0 ${isAllRequestsActive ? 'text-teal-200' : 'text-slate-300'}`} />
                <span className="truncate">All routes</span>
              </div>
              <span className="text-[10px] text-slate-400 tabular-nums font-mono">{companyRequests.length}</span>
            </Link>

            {/* Section: Documents & Repositories */}
            <div className="pt-3 px-3 py-1.5 text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">
              Documents
            </div>

            {/* 5. Forms Library */}
            <Link
              href="/forms"
              onClick={() => handleNav('forms-library')}
              aria-current={activeView === 'forms-library' ? 'page' : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md border-s-2 border-transparent transition-colors ${
                activeView === 'forms-library'
                  ? 'border-s-teal-300 bg-workspace-rail-selected font-semibold text-white'
                  : 'text-slate-300 hover:bg-[#24394E] hover:text-white'
              }`}
            >
              <Library className="w-4 h-4 shrink-0 text-slate-300" />
              <span className="truncate">Forms Library</span>
            </Link>

            {/* 6. Archive */}
            <Link
              data-tour="nav-archive"
              href="/archive"
              onClick={() => handleNav('archive')}
              aria-current={activeView === 'archive' ? 'page' : undefined}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md border-s-2 border-transparent transition-colors ${
                activeView === 'archive'
                  ? 'border-s-teal-300 bg-workspace-rail-selected font-semibold text-white'
                  : 'text-slate-300 hover:bg-[#24394E] hover:text-white'
              }`}
            >
              <Archive className="w-4 h-4 shrink-0 text-slate-300" />
              <span className="truncate">Archive &amp; Register</span>
            </Link>

            </>}
            {(canOpenDirectory || !readOnly || showRouteSettings) && <div className="mt-3 border-t border-white/12 pt-2">
              <button
                onClick={() => setAdminOpen(!adminOpen)}
                aria-expanded={adminOpen}
                className="w-full flex items-center justify-between px-3 py-1.5 text-slate-400 hover:text-slate-200 uppercase tracking-wider text-[10px] font-extrabold"
              >
                <span>Administration</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 motion-safe:transition-transform motion-safe:duration-150 ${adminOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {adminOpen && (
                <div className="mt-1 space-y-1">
                  {showRouteSettings && <Link
                    data-tour="nav-signing-routes"
                    href="/settings/signing-routes"
                    onClick={() => handleNav('workflow-settings')}
                    aria-current={activeView === 'workflow-settings' ? 'page' : undefined}
                    className="preci-nav-item"
                  >
                    <Sliders className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">Signing routes</span>
                  </Link>}
                  {canOpenDirectory && <Link
                    data-tour="nav-directory"
                    href="/settings/users"
                    onClick={() => handleNav('user-directory')}
                    aria-current={activeView === 'user-directory' ? 'page' : undefined}
                    className="preci-nav-item"
                  >
                    <UsersRound aria-hidden="true" className="size-4 shrink-0" /> User directory
                  </Link>}
                  {canOpenDirectory && <Link
                    href="/settings/branding"
                    onClick={() => handleNav('company-branding')}
                    aria-current={activeView === 'company-branding' ? 'page' : undefined}
                    className="preci-nav-item"
                  >
                    <ImageIcon aria-hidden="true" className="size-4 shrink-0" /> Company branding
                  </Link>}
                </div>
              )}
            </div>}
                  <Link
                    data-tour="nav-profile"
                    href="/settings/profile"
                    onClick={() => handleNav('user-profile')}
                    aria-current={activeView === 'user-profile' ? 'page' : undefined}
                    className="preci-nav-item justify-between"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <PenTool className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">Signature &amp; profile</span>
                    </div>
                    {hasSignature ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                    )}
                  </Link>
          </nav>
        </div>

        {/* BOTTOM FIXED FOOTER: User Persona Card */}
        <div className="p-3 border-t border-workspace-rail-line bg-workspace-rail-deep shrink-0 space-y-2">
          {/* Current User Card */}
          {readOnly ? <AccountMenu inSidebar onSignOut={onSignOut} /> : <div className="relative">
            <button
              onClick={() => { if (!readOnly) setShowUserMenu(!showUserMenu); }}
              className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-[#24394E] transition-colors text-left border border-[#24394E] hover:border-[#365C78] bg-[#182838]/60"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="relative shrink-0">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0 border border-white/20 shadow-xs"
                    style={{ backgroundColor: currentUser.avatarColor || '#365C78' }}
                  >
                    {currentUser.initials}
                  </div>
                  {/* Signature status indicator badge */}
                  <div
                    className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#12202D] flex items-center justify-center ${
                      hasSignature ? 'bg-emerald-500' : 'bg-amber-500'
                    }`}
                    title={hasSignature ? 'Signature Configured' : 'Signature Required'}
                  />
                </div>
                <div className="min-w-0 leading-tight">
                  <div className="text-xs font-bold text-white truncate flex items-center gap-1">
                    <span>{currentUser.name}</span>
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {currentUser.role} · {currentUser.department}
                  </div>
                  <div className="text-[9px] flex items-center gap-1 mt-0.5">
                    {hasSignature ? (
                      <span className="text-emerald-400 font-medium flex items-center gap-0.5">
                        <CheckCircle2 className="w-2.5 h-2.5" /> Signature Ready
                      </span>
                    ) : (
                      <span className="text-amber-400 font-medium flex items-center gap-0.5">
                        <AlertCircle className="w-2.5 h-2.5" /> No Signature
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 ml-1 transition-transform ${showUserMenu ? 'rotate-180' : ''}`} />
            </button>

            {/* Quick Persona Switcher popover */}
            {!readOnly && showUserMenu && (
              <div className="absolute bottom-full left-0 right-0 mb-2 bg-[#192B3C] border border-[#365C78] rounded-xl shadow-2xl p-2.5 z-50 space-y-2">
                <div className="px-1 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#5B8FB9] flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Shield className="w-3.5 h-3.5 text-amber-400" /> Switch Demo Persona
                  </span>
                  <span className="text-[9px] text-slate-400 font-normal">Role Test</span>
                </div>
                
                <p className="px-1 text-[10px] text-slate-400 leading-tight">
                  Switch persona to evaluate stage approvals, signature authorization, and permissions:
                </p>

                <div className="max-h-48 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                  {users.map((u) => {
                    const isSelected = u.id === currentUser.id;
                    return (
                      <button
                        key={u.id}
                        onClick={() => {
                          setCurrentUserId(u.id);
                          setShowUserMenu(false);
                        }}
                        className={`w-full flex items-center justify-between p-1.5 rounded-lg text-xs transition-colors ${
                          isSelected
                            ? 'bg-[#365C78] text-white font-semibold ring-1 ring-[#5B8FB9]'
                            : 'text-slate-300 hover:bg-[#24394E] hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2 truncate min-w-0">
                          <span
                            className="w-6 h-6 rounded-full text-[10px] flex items-center justify-center font-bold text-white shrink-0 border border-white/20"
                            style={{ backgroundColor: u.avatarColor || '#365C78' }}
                          >
                            {u.initials}
                          </span>
                          <div className="min-w-0 text-left leading-tight">
                            <div className="truncate font-semibold">{u.name}</div>
                            <div className="text-[9px] text-slate-300/80 truncate">
                              {u.role} ({u.companyId})
                            </div>
                          </div>
                        </div>
                        {isSelected && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 ml-1" />}
                      </button>
                    );
                  })}
                </div>

                {/* Direct Action Links */}
                <div className="pt-2 border-t border-[#24394E] space-y-1">
                  <button
                    onClick={() => {
                      handleNav('user-profile');
                      setShowUserMenu(false);
                    }}
                    className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-medium text-slate-200 bg-[#24394E] hover:bg-[#365C78] rounded-md transition-colors"
                  >
                    <PenTool className="w-3 h-3 text-[#5B8FB9]" />
                    <span>Manage Signature &amp; profile</span>
                  </button>

                  <button
                    onClick={() => {
                      resetDemoData();
                      setShowUserMenu(false);
                    }}
                    className="w-full flex items-center justify-center gap-1.5 py-1 text-[10px] font-medium text-slate-400 hover:text-rose-300 hover:bg-rose-950/40 rounded transition-colors"
                  >
                    <RotateCcw className="w-3 h-3 text-rose-400" />
                    <span>Reset All Demo Data</span>
                  </button>
                </div>
              </div>
            )}
          </div>}
        </div>
      </aside>
    </>
  );
};

