import { ActionButton } from '../create/RequestEditorControls';
import { hasProcessorHandoff, hasReadHandoff } from '../../../../shared/utils/processorHandoff';
import { filterDashboardRequests } from '../../utils/dashboardFilters';
import { isShowcaseBuild } from '../../config/demo';
import { getInitials } from '../../utils/approvalJourney';
import { needsMyAction } from '../../utils/actionQueue';
import { needsProcessingAction } from '../../utils/routeProcessing';
import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { RequestRecord, PriorityLevel } from '../../types/index';
import {
  Inbox,
  FileText,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Search,
  SlidersHorizontal,
  ChevronDown,
  RefreshCw,
  Plus,
  ArrowRight,
  Check,
  Building,
  ChevronRight,
  LayoutGrid,
} from 'lucide-react';
import { companyForms } from '../library/FormsLibraryView';
import { canUserStartForm } from '../../utils/companyAccess';
import { CompactApprovalChain } from '../common/CompactApprovalChain';
import { ApprovalJourneyModal } from '../common/ApprovalJourneyModal';
import { canOfferEarlyCompletion } from '../journey/RouteProgress';
import { RequestJourneySummary } from './RequestJourneySummary';
import { RequestActivity } from './RequestActivity';
import { EmptyState } from '../common/EmptyState';
import { formatRequestId } from '../../utils/requestId';
import { RouteCornerMotif, RouteHeaderMotif } from '../decor/RouteMotifs';
import { FormGlyph } from '../decor/FormGlyphs';
import { useMorphState } from '../common/MorphButton';
import { Ticker } from '../common/Ticker';
import { placePill } from '../common/useSlidingPill';
import { BottomSheet } from '../common/BottomSheet';
import { RevealOnMount } from '../common/RevealOnMount';
import { FirstRouteGuide } from './FirstRouteGuide';
import { RequestHoverPreview } from '../common/RequestHoverPreview';
import { openWithTitleTransition } from '../../utils/viewTransition';

function getRequestTitle(req: { title?: string; formData?: Record<string, any> }): string {
  return (
    req.title ||
    req.formData?.workDescription ||
    req.formData?.purpose ||
    req.formData?.description ||
    req.formData?.title ||
    'Request details'
  );
}

export const DashboardView: React.FC = () => {
  const {
    activeView,
    currentUser,
    draftFormData,
    readOnly: connected,
    refreshRequests,
    companyRequests,
    selectedCompany,
    selectedScope,
    companies,
    signingQueue: pendingForMeRequests,
    showSigningInbox: showApprovals,
    setActiveView,
    requestsFilter,
    setRequestsFilter,
    openReviewRequest,
    setSelectedRequestFormType,
  } = useApp();
  const formShortcuts = companyForms.filter(form => (!connected && !isShowcaseBuild) || companies.some(company =>
    (selectedScope === 'PEG' || selectedScope === company.id) && canUserStartForm(currentUser, company.id, form.name)));

  const [searchQuery, setSearchQuery] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('search') || '';
    }
    return '';
  });

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (query.trim()) {
        url.searchParams.set('search', query.trim());
      } else {
        url.searchParams.delete('search');
      }
      window.history.replaceState(window.history.state, '', url.pathname + url.search);
    }
  };
  const [formFilter,setFormFilter] = useState('ALL');
  const [statusFilter,setStatusFilter] = useState('ALL');
  const hasFilters = Boolean(searchQuery.trim()) || formFilter !== 'ALL' || statusFilter !== 'ALL';
  const [refreshError, setRefreshError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const refreshState = useMorphState(refreshing, Boolean(refreshError));
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [sortBy, setSortBy] = useState<'date-desc' | 'date-asc' | 'priority' | 'id'>('date-desc');
  const [selectedJourneyRequest, setSelectedJourneyRequest] = useState<RequestRecord | null>(null);
  const otherActions = companyRequests.filter(request => request.status !== 'Returned for Correction' &&
    (request.pendingReplacement?.newUserId === currentUser.id || needsProcessingAction(request, currentUser) ||
      (request.approvalSteps.at(-1)?.status === 'Approved' && canOfferEarlyCompletion(request, currentUser.id))));
  const assignedHandoffs = companyRequests.filter(request => hasProcessorHandoff(request, currentUser.id));
  // Shown only when something is assigned; the processor right itself is visible in Access Rights.
  const showProcessorQueue = assignedHandoffs.length > 0;
  const unopenedHandoffs = assignedHandoffs.filter(request => !hasReadHandoff(request, currentUser.id)).length;
  const [internalTab, setInternalTab] = useState<'pending' | 'my' | 'all' | 'returned' | 'approved' | 'awaiting' | 'completed'>(
    activeView === 'dashboard' ? (showApprovals ? 'all' : 'my') : requestsFilter === 'pending'
      ? 'pending'
      : requestsFilter === 'my'
      ? 'my'
      : requestsFilter === 'approved'
      ? 'approved'
      : 'all'
  );

  // Sliding pill behind the pressed tab: measured from the DOM, moved with transform only.
  const tabsRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const pillOn = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    // Appears in place on first paint and follows resizes instantly; only a tab change slides.
    const place = (fromResize: boolean) => {
      const pressed = tabsRef.current?.querySelector<HTMLElement>('.dash-tab[aria-pressed="true"]');
      const pill = pillRef.current;
      if (!pill) return;
      if (!pressed) { pill.style.opacity = '0'; pillOn.current = null; return; }
      const animate = !fromResize && pillOn.current !== null && pillOn.current !== pressed;
      pillOn.current = pressed;
      placePill(pill, () => {
        pill.style.opacity = '1';
        pill.style.width = pressed.offsetWidth + 'px';
        pill.style.transform = 'translateX(' + pressed.offsetLeft + 'px)';
      }, animate);
    };
    place(false);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => place(true));
    if (tabsRef.current) observer?.observe(tabsRef.current);
    return () => observer?.disconnect();
  });

  // The same three controls render inline on wider screens and in the bottom sheet on phones.
  const filterControls = (place: 'inline' | 'sheet') => {
    const cls = place === 'sheet' ? 'workspace-control min-h-11 w-full px-3' : 'workspace-control min-h-8 max-w-32 px-2';
    return <>
      <select aria-label="Filter by form type" value={formFilter} onChange={e => setFormFilter(e.target.value)} className={cls}><option value="ALL">All form types</option>{[...new Set(companyRequests.map(r => r.formType))].map(type => <option key={type}>{type}</option>)}</select>
              <select aria-label="Filter by signing status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={cls}><option value="ALL">All statuses</option>{['Pending Approval','Returned for Correction','Approved','Rejected','Cancelled'].map(status => <option key={status} value={status}>{status === 'Approved' ? 'Signing completed' : status}</option>)}</select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                aria-label="Sort Requests By"
                className={place === 'sheet' ? cls : 'workspace-control min-h-8 px-2 text-xs font-medium'}
              >
                <option value="date-desc">Newest First</option>
                <option value="date-asc">Oldest First</option>
                <option value="priority">Priority Order</option>
                <option value="id">Request ID</option>
              </select>
    </>;
  };

  // Column visibility state
  const [visibleColumns, setVisibleColumns] = useState({
    id: true,
    formType: true,
    company: true,
    requester: true,
    currentApprover: true,
    prioritySla: false,
    status: true,
    createdAt: false,
  });

  const columnsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showColumnsMenu) return;
    function handlePointerDown(e: PointerEvent) {
      if (columnsMenuRef.current && !columnsMenuRef.current.contains(e.target as Node)) {
        setShowColumnsMenu(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowColumnsMenu(false);
    }
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showColumnsMenu]);


  function actionFor(request: RequestRecord) {
    if (request.status === 'Returned for Correction' && request.requesterId === currentUser.id) {
      return { title: 'A request needs your corrections', label: 'Review correction' };
    }
    if (needsProcessingAction(request, currentUser)) {
      return { title: 'A request needs processing', label: 'Process request' };
    }
    if (request.pendingReplacement?.newUserId === currentUser.id && request.status === 'Pending Approval') {
      return { title: 'An assignment needs your response', label: 'Respond to assignment' };
    }
    if (needsMyAction(request, currentUser)) {
      return { title: 'A route needs your signature', label: 'Review & sign' };
    }
    if (canOfferEarlyCompletion(request, currentUser.id) && request.approvalSteps.at(-1)?.status === 'Approved') {
      return { title: 'You’ve signed this request', label: 'Review completion' };
    }
    return { title: request.formType, label: 'View details' };
  }

  const returnedRequests = useMemo(() => {
    return companyRequests.filter((r) => r.status === 'Returned for Correction' && r.requesterId === currentUser.id);
  }, [companyRequests, currentUser.id]);

  const approvedRequests = useMemo(() => {
    return companyRequests.filter((r) => r.status === 'Approved' && r.requesterId === currentUser.id);
  }, [companyRequests, currentUser.id]);

  const myRequests = useMemo(() => {
    return companyRequests.filter((r) => r.requesterId === currentUser.id);
  }, [companyRequests, currentUser]);

  // Keep internal tab in sync if sidebar filter changed
  React.useEffect(() => {
    if (activeView === 'dashboard') return;
    if (requestsFilter === 'pending') setInternalTab('pending');
    else if (requestsFilter === 'my') setInternalTab('my');
    else if (requestsFilter === 'approved') setInternalTab('approved');
    else if (requestsFilter === 'all') setInternalTab('all');
  }, [activeView, requestsFilter]);

  function selectTab(tab: typeof internalTab) {
    setInternalTab(tab);
    if (activeView === 'requests') {
      if (tab === 'pending' || tab === 'my' || tab === 'all' || tab === 'approved') setRequestsFilter(tab);
      else return;
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        url.searchParams.set('filter', tab);
        window.history.replaceState(window.history.state, '', url.pathname + url.search);
      }
    }
  }

  // Filter & sort requests for the operational table
  const filteredRequests = useMemo(() => filterDashboardRequests({
    internalTab, pendingForMeRequests, myRequests, returnedRequests, approvedRequests, companyRequests, searchQuery, sortBy, formFilter, statusFilter
  }), [internalTab, pendingForMeRequests, myRequests, returnedRequests, approvedRequests, companyRequests, searchQuery, sortBy, formFilter, statusFilter]);

  const isRecentView = activeView === 'dashboard' && internalTab === 'all' && !hasFilters && sortBy === 'date-desc';
  const displayedRequests = isRecentView ? filteredRequests.slice(0, 5) : filteredRequests;

  const getSlaDescription = (priority: PriorityLevel) => {
    switch (priority) {
      case 'Urgent':
        return '< 1 hr (Immediate)';
      case 'Medium':
        return '3 business days';
      case 'Low':
        return '7 business days';
      default:
        return 'Standard';
    }
  };

  return (
    <div className="dashboard-workspace p-3.5 sm:p-6 space-y-5 max-w-[1720px] mx-auto">
      {/* Top Section: Operational Status & Primary Action */}
      <div className="dashboard-hero flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <RouteHeaderMotif className="dashboard-hero-motif" />
        <div className="relative min-w-0">
          <p className="preci-eyebrow dash-eyebrow mb-1">Inbox</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="dash-greeting text-2xl font-bold tracking-tight text-workspace-ink sm:text-[1.75rem] sm:leading-9">
              {activeView === 'dashboard' ? <>Welcome back, {currentUser.name.trim().split(/\s+/)[0]} <span className="dash-wave" aria-hidden="true">👋</span></> : 'Requests'}
            </h1>
          </div>
          <p className="mt-1 text-sm text-workspace-muted">
            {pendingForMeRequests.length > 0
              ? `${pendingForMeRequests.length} ${pendingForMeRequests.length === 1 ? 'request is' : 'requests are'} waiting for you.`
              : 'Create, review and track company forms in one place.'}
          </p>
        </div>

        <div className="relative flex flex-wrap items-center gap-2 sm:justify-end">
          {connected && (
            <button
              type="button"
              aria-label="Refresh requests"
              title="Refresh requests"
              aria-busy={refreshing}
              disabled={refreshing}
              className="workspace-control preci-press preci-icon-button dash-refresh grid size-11 shrink-0 place-items-center"
              onClick={async () => {
                setRefreshing(true);
                setRefreshError('');
                try {
                  await refreshRequests();
                } catch {
                  setRefreshError('Could not refresh requests. Your current list is retained. Please retry.');
                } finally {
                  setRefreshing(false);
                }
              }}
            >
              <span className="icon-morph" aria-hidden="true">
                <RefreshCw data-active={refreshState !== 'done'} className={'size-4' + (refreshing ? ' dash-spin' : '')} />
                <Check data-active={refreshState === 'done'} className="size-4 text-teal-700" />
              </span>
            </button>
          )}
          <ActionButton
            data-tour="new-request"
            variant="primary"
            size="lg"
            icon={Plus}
            onClick={() => setActiveView('forms-library')}
          >
            New PreciRoute
          </ActionButton>
        </div>
      </div>

      {refreshError && <p role="alert" className="text-xs text-rose-700">{refreshError}</p>}
      <section aria-label="Request summary" className="inbox-summary grid grid-cols-1 gap-2.5 min-[360px]:grid-cols-2 lg:grid-cols-4">
        {([
          // Signers see their own action first; requester-only accounts never get this card.
          ['Needs my action', pendingForMeRequests.length, 'pending', Inbox, 'inbox'],
          ['My requests', myRequests.length, 'my', FileText, 'open'],
          ['Returned requests', returnedRequests.length, 'returned', RotateCcw, 'returned'],
          ['Signing completed', approvedRequests.length, 'approved', CheckCircle2, 'complete'],
        ] as const).filter(([, , tab]) => tab !== 'pending' || showApprovals).map(([label, count, tab, Icon, tone]) => (
          <button type="button" key={tab} aria-pressed={internalTab === tab}
            onClick={() => selectTab(tab)}
            className="inbox-stat preci-press flex min-w-0 items-center gap-2 rounded-[10px] border p-2.5 text-start sm:gap-3 sm:p-3"
            data-tone={tone}>
            <RouteCornerMotif className="inbox-stat-motif" />
            <span className="inbox-stat-icon dash-icon-tile grid size-8 shrink-0 place-items-center rounded-md sm:size-10">
              <Icon aria-hidden="true" strokeWidth={1.75} className="size-4" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="inbox-stat-label">{label}</span>
              <strong className="inbox-stat-count"><Ticker value={count} /></strong>
            </span>
            <ChevronRight aria-hidden="true" className="inbox-stat-chevron size-3.5 shrink-0" />
          </button>
        ))}
      </section>

      {activeView === 'dashboard' && formShortcuts.length > 0 && <FirstRouteGuide userId={currentUser.id} hasSubmitted={myRequests.length > 0} onStart={() => setActiveView('forms-library')} />}
      {showProcessorQueue && <section className="workspace-panel space-y-2 p-4" aria-labelledby="assigned-processors-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="assigned-processors-heading" className="font-bold">Approved requests to process
            {unopenedHandoffs > 0 && <span className="ms-2 rounded-full bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">{unopenedHandoffs} new</span>}</h2>
          <p className="text-xs text-workspace-muted">Signing is complete. Opening a request records that you opened it.</p>
        </div>
        <ul className="divide-y divide-slate-200">
          {[...assignedHandoffs].sort((a, b) => Number(hasReadHandoff(a, currentUser.id)) - Number(hasReadHandoff(b, currentUser.id))
            || b.updatedAt.localeCompare(a.updatedAt)).map(request => <li key={request.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{request.formData.workDescription || request.formType} {!hasReadHandoff(request, currentUser.id) && <span className="ml-1 rounded-full bg-teal-50 px-2 py-0.5 text-xs text-teal-800">New</span>}</p>
                <p className="text-xs text-workspace-muted [overflow-wrap:anywhere]">{formatRequestId(request.id, request.displayId)} · {request.companyId} · {request.formType} · {request.requesterName}</p>
              </div>
              <button type="button" onClick={() => openReviewRequest(request.id)} className="workspace-control preci-press min-h-10 px-3 text-sm font-semibold">Open approved request</button>
            </li>)}
        </ul>
      </section>}

      {otherActions.length > 0 && <section className="workspace-panel space-y-2 p-4" aria-label="Other actions">
        <h2 className="font-bold">Other actions</h2>
        {otherActions.map(request => <div key={request.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-2">
          <span className="text-sm">{request.formType} · {formatRequestId(request.id, request.displayId)}</span>
          <button type="button" className="workspace-control min-h-10 px-3 text-sm" onClick={() => openReviewRequest(request.id)}>{actionFor(request).label}</button>
        </div>)}
      </section>}

      <section aria-labelledby="dashboard-forms-heading" className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="dashboard-forms-heading" className="text-base font-bold text-workspace-ink">Company forms</h2>
          <button type="button" onClick={() => setActiveView('forms-library')} className="preci-link inline-flex items-center gap-2 py-1">
            <LayoutGrid aria-hidden="true" className="size-4" /> Forms library <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        </div>
        {formShortcuts.length ? <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {formShortcuts.map(({ name, department }) => (
              <button type="button" key={name} title={name} className="dash-form-card workspace-control preci-press flex min-h-16 items-center gap-3 p-3 text-left text-[13px] font-semibold shadow-sm"
                onClick={() => { setSelectedRequestFormType(name); setActiveView('create-request'); }}>
                <span className="dash-icon-tile grid size-9 shrink-0 place-items-center rounded-lg text-workspace-teal"><FormGlyph form={name} className="size-5" /></span>
                <span className="min-w-0 flex-1 leading-tight"><span className="block line-clamp-2 [text-wrap:balance]">{name}</span><span className="mt-1 block truncate text-xs font-normal text-workspace-muted">{department}</span></span>
                <ChevronRight aria-hidden="true" className="dash-form-chevron size-4 shrink-0 text-workspace-muted" />
              </button>
            ))}
          </div> : <div className="workspace-panel"><EmptyState variant="locked" title="No forms are assigned in this view" description="Switch company or ask your account administrator for form access." /></div>}
      </section>
      {draftFormData && <button type="button" className="workspace-control min-h-9 px-3 text-sm font-semibold"
        onClick={() => { setSelectedRequestFormType('Admin Work Request'); setActiveView('create-request'); }}>Resume Admin Work Request draft →</button>}
      <div className="grid min-w-0 items-start gap-4">
      {/* Main Operational Table Container */}
      <div className="workspace-panel min-w-0" aria-label="Recent requests" id="request-list" tabIndex={-1}>
        {/* Table Controls Bar: Operational Filter Tabs + Search + Sort + Columns */}
        <div className="dash-toolbar">
          {/* Segmented Filter Tabs */}
          <div data-tour="request-list" role="group" aria-label="Request views" className="dash-tabs" ref={tabsRef}>
            <span aria-hidden="true" className="dash-tab-pill" ref={pillRef} />
            <button
              aria-pressed={internalTab === 'all'}
              onClick={() => selectTab('all')}
              className="dash-tab"
            >
              {activeView === 'dashboard' ? 'Recent requests' : 'All routes'} <span className="dash-tab-count">{companyRequests.length}</span>
            </button>
            {showApprovals && <button
              aria-pressed={internalTab === 'pending'}
              onClick={() => selectTab('pending')}
              className="dash-tab"
            >
              Needs my action <span className="dash-tab-count">{pendingForMeRequests.length}</span>
            </button>}
            <button
              aria-pressed={internalTab === 'my'}
              onClick={() => selectTab('my')}
              className="dash-tab"
            >
              My Requests <span className="dash-tab-count">{myRequests.length}</span>
            </button>
            <button
              aria-pressed={internalTab === 'returned'}
              onClick={() => setInternalTab('returned')}
              className="dash-tab"
            >
              Returned <span className="dash-tab-count">{returnedRequests.length}</span>
            </button>
            <button
              aria-pressed={internalTab === 'approved'}
              onClick={() => selectTab('approved')}
              className="dash-tab"
            >
              Completed <span className="dash-tab-count">{approvedRequests.length}</span>
            </button>
            {activeView === 'dashboard' && <button type="button" onClick={() => { setRequestsFilter('all'); setActiveView('requests'); }} className="dash-tab">All routes <span className="dash-tab-count">{companyRequests.length}</span></button>}
          </div>

          {/* Search, Sort & Columns Visibility */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative flex-1 sm:flex-none">
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-workspace-muted" />
              <input
                type="text"
                aria-label="Search recent PreciRoutes"
                placeholder="Search requests"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="workspace-control min-h-8 w-full pl-8 pr-2.5 text-xs placeholder:text-workspace-muted sm:w-52"
              />
            </div>

            {/* Sort Picker: inline from sm, in a bottom sheet on phones */}
            <div className="flex max-w-full flex-wrap items-center gap-2 text-xs max-sm:hidden">
              {filterControls('inline')}
            </div>
            <button type="button" className="workspace-control preci-press inline-flex min-h-8 items-center gap-1.5 px-2.5 text-xs font-medium sm:hidden" onClick={() => setFiltersOpen(true)}>
              <SlidersHorizontal aria-hidden="true" className="size-3.5" /> Filters{(formFilter !== 'ALL' || statusFilter !== 'ALL') && <span className="size-1.5 rounded-full bg-workspace-teal" aria-label="active" />}
            </button>
            <BottomSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filter and sort">
              <div className="grid gap-3 pb-2 text-sm">{filterControls('sheet')}</div>
              <button type="button" className="workspace-primary preci-press mt-2 min-h-11 w-full text-sm font-semibold" onClick={() => setFiltersOpen(false)}>Show requests</button>
            </BottomSheet>

            {/* Column Visibility Selector */}
            <div ref={columnsMenuRef} className="request-columns-control relative">
              <button
                onClick={() => setShowColumnsMenu(!showColumnsMenu)}
                aria-expanded={showColumnsMenu}
                aria-label="Customize table columns"
                className="workspace-control flex min-h-8 items-center gap-1.5 px-2.5 text-xs font-medium"
                title="Customize table columns"
              >
                <SlidersHorizontal className="w-3 h-3 text-slate-500" />
                <span className="hidden sm:inline">Columns</span>
                <ChevronDown className="w-2.5 h-2.5 text-slate-400" />
              </button>

              {showColumnsMenu && (
                <div className="preci-popover origin-top-right absolute right-0 mt-1 w-52 bg-white border border-[#E2E5E9] rounded-md shadow-lg p-2 z-30 space-y-1 text-xs">
                  <div className="px-2 py-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                    Show / Hide Columns
                  </div>
                  {Object.entries(visibleColumns).map(([col, val]) => {
                    const columnLabels: Record<string, string> = {
                      id: 'Request ID & subject',
                      formType: 'Form type',
                      company: 'Company',
                      requester: 'Requester',
                      currentApprover: 'Signers & progress',
                      prioritySla: 'Priority',
                      status: 'Signing status',
                      createdAt: 'Submitted',
                    };
                    return (
                      <label
                        key={col}
                        className="flex items-center justify-between px-2 py-1 rounded hover:bg-[#F5F6F8] cursor-pointer"
                      >
                        <span>{columnLabels[col] || col}</span>
                        <input
                          type="checkbox"
                          checked={val}
                          onChange={() =>
                            setVisibleColumns((prev) => ({
                              ...prev,
                              [col]: !prev[col as keyof typeof visibleColumns],
                            }))
                          }
                          className="rounded text-[#365C78] focus:ring-[#365C78]"
                        />
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="request-cards divide-y divide-workspace-line">
          {displayedRequests.length === 0 && <EmptyState variant={hasFilters ? 'search' : 'default'} done={!hasFilters && internalTab === 'pending'} title={!hasFilters && internalTab === 'pending' ? 'You’re all caught up' : 'No requests in this view'} description={hasFilters ? 'Adjust your search or filters.' : internalTab === 'pending' ? 'Requests that need your action will appear here.' : 'Start one from Company forms above, or switch company.'} />}
          {displayedRequests.map(req => <article key={req.id} data-request-row className="request-card space-y-2.5 p-4" data-mine={needsMyAction(req, currentUser) || undefined}>
            <div className="flex flex-wrap justify-between gap-2 text-xs"><strong className="request-id" title={req.id}>{formatRequestId(req.id, req.displayId)}</strong><span className="min-w-0 text-workspace-muted">{req.companyId} · {req.status === 'Approved' ? 'Signing completed' : req.status}</span></div>
            <h3 dir="auto" data-request-title className="text-[0.9375rem] leading-snug font-semibold text-workspace-ink [overflow-wrap:anywhere]">{getRequestTitle(req)}</h3>
            <p dir="auto" className="text-xs text-workspace-muted [overflow-wrap:anywhere]">{req.formType} · {req.requesterName}</p>
            {actionFor(req).title !== req.formType && <p className="request-turn">{actionFor(req).title}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="preci-link min-h-10 text-xs" aria-expanded={expandedRowId === req.id}
                aria-controls={`card-journey-${req.id}`} onClick={() => setExpandedRowId(expandedRowId === req.id ? null : req.id)}>Signing details</button>
              <button type="button" className="workspace-primary preci-press min-h-10 px-3 text-xs" onClick={event => openWithTitleTransition(event.currentTarget, () => openReviewRequest(req.id))}>{actionFor(req).label}</button>
            </div>
            {expandedRowId === req.id && <RevealOnMount id={`card-journey-${req.id}`}><RequestJourneySummary request={req} userId={currentUser.id}
              onHistory={() => setSelectedJourneyRequest(req)} /></RevealOnMount>}
          </article>)}
        </div>
        {/* Operational Table */}
        <div className="request-table overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-workspace-line bg-workspace text-xs font-semibold text-workspace-muted">
                <th className="py-2.5 px-2.5 w-8"></th>
                {visibleColumns.id && <th className="py-2.5 px-2.5">Request ID &amp; subject</th>}
                {visibleColumns.formType && <th className="py-2.5 px-2.5">Form type</th>}
                {visibleColumns.company && <th className="py-2.5 px-2.5">Company</th>}
                {visibleColumns.requester && <th className="py-2.5 px-2.5">Requester</th>}
                {visibleColumns.currentApprover && <th className="py-2.5 px-2.5 min-w-[220px]">Signers &amp; progress</th>}
                {visibleColumns.prioritySla && <th className="py-2.5 px-2.5">Priority</th>}
                {visibleColumns.status && <th className="py-2.5 px-2.5">Signing status</th>}
                {visibleColumns.createdAt && <th className="py-2.5 px-2.5">Submitted</th>}
                <th className="py-2.5 px-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E5E9]">
              {filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={2 + Object.values(visibleColumns).filter(Boolean).length} className="p-0">
                    <EmptyState
                      variant={hasFilters ? 'search' : 'default'}
                      done={!hasFilters && internalTab === 'pending'}
                      title={!hasFilters && internalTab === 'pending' ? 'You’re all caught up' : 'No requests in this view'}
                      description={hasFilters ? 'No requests match your search and filters.' : internalTab === 'pending' ? 'Requests that need your action will appear here.' : 'Start one from Company forms above, or switch company.'}
                      action={hasFilters ? <button type="button" className="preci-link underline" onClick={() => {
                        handleSearchChange('');
                        setFormFilter('ALL');
                        setStatusFilter('ALL');
                      }}>Clear filters</button> : undefined}
                    />
                  </td>
                </tr>
              ) : (
                displayedRequests.map((req) => {
                  const isExpanded = expandedRowId === req.id;
                  const isUrgent = req.formData.priority === 'Urgent';
                  const isPendingMe =
                    needsMyAction(req, currentUser);

                  return (
                    <React.Fragment key={req.id}>
                      <tr
                        data-request-row
                        onClick={() => setExpandedRowId(isExpanded ? null : req.id)}
                        data-mine={isPendingMe || undefined}
                        className={`request-row cursor-pointer transition-colors duration-150 hover:bg-workspace/60 ${
                          isExpanded ? 'bg-workspace/60' : ''
                        }`}
                      >
                        {/* Expand toggle */}
                        <td className="py-2.5 px-2.5 text-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedRowId(isExpanded ? null : req.id);
                            }}
                            className="inline-grid size-7 place-items-center rounded-md text-workspace-muted hover:bg-workspace focus-visible:outline-2 focus-visible:outline-workspace-steel"
                            aria-expanded={isExpanded}
                            aria-label={`${isExpanded ? "Collapse" : "Expand"} details for ${req.id}`}
                          >
                            <ChevronDown
                              className={`w-3.5 h-3.5 transition-transform ${
                                isExpanded ? 'rotate-180 text-[#365C78]' : ''
                              }`}
                            />
                          </button>
                        </td>

                        {/* Request ID */}
                        {visibleColumns.id && (
                          <td className="py-2.5 px-2.5">
                            <div className="font-semibold text-[#192B3C] text-xs flex flex-wrap items-center gap-1.5">
                              <RequestHoverPreview request={req} currentUserId={currentUser.id}>
                                <span className="request-id" title={req.id}>
                                  {formatRequestId(req.id, req.displayId)}
                                </span>
                              </RequestHoverPreview>
                              {req.documentVersion > 1 && (
                                <span className="text-[9px] px-1 rounded bg-slate-200 text-slate-700 font-mono">
                                  v{req.documentVersion}
                                </span>
                              )}
                            </div>
                            <div dir="auto" data-request-title className="mt-1 max-w-[220px] truncate text-[13px] font-medium text-workspace-ink" title={getRequestTitle(req)}>
                              {getRequestTitle(req)}
                            </div>
                          </td>
                        )}
                        {visibleColumns.formType && (
                          <td className="px-2.5 py-2.5"><span className="inline-block max-w-[128px] truncate whitespace-nowrap rounded-md bg-workspace px-2 py-1 text-xs font-medium leading-tight" title={req.formType}>{req.formType}</span></td>
                        )}
                        {visibleColumns.company && (
                          <td className="px-2.5 py-2.5 text-xs font-semibold">
                            <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">{req.companyId}</span>
                          </td>
                        )}

                        {/* Requester */}
                        {visibleColumns.requester && (
                          <td className="py-2.5 px-2.5">
                            <div className="flex items-center gap-2">
                              <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-800">{getInitials(req.requesterName)}</span>
                              <div className="min-w-0"><div dir="auto" className="max-w-[160px] truncate font-semibold text-workspace-ink" title={req.requesterName}>{req.requesterName}</div>
                              <div dir="auto" className="max-w-[160px] truncate text-[11px] text-workspace-muted" title={req.department}>{req.department}</div></div>
                            </div>
                          </td>
                        )}

                        {/* Approval Journey & Progress Chain */}
                        {visibleColumns.currentApprover && (
                          <td className="py-2.5 px-2.5">
                            <CompactApprovalChain
                              request={req}
                              currentUserId={currentUser.id}
                              maxVisible={4}
                              compact
                              onOpenDetail={(r) => setSelectedJourneyRequest(r)}
                            />
                          </td>
                        )}

                        {/* Priority & Turnaround Target (Distinguished from Status) */}
                        {visibleColumns.prioritySla && (
                          <td className="py-2.5 px-2.5">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`text-[11px] font-semibold px-2 py-0.5 rounded border inline-block ${
                                  isUrgent
                                    ? 'bg-rose-50 text-rose-800 border-rose-200'
                                    : req.formData.priority === 'Medium'
                                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                                    : 'bg-slate-100 text-slate-700 border-slate-200'
                                }`}
                              >
                                {req.formData.priority}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                              Target: {getSlaDescription(req.formData.priority)}
                            </div>
                          </td>
                        )}

                        {/* Workflow Status */}
                        {visibleColumns.status && (
                          <td className="py-2.5 px-2.5">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap ${
                                req.status === 'Approved'
                                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                  : req.status === 'Returned for Correction'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : req.status === 'Rejected'
                                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                                  : 'bg-sky-50 text-sky-800 border-sky-200'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  req.status === 'Approved'
                                    ? 'bg-emerald-600'
                                    : req.status === 'Returned for Correction'
                                    ? 'bg-amber-600'
                                    : req.status === 'Rejected'
                                    ? 'bg-rose-600'
                                    : 'bg-sky-600'
                                }`}
                              />
                              <span>{req.status === 'Approved' ? 'Signing completed' : req.status === 'Returned for Correction' ? 'Returned' : req.status}</span>
                            </span>
                            
                          </td>
                        )}

                        {/* Submission Date */}
                        {visibleColumns.createdAt && (
                          <td className="py-2.5 px-2.5 tabular-nums text-slate-600">
                            <div>
                              {new Date(req.createdAt).toLocaleDateString('en-GB', {
                                day: '2-digit',
                                month: 'short',
                                year: 'numeric',
                              })}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              {new Date(req.createdAt).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </td>
                        )}

                        {/* Primary Action Button */}
                        <td className="py-2.5 px-2.5 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openWithTitleTransition(e.currentTarget, () => openReviewRequest(req.id));
                            }}
                            className={`inline-flex min-h-8 items-center gap-2 whitespace-nowrap px-2.5 text-xs font-semibold ${isPendingMe ? 'workspace-primary' : 'workspace-control'}`}
                          >
                            <span>{actionFor(req).label}</span>
                            <ArrowRight aria-hidden="true" className="size-3.5" />
                          </button>
                        </td>
                      </tr>

                      {/* Expandable Approval Workflow Stepper & Audit Overview */}
                      {isExpanded && (
                        <tr className="bg-[#F9FAFB] border-b border-[#E2E5E9]">
                          <td colSpan={2 + Object.values(visibleColumns).filter(Boolean).length + (visibleColumns.id ? 2 : 0)} className="px-3 py-2 sm:pl-10">
                            <RevealOnMount><RequestJourneySummary request={req} userId={currentUser.id}
                              onHistory={() => setSelectedJourneyRequest(req)} /></RevealOnMount>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Operational Table Footer */}
        <div className="flex flex-col items-center justify-between gap-2 rounded-b-xl border-t border-workspace-line bg-workspace/40 p-3 text-xs text-workspace-muted sm:flex-row">
          <span className="min-w-0 [overflow-wrap:anywhere]">
            Showing {displayedRequests.length} of {companyRequests.length} requests in {selectedCompany.fullName}
          </span>
          <div className="flex items-center gap-3">


            <button
              onClick={() => { setRequestsFilter('all'); setActiveView('requests'); }}
              className="font-medium text-[#365C78] hover:underline"
            >
              View all requests
            </button>
          </div>
        </div>
      </div>

        <RequestActivity total={companyRequests.length} items={[
          ...(showApprovals ? [{ label: 'Needs my action', count: pendingForMeRequests.length, key: 'pending', color: '#087b79', active: internalTab === 'pending' }] : []),
          { label: 'Returned', count: returnedRequests.length, key: 'returned', color: '#c56a10', active: internalTab === 'returned' },
          { label: 'Signing completed', count: approvedRequests.length, key: 'approved', color: '#365c78', active: internalTab === 'approved' },
        ]} select={key => { selectTab(key as typeof internalTab); document.getElementById('request-list')?.focus(); }} />
      </div>

      {/* Approval Journey Inspection Modal */}
      <ApprovalJourneyModal
        request={selectedJourneyRequest}
        isOpen={Boolean(selectedJourneyRequest)}
        onClose={() => setSelectedJourneyRequest(null)}
        onOpenDocument={openReviewRequest}
        currentUserId={currentUser.id}
      />
    </div>
  );
};
