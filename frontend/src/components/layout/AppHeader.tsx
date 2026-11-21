import { setFaviconBadge } from '../../utils/faviconBadge';
import { isShowcaseBuild } from '../../config/demo';
import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { CompanyId } from '../../types/index';
import { AccountMenu } from './AccountMenu';
import { requestProductTour } from '../tour/useProductTour';
import {
  Building2,
  ChevronDown,
  Search,
  Bell,
  HelpCircle,
  ShieldCheck,
  Check,
  Menu,
  PanelLeft,
} from 'lucide-react';

function getHeaderRequestDescription(req: { title?: string; formData?: unknown }): string {
  const form = (req.formData ?? {}) as Record<string, unknown>;
  return String(req.title || form.workDescription || form.purpose || form.description || '');
}

export const AppHeader: React.FC<{ onSignOut?: () => void; sidebarHidden: boolean; onToggleSidebar: () => void }> = ({ onSignOut, sidebarHidden, onToggleSidebar }) => {
  const {
    readOnly,
    companies,
    signingQueue: pendingApprovals,
    showSigningInbox: showApprovals,
    selectedScope,
    selectedCompany,
    setSelectedScope,
    currentUser,
    users,
    setCurrentUserId,
    companyRequests,
    openReviewRequest,
    setIsMobileSidebarOpen,
  } = useApp();

  const [companyDropdownOpen, setCompanyDropdownOpen] = useState(false);
  const [personaDropdownOpen, setPersonaDropdownOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');

  const companyDropdownRef = useRef<HTMLDivElement>(null);
  const personaDropdownRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (companyDropdownRef.current && !companyDropdownRef.current.contains(e.target as Node)) {
        setCompanyDropdownOpen(false);
      }
      if (personaDropdownRef.current && !personaDropdownRef.current.contains(e.target as Node)) {
        setPersonaDropdownOpen(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(e.target as Node)) {
        setNotificationsOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setCompanyDropdownOpen(false);
        setPersonaDropdownOpen(false);
        setNotificationsOpen(false);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const isGroupView = selectedScope === 'PEG';
  // The bell rings once when something new needs action, never on first paint or on every render.
  const previousPending = React.useRef<number | null>(null);
  const [bellRinging, setBellRinging] = React.useState(false);
  React.useEffect(() => {
    const count = pendingApprovals.length;
    if (previousPending.current !== null && previousPending.current === 0 && count > 0) {
      setBellRinging(true);
      const timer = window.setTimeout(() => setBellRinging(false), 800);
      previousPending.current = count;
      return () => window.clearTimeout(timer);
    }
    previousPending.current = count;
    return undefined;
  }, [pendingApprovals.length]);
  // Browser tab: a dot on the icon while something needs action (the page title stays PageTitle's).
  React.useEffect(() => { setFaviconBadge(pendingApprovals.length > 0); }, [pendingApprovals.length]);
  React.useEffect(() => () => setFaviconBadge(false), []);

  // Search results for global dropdown
  const searchResults = globalSearch.trim()
    ? companyRequests.filter((r) => {
        const q = globalSearch.toLowerCase();
        const desc = getHeaderRequestDescription(r);
        return (
          r.id.toLowerCase().includes(q) ||
          r.requesterName.toLowerCase().includes(q) ||
          desc.toLowerCase().includes(q)
        );
      })
    : [];

  return (
    <header className="app-header sticky top-0 z-20 flex h-16 items-center justify-between gap-2 border-b border-workspace-line bg-white px-3 sm:gap-4 sm:px-6">
      {/* Left: Organization / Company Context (Demo Tenant Selector) */}
      <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
        {/* Mobile / Tablet Drawer toggle */}
        <button
          onClick={() => setIsMobileSidebarOpen(true)}
          className="lg:hidden p-1.5 rounded-md text-slate-600 hover:text-[#192B3C] hover:bg-[#F5F6F8] focus:outline-none focus:ring-1 focus:ring-[#365C78] shrink-0"
          aria-label="Open Navigation Menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <button type="button" onClick={onToggleSidebar} aria-controls="workspace-sidebar" aria-expanded={!sidebarHidden}
          aria-label={sidebarHidden ? 'Show sidebar' : 'Toggle sidebar'} title={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}
          className="preci-icon-button hidden shrink-0 lg:inline-grid">
          <PanelLeft aria-hidden="true" />
        </button>

        {(!readOnly || companies.length > 0) ? <div ref={companyDropdownRef} className="relative min-w-0">
          <button
            data-tour="company-switcher"
            onClick={() => setCompanyDropdownOpen(!companyDropdownOpen)}
            aria-expanded={companyDropdownOpen}
            aria-label={'Viewing ' + (isGroupView ? 'Precision Engineering Group (Group View)' : selectedCompany.fullName) + '. Change company'}
            className="workspace-control flex min-h-9 max-w-full items-center gap-2 px-2.5 text-xs font-semibold sm:px-3"
            title="Active Viewing Scope / Organization"
          >
            <Building2 aria-hidden="true" className="size-4 shrink-0 text-workspace-steel" />
            <span className="font-mono sm:hidden">{isGroupView ? 'Group' : selectedCompany.id}</span>
            <span className="hidden truncate sm:inline sm:max-w-[210px] md:max-w-[260px]">
              {isGroupView ? 'PRECISION ENGINEERING GROUP' : selectedCompany.fullName}
            </span>
            <span className={`hidden sm:inline-block text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded border uppercase shrink-0 ${
              isGroupView
                ? 'border-teal-200 bg-workspace-tint text-workspace-teal'
                : 'border-workspace-line bg-workspace text-workspace-steel'
            }`}>
              {isGroupView ? 'Group View' : 'Company View'}
            </span>
            <ChevronDown className="w-3 h-3 text-slate-500 shrink-0" />
          </button>

          {companyDropdownOpen && (
            <div className="preci-popover origin-top-left workspace-panel absolute top-full left-0 z-50 mt-2 w-84 max-w-[calc(100vw-4rem)] p-2">
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                Parent Organization:
              </div>
              <button
                onClick={() => {
                  setSelectedScope('PEG');
                  setCompanyDropdownOpen(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors flex items-center justify-between mb-2 ${
                  isGroupView
                    ? 'border border-teal-200 bg-workspace-tint font-bold text-workspace-teal'
                    : 'text-slate-800 hover:bg-slate-100'
                }`}
              >
                <div>
                  <div className="font-semibold flex items-center gap-1.5">
                    <Building2 aria-hidden="true" className="size-4 shrink-0 text-workspace-steel" />
                    <span>Precision Engineering Group</span>
                  </div>
                  <div className="text-[10px] text-slate-500">All companies you can access</div>
                </div>
                {isGroupView && <Check aria-hidden="true" className="size-3.5 shrink-0 text-workspace-teal" />}
              </button>

              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-t border-[#E2E5E9] pt-2">
                Companies:
              </div>
              <div className="space-y-1 mt-1">
                {companies.map((company) => (
                  <button
                    key={company.id}
                    onClick={() => {
                      setSelectedScope(company.id as CompanyId);
                      setCompanyDropdownOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors flex items-center justify-between ${
                      !isGroupView && company.id === selectedScope
                        ? 'bg-[#EBF2F7] text-[#192B3C] font-bold border border-[#C2D5E3]'
                        : 'text-slate-700 hover:bg-[#F5F6F8]'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200/80 text-slate-700 shrink-0">{company.id}</span>
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{company.name}</div>
                        <div className="text-[10px] text-slate-500 truncate">{company.fullName !== company.name ? company.fullName : company.groupName}</div>
                      </div>
                    </div>
                    {!isGroupView && company.id === selectedScope && (
                      <Check className="w-3.5 h-3.5 text-[#365C78] shrink-0" />
                    )}
                  </button>
                ))}
              </div>
              <div className="mt-2 pt-2 border-t border-[#E2E5E9] px-2 text-[10px] text-slate-500">
                Choose a company to focus your view. Your access stays the same.
              </div>
            </div>
          )}
        </div> : <span className="truncate text-xs font-semibold text-workspace-muted">Account workspace</span>}
      </div>

      {/* Center: Global Search Bar */}
      <div className="flex-1 max-w-xl hidden md:block relative">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-workspace-muted" />
          <input
            type="text"
            data-tour="search"
            aria-label="Search all requests"
            placeholder="Search request ID, requester, or work description..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="workspace-control min-h-9 w-full bg-workspace pl-9 pr-3 text-xs placeholder:text-workspace-muted focus:bg-white lg:pr-16"
          />
          <button type="button" title="Jump to a page, form or request" aria-label="Open quick search"
            onClick={() => window.dispatchEvent(new Event('precisign:command-palette'))}
            className="command-kbd preci-press absolute right-2 top-1/2 hidden -translate-y-1/2 lg:inline-block">
            {typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}
          </button>
        </div>

        {/* Search Results Popover */}
        {globalSearch.trim() && (
          <div className="preci-popover origin-top absolute top-full left-0 right-0 mt-1 bg-white border border-[#E2E5E9] rounded-lg shadow-xl p-2 z-50 max-h-72 overflow-y-auto">
            <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Matching Requests ({searchResults.length}):
            </div>
            {searchResults.length === 0 ? (
              <div className="p-3 text-xs text-slate-400 text-center">No matching documents found.</div>
            ) : (
              <div className="space-y-1 mt-1">
                {searchResults.map((req) => (
                  <button
                    key={req.id}
                    onClick={() => {
                      openReviewRequest(req.id);
                      setGlobalSearch('');
                    }}
                    className="w-full text-left p-2 rounded hover:bg-[#F5F6F8] text-xs transition-colors flex items-center justify-between"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-semibold text-[#192B3C] truncate">{req.id} · {getHeaderRequestDescription(req).slice(0, 45)}...</div>
                      <div className="text-[10px] text-slate-500">Requester: {req.requesterName} · {req.department}</div>
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 bg-slate-50 text-slate-700 border-slate-200">
                      {req.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Demo Persona Switcher + Notifications + Active User */}
      <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
        {/* Explicit Demo User Persona Selector */}
        {!readOnly && !isShowcaseBuild && <div ref={personaDropdownRef} className="relative">
          <button
            onClick={() => setPersonaDropdownOpen(!personaDropdownOpen)}
            className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1.5 rounded-md border border-[#365C78]/30 bg-[#EBF2F7] text-[#192B3C] hover:bg-[#DEEAF3] transition-colors text-xs font-medium"
            title="Switch demo persona to test approver permissions"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-[#365C78] shrink-0" />
            <span className="font-semibold truncate max-w-[80px] sm:max-w-none">{currentUser.name}</span>
            <span className="hidden md:inline text-[10px] text-slate-500">({currentUser.role})</span>
            <ChevronDown className="w-3 h-3 text-slate-600 shrink-0" />
          </button>

          {personaDropdownOpen && (
            <div className="absolute top-full right-0 mt-1 w-80 bg-white border border-[#E2E5E9] rounded-lg shadow-xl p-2 z-50">
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 border-b border-[#E2E5E9] pb-1.5 mb-1.5">
                Switch Role / Approver Persona:
              </div>
              <div className="max-h-72 overflow-y-auto space-y-1">
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => {
                      setCurrentUserId(u.id);
                      setPersonaDropdownOpen(false);
                    }}
                    className={`w-full flex items-center justify-between p-2 rounded text-xs transition-colors text-left ${
                      u.id === currentUser.id
                        ? 'bg-[#EBF2F7] text-[#192B3C] font-semibold border border-[#C2D5E3]'
                        : 'hover:bg-[#F5F6F8] text-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                        style={{ backgroundColor: u.avatarColor || '#365C78' }}
                      >
                        {u.initials}
                      </div>
                      <div>
                        <div className="font-medium text-[#192B3C]">{u.name}</div>
                        <div className="text-[10px] text-slate-500">{u.role} · {u.department}</div>
                      </div>
                    </div>
                    {u.id === currentUser.id && <Check className="w-3.5 h-3.5 text-[#365C78]" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>}

        {/* Notifications Popover */}
        {showApprovals && <div ref={notificationsRef} className="relative">
          <button
            onClick={() => setNotificationsOpen(!notificationsOpen)}
            className={(bellRinging ? 'bell-ring ' : '') + "bell-button preci-press relative p-2 rounded-md text-slate-600 hover:text-[#192B3C] hover:bg-[#F5F6F8] transition-colors border border-transparent hover:border-[#E2E5E9]"}
            title={`${pendingApprovals.length} pending approvals`}
          >
            <Bell aria-hidden="true" className="bell-icon w-4 h-4" />
            {pendingApprovals.length > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white" />
            )}
          </button>

          {notificationsOpen && (
            <div className="preci-popover origin-top-right absolute top-full right-0 mt-1 w-80 max-w-[calc(100vw-5.25rem)] bg-white border border-[#E2E5E9] rounded-lg shadow-xl p-3 z-50">
              <div className="flex items-center justify-between pb-2 border-b border-[#E2E5E9]">
                <span className="text-xs font-bold text-[#192B3C]">Actionable Items</span>
                <span className="text-[10px] font-semibold text-[#365C78] bg-[#EBF2F7] px-1.5 py-0.5 rounded">
                  {pendingApprovals.length} Pending
                </span>
              </div>
              <div className="mt-2 space-y-1.5 max-h-60 overflow-y-auto">
                {pendingApprovals.length === 0 ? (
                  <div className="text-center py-4 text-xs text-slate-400">
                    No requests currently awaiting your approval.
                  </div>
                ) : (
                  pendingApprovals.map((req) => (
                    <button
                      key={req.id}
                      onClick={() => {
                        openReviewRequest(req.id);
                        setNotificationsOpen(false);
                      }}
                      className="w-full text-left p-2 rounded hover:bg-[#F5F6F8] border border-[#E2E5E9] text-xs transition-colors"
                    >
                      <div className="flex items-center justify-between font-semibold text-[#192B3C]">
                        <span>{req.id}</span>
                        <span className={`text-[9px] px-1 rounded ${req.formData.priority === 'Urgent' ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'}`}>
                          {req.formData.priority}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-600 truncate mt-0.5">{getHeaderRequestDescription(req)}</div>
                      <div className="text-[10px] text-slate-400 mt-1">Submitted by {req.requesterName}</div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>}

        <button type="button" data-tour="tour-replay" onClick={requestProductTour}
          aria-label="Take the product tour" title="Take the product tour" className="preci-icon-button inline-grid shrink-0">
          <HelpCircle aria-hidden="true" />
        </button>

        <AccountMenu onSignOut={onSignOut} />
      </div>
    </header>
  );
};
