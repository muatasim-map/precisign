import { usePageNavigation } from '../navigation/usePageNavigation';
import type { PageView } from '../navigation/pageRoutes';
import { isShowcaseBuild } from '../config/demo';
import { activeDemoDataset } from '../data/demoDataset';
import { needsMySignature } from '../utils/actionQueue';
import { canReadPreciRoute } from '../utils/routeAccess';
import React, { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Company,
  UserProfile,
  WorkflowConfig,
  RequestRecord,
  CompanyId,
  ViewingScope,
  PARENT_ORGANIZATION_ID,
  AdminWorkFormData,
  AdminWorkDraft,
  AttachmentItem,
} from '../types/index';
import { dataService } from '../services/repository';
import {
  filterRequestsByScopeAndUser,
  validateOriginatingCompany,
  canUserStartForm,
  hasSigningRights,
} from '../utils/companyAccess';
import { DraftCoordinator } from '../services/draftCoordinator';
import { LocalActionRepository } from '../services/localActionRepository';
import type { BootstrapData, SubmitInput, VersionedRequest } from '../services/apiTypes';
import { ApiError } from '../services/apiTypes';
import type { ApiPreciSignRepository } from '../services/apiRepository';
import { captureFrontendError } from '../services/sentry';

interface AppContextType {
  readOnly: boolean;
  companies: Company[];
  selectedScope: ViewingScope;
  selectedCompanyId: ViewingScope;
  selectedCompany: Company;
  setSelectedScope: (scope: ViewingScope) => void;
  setSelectedCompanyId: (id: ViewingScope) => void;
  users: UserProfile[];
  currentUser: UserProfile;
  setCurrentUserId: (id: string) => void;
  requestEmailChange?: (email: string, currentPassword: string) => Promise<void>;
  updateUserName: (name: string) => Promise<void>;
  updateUserSignature: (userId: string, signatureDataUrl?: string, signatureStyleText?: string) => Promise<void>;
  requests: RequestRecord[];
  refreshRequests: () => Promise<void>;
  recordProcessorRead: (id: string, version: number) => Promise<void>;
  reassignProcessor: (id: string, version: number, change: { taskId: string; from: string; to: string; reason: string }) => Promise<void>;
  companyRequests: RequestRecord[];
  signingQueue: RequestRecord[];
  showSigningInbox: boolean;
  workflows: WorkflowConfig[];
  currentWorkflow: WorkflowConfig;
  saveWorkflow: (updated: WorkflowConfig) => Promise<WorkflowConfig>;
  
  // Navigation
  activeView: PageView;
  setActiveView: (view: PageView) => void;
  navigationPrompt: { stay: () => void; leave: () => void } | null;
  setUnsavedWork: (key: symbol, dirty: boolean) => void;
  requestRouteStatus: 'loading' | 'ready' | 'unavailable' | 'error';
  retryRequestRoute: () => void;
  isMobileSidebarOpen: boolean;
  setIsMobileSidebarOpen: (open: boolean) => void;
  requestsFilter: 'pending' | 'my' | 'all' | 'approved';
  setRequestsFilter: (filter: 'pending' | 'my' | 'all' | 'approved') => void;
  selectedRequestId: string | null;
  openReviewRequest: (requestId: string) => void;
  signatureReturn: SignatureReturn | null;
  setSignatureReturn: React.Dispatch<React.SetStateAction<SignatureReturn | null>>;
  openSignatureProfile: () => void;
  selectedRequestFormType: string;
  setSelectedRequestFormType: (formType: string) => void;
  locationHook?: () => [string, (to: string, ...args: any[]) => any];
  
  // Draft persistence via repository
  draftFormData: AdminWorkDraft | null;
  draftReady: boolean;
  draftError: string | null;
  retryDraft: () => void;
  saveDraft: (data: AdminWorkDraft, retry?: boolean) => Promise<void>;
  draftCompanyId: CompanyId | null;
  selectDraftCompany: (company: CompanyId) => void;
  reloadDraft: () => void;
  clearDraft: () => Promise<void>;
  loadITDraft: (company: CompanyId, force?: boolean) => Promise<{ fields: any; choices: any } | null>;
  saveITDraft: (company: CompanyId, data: { fields: any; choices: any }, retry?: boolean) => Promise<void>;
  clearITDraft: (company: CompanyId) => Promise<void>;
  
  // Workflow actions
  submitNewRequest: (
    formData: AdminWorkFormData,
    attachments?: AttachmentItem[],
    comment?: string,
    signatureDataUrl?: string,
    signerChoices?: SubmitInput['signerChoices'],
    emailNote?: string,
    processorChoices?: SubmitInput['processorChoices']
  ) => Promise<{ success: boolean; newId?: string; error?: string; routeChanged?: boolean }>;
  approveRequest: (
    requestId: string,
    comment?: string,
    signatureDataUrl?: string
  ) => Promise<{ success: boolean; error?: string }>;
  returnRequest: (
    requestId: string,
    reason: string
  ) => Promise<{ success: boolean; error?: string }>;
  resubmitRequest: (
    requestId: string,
    formData: AdminWorkFormData,
    changeNote?: string,
    signatureDataUrl?: string,
    attachments?: AttachmentItem[]
  ) => Promise<{ success: boolean; error?: string }>;
  rejectRequestAction: (
    requestId: string,
    reason: string
  ) => Promise<{ success: boolean; error?: string }>;
  replaceSigner: (id: string, stageId: string, newUserId: string, reason: string) => Promise<{ success: boolean; error?: string }>;
  acceptReplacement: (id: string, accept: boolean) => Promise<{ success: boolean; error?: string }>;
  readLatestRoute: (id: string) => Promise<RequestRecord | null>;
  downloadAttachment?: (id: string, version: number, fileId: string) => Promise<Blob>;
  downloadDocumentPdf?: (id: string, version: number, updatedAt: string) => Promise<Blob>;
  saveRndEvaluation: (id: string, evaluation: import('../types').RndFormData) => Promise<{ success: boolean; error?: string }>;
  cancelRoute: (id: string, reason: string) => Promise<{ success: boolean; error?: string }>;
  recordRouteProcessing: (id: string, action: import('../utils/routeProcessing').ProcessingCommand, note: string, signatureDataUrl?: string, attachment?: AttachmentItem) => Promise<{ success: boolean; error?: string }>;
  directorOverrideAction: (
    requestId: string,
    reason: string,
    signatureDataUrl?: string
  ) => Promise<{ success: boolean; error?: string }>;
  
  // Reset
  resetDemoData: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

type SignatureReturn = { userId: string; requestId: string; remark: string; updatedAt: string };

const scopeKey = (userId: string) => 'precisign.viewingScope.' + userId;
function readRememberedScope(userId: string): ViewingScope | null {
  try {
    const value = localStorage.getItem(scopeKey(userId));
    return value && ['PEW', 'ICCL', 'FSG', 'PEG'].includes(value) ? value as ViewingScope : null;
  } catch { return null; }
}
function rememberScope(userId: string, scope: ViewingScope) {
  try { localStorage.setItem(scopeKey(userId), scope); } catch { /* storage unavailable: the choice lasts for this visit */ }
}

export const AppProvider: React.FC<{ children: React.ReactNode; apiData?: { bootstrap: BootstrapData; requests: VersionedRequest[] }; apiRepository?: ApiPreciSignRepository }> = ({ children, apiData, apiRepository }) => {
  const readOnly = Boolean(apiData);
  const [companies, setCompanies] = useState<Company[]>(apiData?.bootstrap.companies || []);
  const [selectedScope, setSelectedScopeState] = useState<ViewingScope>(() => {
    if (typeof window !== 'undefined') {
      const param = new URLSearchParams(window.location.search).get('company')?.toUpperCase();
      if (param && ['PEW', 'ICCL', 'FSG', 'PEG'].includes(param)) {
        return param as ViewingScope;
      }
    }
    if (apiData) {
      // Remember the last company or Group View this person chose on this device. Only scopes they can access are restored.
      const remembered = readRememberedScope(apiData.bootstrap.user.id);
      const ids = apiData.bootstrap.companies.map(company => company.id as string);
      if (remembered && (ids.includes(remembered) || (remembered === 'PEG' && ids.length > 1))) return remembered;
    }
    return apiData ? (apiData.bootstrap.companies.find(c => c.id === apiData.bootstrap.user.companyId)?.id || apiData.bootstrap.companies[0]?.id || 'PEG') : 'PEW';
  });
  const [users, setUsers] = useState<UserProfile[]>(apiData ? [apiData.bootstrap.user, ...apiData.bootstrap.users.filter(u => u.id !== apiData.bootstrap.user.id)] : []);
  const [currentUserId, setCurrentUserIdState] = useState<string>(apiData?.bootstrap.user.id || activeDemoDataset.session.userId);
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>(apiData?.bootstrap.workflows || []);
  const [requests, setRequests] = useState<RequestRecord[]>(apiData?.requests || []);
  const [draftFormData, setDraftFormData] = useState<AdminWorkDraft | null>(null);
  const [loadedDraftKey, setLoadedDraftKey] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftRetry, setDraftRetry] = useState(0);
  const draftWrites = useRef(new Map<string, Promise<void>>());
  const draftCoordinator = useMemo(() => apiRepository ? new DraftCoordinator(apiRepository) : null, [apiRepository]);
  const [groupDraftCompany, setGroupDraftCompany] = useState<CompanyId | null>(null);
  const reloadDraftKeys = useRef(new Set<string>());
  const [initialLoaded, setInitialLoaded] = useState(readOnly);
  const [initialError, setInitialError] = useState<string | null>(null);

  const navigation = usePageNavigation();
  const activeView = navigation.route.view;
  const setActiveView = navigation.setActiveView;
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const requestsFilter = navigation.selectedFilter;
  const setRequestsFilter = navigation.setFilter;
  const selectedRequestId = navigation.route.requestId || null;
  const selectedRequestFormType = navigation.selectedForm;
  const setSelectedRequestFormType = navigation.setForm;
  useEffect(() => { if (selectedScope === 'PEG') setGroupDraftCompany(null); }, [selectedRequestFormType, selectedScope]);

  // The directory reads live grants. Refresh the workspace snapshot on browsing
  // screens so those same grants drive form visibility without a new sign-in.
  useEffect(() => {
    if (!apiRepository || !['dashboard', 'requests', 'archive', 'forms-library', 'create-request'].includes(activeView)) return;
    let cancelled = false;
    let pending = false;
    async function refreshAccess() {
      if (pending || !apiRepository) return;
      pending = true;
      try {
        const snapshot = await apiRepository.bootstrap();
        if (cancelled || snapshot.user.id !== currentUserId) return;
        const roster = [snapshot.user, ...snapshot.users.filter(user => user.id !== currentUserId)];
        setUsers(previous => JSON.stringify(previous) === JSON.stringify(roster) ? previous : roster);
        setCompanies(previous => JSON.stringify(previous) === JSON.stringify(snapshot.companies) ? previous : snapshot.companies);
        setWorkflows(previous => JSON.stringify(previous) === JSON.stringify(snapshot.workflows) ? previous : snapshot.workflows);
        setSelectedScopeState(scope => scope === 'PEG' || snapshot.companies.some(company => company.id === scope)
          ? scope : snapshot.companies[0]?.id ?? 'PEG');
      } catch {
        // Retain the current view through transient failures. The API still checks every action.
      } finally {
        pending = false;
      }
    }
    void refreshAccess();
    const timer = window.setInterval(refreshAccess, 30000);
    window.addEventListener('focus', refreshAccess);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshAccess);
    };
  }, [activeView, apiRepository, currentUserId]);

  useEffect(() => {
    if (!isShowcaseBuild || readOnly) return;
    const refresh = () => { void Promise.all([dataService.getUsers(), dataService.getCompanies(), dataService.getWorkflows()]).then(([people, organizations, routes]) => { setUsers(people); setCompanies(organizations); setWorkflows(routes); }).catch(console.error); };
    window.addEventListener('precisign:showcase-changed', refresh);
    return () => window.removeEventListener('precisign:showcase-changed', refresh);
  }, [readOnly]);

  // Load initial data through repository abstraction
  useEffect(() => {
    if (readOnly) return;
    let mounted = true;
    async function loadInitialData() {
      const [allCompanies, allUsers, allWorkflows, allRequests, session] = await Promise.all([
        dataService.getCompanies(),
        dataService.getUsers(),
        dataService.getWorkflows(),
        dataService.getRequests(),
        dataService.getDemoSession(),
      ]);

      if (!mounted) return;
      setCompanies(allCompanies);
      setUsers(allUsers);
      setWorkflows(allWorkflows);
      setRequests(allRequests);
      setSelectedScopeState(session.companyId || 'PEW');
      setCurrentUserIdState(session.userId);

      setInitialLoaded(true);
    }
    loadInitialData().catch(() => { if (mounted) setInitialError('Could not load application data. Check browser storage and reload.'); });
    return () => {
      mounted = false;
    };
  }, []);

  const draftCompanyId = readOnly && companies.length === 0 ? null : selectedScope === 'PEG' ? groupDraftCompany : selectedScope;
  const draftKey = `${apiRepository ? draftCompanyId : selectedScope}:${currentUserId}`;
  const activeDraftKey = useRef(draftKey);
  activeDraftKey.current = draftKey;
  useEffect(() => {
    if (!initialLoaded) return;
    let cancelled = false;
    setLoadedDraftKey('');
    setDraftError(null);
    const draftUser = users.find(user => user.id === currentUserId);
    if (draftCoordinator && (!draftCompanyId || !draftUser || !canUserStartForm(draftUser, draftCompanyId, 'Admin Work Request'))) return;
    const force = reloadDraftKeys.current.delete(draftKey);
    const loading = draftCoordinator
      ? draftCoordinator.load(draftCompanyId!, currentUserId, force)
      : (draftWrites.current.get(draftKey) || Promise.resolve()).catch(() => {}).then(() => dataService.getDraft(selectedScope, currentUserId, 'Admin Work Request'));
    loading.then((draft) => {
      if (!cancelled) { setDraftFormData(draft); setLoadedDraftKey(draftKey); }
    }).catch(() => { if (!cancelled) setDraftError('Could not load your draft. Your saved data was not changed.'); });
    return () => { cancelled = true; };
  }, [initialLoaded, selectedScope, currentUserId, draftRetry, draftCompanyId, draftCoordinator, users]);

  const setSelectedScope = (scope: ViewingScope) => navigation.runGuarded(() => {
    setSelectedScopeState(scope);
    if (readOnly) rememberScope(currentUserId, scope);
    if (scope === 'PEG') setGroupDraftCompany(null);
    if (!readOnly) void dataService.saveDemoSession(scope, currentUserId).catch(console.error);
  });

  const setSelectedCompanyId = (id: ViewingScope) => {
    setSelectedScope(id);
  };

  const setCurrentUserId = (id: string) => navigation.runGuarded(() => {
    if (readOnly) return;
    setCurrentUserIdState(id);
    void dataService.saveDemoSession(selectedScope, id).catch(console.error);
    setActiveView('dashboard');
  });

  const updateUserName = async (name: string) => {
    const updated = await (apiRepository || dataService).updateUserName(currentUserId, name);
    setUsers(prev => prev.map(user => user.id === currentUserId ? { ...user, ...updated } : user));
  };

  const updateUserSignature = async (
    userId: string,
    signatureDataUrl?: string,
    signatureStyleText?: string
  ) => {
    if (userId !== currentUserId) throw new Error('Only your own signature can be updated.');
    const updated = await (apiRepository || dataService).updateUserSignature(userId, signatureDataUrl, signatureStyleText);
    setUsers((prev) => prev.map((u) => (u.id === userId ? updated : u)));
  };

  const matchingUser = users.find((u) => u.id === currentUserId);
  const currentUser = matchingUser ?? apiData?.bootstrap.user ?? users[0] ?? {
    id: 'loading-employee',
    name: 'Loading employee',
    email: '',
    role: 'Employee' as const,
    department: '',
    initials: '…',
    avatarColor: '#6366f1',
    companyId: 'PEW' as CompanyId,
  };

  const selectedCompany: Company = selectedScope === PARENT_ORGANIZATION_ID
    ? {
        id: 'PEW' as CompanyId, // Primary reference for group view
        code: 'PEG',
        name: 'Precision Engineering Group',
        fullName: 'PRECISION ENGINEERING GROUP (Group View)',
        groupName: 'PRECISION ENGINEERING GROUP',
      }
    : companies.find((c) => c.id === selectedScope) || companies[0] || {
        id: 'PEW' as CompanyId,
        code: 'PEW',
        name: 'Precision Engineering Works',
        fullName: 'PEW - Precision Engineering Works',
        groupName: 'PRECISION ENGINEERING GROUP',
      };

  // Filter requests according to Viewing Scope and User Authorization
  const companyRequests = filterRequestsByScopeAndUser(requests, selectedScope, currentUser).filter(request => canReadPreciRoute(currentUser,request));
  const scopeCompanies = companies.filter(company => selectedScope === 'PEG' || company.id === selectedScope).map(company => company.id);
  const signingQueue = companyRequests.filter(request => needsMySignature(request, currentUser.id));
  const showSigningInbox = !readOnly || hasSigningRights(currentUser, scopeCompanies, workflows) || companyRequests.some(request =>
    request.status === 'Pending Approval' && request.approvalSteps.some(step => step.assignedUserId === currentUser.id));

  // Active workflow for Admin Work Request in current scope (or PEW fallback if in Group View)
  const targetCompanyIdForWf = selectedScope === PARENT_ORGANIZATION_ID ? 'PEW' : (selectedScope as CompanyId);
  const currentWorkflow =
    workflows.find((w) => w.companyId === targetCompanyIdForWf && w.formType === 'Admin Work Request') ||
    workflows[0] || {
      id: 'wf-pew-admin-work',
      formType: 'Admin Work Request',
      companyId: targetCompanyIdForWf,
      version: 1,
      stages: [],
      preventSelfApproval: true,
      allowDirectorOverride: true,
      reminderDays: 2,
      escalationDays: 5,
      rejectionBehavior: 'archive' as const,
      returnBehavior: 'restart_workflow' as const,
    };

  const saveWorkflow = async (updated: WorkflowConfig) => {
    let saved: WorkflowConfig;
    try {
      saved = await (apiRepository || dataService).saveWorkflow(updated);
    } catch (error) {
      // Another administrator saved first: load the latest routes so the editor can compare, then report the conflict.
      if (error instanceof ApiError && error.status === 409) {
        try { setWorkflows(await actionRepository.getWorkflows()); } catch { /* the conflict is still reported below */ }
      }
      throw error;
    }
    setWorkflows((prev) => [...prev.filter((w) => !(w.companyId === saved.companyId && w.formType === saved.formType)), saved]);
    return saved;
  };

  const saveDraft = async (data: AdminWorkDraft, retry = false) => {
    if (draftCoordinator) {
      if (!draftCompanyId || loadedDraftKey !== draftKey) throw new Error('Select a company and load its draft first.');
      await draftCoordinator.save(draftCompanyId, currentUserId, data, retry);
      if (activeDraftKey.current === draftKey) setDraftFormData(data);
      return;
    }
    const key = `${selectedScope}:${currentUser.id}`;
    const previous = draftWrites.current.get(key) || Promise.resolve();
    const write = previous.catch(() => {}).then(() => dataService.saveDraft(selectedScope, currentUser.id, 'Admin Work Request', data));
    draftWrites.current.set(key, write);
    await write;
    if (activeDraftKey.current === key) setDraftFormData(data);
  };

  const clearDraft = async () => {
    if (draftCoordinator) {
      if (!draftCompanyId) throw new Error('Select a company first.');
      await draftCoordinator.clear(draftCompanyId, currentUserId);
      if (activeDraftKey.current === draftKey) setDraftFormData(null);
      return;
    }
    const key = `${selectedScope}:${currentUser.id}`;
    await (draftWrites.current.get(key) || Promise.resolve()).catch(() => {});
    await dataService.clearDraft(selectedScope, currentUser.id, 'Admin Work Request');
    if (activeDraftKey.current === key) setDraftFormData(null);
  };

  const loadITDraft = useCallback(async (company: CompanyId, force = false): Promise<{ fields: any; choices: any } | null> => {
    if (draftCoordinator) {
      const draft = await draftCoordinator.load(company, currentUserId, force, 'IT Request');
      return draft;
    }
    const key = `precisign_draft_${currentUserId}_${company}_IT_Request`;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.fields) return { fields: parsed.fields, choices: parsed.choices || {} };
      }
    } catch {}
    return null;
  }, [draftCoordinator, currentUserId]);

  const saveITDraft = useCallback(async (company: CompanyId, data: { fields: any; choices: any }, retry = false): Promise<void> => {
    if (draftCoordinator) {
      await draftCoordinator.save(company, currentUserId, data, retry, 'IT Request');
      return;
    }
    const key = `precisign_draft_${currentUserId}_${company}_IT_Request`;
    localStorage.setItem(key, JSON.stringify({
      revision: Date.now(),
      savedAt: Date.now(),
      fields: data.fields,
      choices: data.choices,
    }));
  }, [draftCoordinator, currentUserId]);

  const clearITDraft = useCallback(async (company: CompanyId): Promise<void> => {
    if (draftCoordinator) {
      await draftCoordinator.clear(company, currentUserId, 'IT Request');
      return;
    }
    const key = `precisign_draft_${currentUserId}_${company}_IT_Request`;
    localStorage.removeItem(key);
  }, [draftCoordinator, currentUserId]);

  const openReviewRequest = navigation.openRequest;
  const [signatureReturn, setSignatureReturn] = useState<SignatureReturn | null>(null);
  const refreshRequests = async () => {
    const latest = await (apiRepository || dataService).getRequests();
    setRequests(latest);
  };

  // ApiSession already loaded the initial inbox. Refresh on later navigation.
  const lastRequestRefreshView = useRef(activeView);
  useEffect(() => {
    const changedView = lastRequestRefreshView.current !== activeView;
    lastRequestRefreshView.current = activeView;
    if (!changedView || !apiRepository || !['dashboard', 'requests', 'archive'].includes(activeView)) return;
    let cancelled = false;
    void apiRepository.getRequests().then(latest => { if (!cancelled) setRequests(latest); }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeView, apiRepository]);

  // Demo actions use the same intent contract as the API adapter.
  const actionRepository = useMemo(() => apiRepository || new LocalActionRepository(currentUserId), [currentUserId, apiRepository]);
  const [resolvedRoute, setResolvedRoute] = useState({ key: '', status: 'loading' as 'loading' | 'ready' | 'unavailable' | 'error' });
  const [routeRetry, setRouteRetry] = useState(0);
  const routeKey = `${currentUserId}:${selectedRequestId}`;
  const requestRouteStatus = resolvedRoute.key === routeKey ? resolvedRoute.status : 'loading';
  useEffect(() => {
    if (!initialLoaded || activeView !== 'review-sign' || !selectedRequestId) return;
    let cancelled = false;
    setResolvedRoute({ key: routeKey, status: 'loading' });
    void actionRepository.getRequestById(selectedRequestId).then(record => {
      if (cancelled) return;
      if (!record || !canReadPreciRoute(currentUser, record)) {
        setResolvedRoute({ key: routeKey, status: 'unavailable' }); return;
      }
      setRequests(previous => [...previous.filter(item => item.id !== record.id), record]);
      setSelectedScopeState(record.companyId);
      setResolvedRoute({ key: routeKey, status: 'ready' });
    }).catch(error => {
      if (!cancelled) setResolvedRoute({ key: routeKey, status: error instanceof ApiError && (error.status === 403 || error.status === 404) ? 'unavailable' : 'error' });
    });
    return () => { cancelled = true; };
  }, [initialLoaded, activeView, selectedRequestId, currentUserId, actionRepository, currentUser, routeRetry]);

  const lastSubmissionAttempt = useRef<{ key: string; payloadSig: string } | null>(null);
  const recordProcessorRead = useCallback(async (id: string, version: number) => {
    if (!apiRepository) return;
    const receipt = await apiRepository.recordProcessorRead(id, version);
    setRequests(previous => previous.map(record => {
      if (record.id !== id || record.documentVersion !== version) return record;
      const reads = [...(record.processorReads ?? [])];
      for (const item of receipt.processorReads ?? []) {
        if (!reads.some(read => read.userId === item.userId && read.version === item.version)) reads.push(item);
      }
      return { ...record, processorReads: reads };
    }));
  }, [apiRepository]);
  const reassignProcessor = async (id: string, version: number, change: { taskId: string; from: string; to: string; reason: string }) => {
    if (!apiRepository) return;
    await apiRepository.reassignProcessor(id, version, change);
    await refreshRequests();
  };

  const actionFailure = (error: unknown) => ({ success: false, error: error instanceof Error ? error.message : 'Could not save request.' });
  const submitNewRequest = async (formData: AdminWorkFormData, attachments: AttachmentItem[] = [], comment?: string, signatureDataUrl?: string, signerChoices?: SubmitInput['signerChoices'], emailNote?: string, processorChoices?: SubmitInput['processorChoices']) => {
    const validation = validateOriginatingCompany(selectedScope, formData.companyId, currentUser.companyId);
    if (!validation.isValid || !validation.companyId) return { success: false, error: validation.error };
    try {
      const formType = formData.rnd ? 'R&D Initiative' : formData.cashVoucher ? 'Cash Voucher'
        : formData.expenseClaim ? 'Expense Claim'
        : formData.itRequest ? 'IT Request'
        : formData.administrativePayment ? 'Administrative & Payment Request' : 'Admin Work Request';
      const legacy = formType === 'Admin Work Request';
      const workflow = workflows.find(route => route.companyId === validation.companyId && route.formType === formType);
      if (apiRepository && !canUserStartForm(currentUser, validation.companyId, formType)) {
        return { success: false, error: 'You don’t have access to start this form in the selected company.' };
      }
      if (apiRepository && !workflow?.stages.length) {
        return { success: false, error: 'A signing route must be configured for this company and form before sending.' };
      }

      const currentPayloadSig = JSON.stringify({
        companyId: validation.companyId,
        formType,
        formData,
        attachments: (attachments || []).map(a => ({ name: a.name, sizeBytes: a.sizeBytes, dataUrl: a.dataUrl })),
        comment,
        signatureDataUrl,
        signerChoices,
        processorChoices,
        emailNote: emailNote || formData.emailNote,
      });
      let submissionKey: string;
      if (lastSubmissionAttempt.current && lastSubmissionAttempt.current.payloadSig === currentPayloadSig) {
        submissionKey = lastSubmissionAttempt.current.key;
      } else {
        submissionKey = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sub-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        lastSubmissionAttempt.current = { key: submissionKey, payloadSig: currentPayloadSig };
      }

      const input: SubmitInput = {
        submissionKey,
        companyId: validation.companyId,
        formType,
        signerChoices,
        processorChoices,
        expectedWorkflowVersion: legacy ? undefined : workflow?.version,
        formData: { dateOfRequest: formData.dateOfRequest, department: formData.department, priority: formData.priority, workDescription: formData.workDescription, documents: formData.documents, administrativePayment: formData.administrativePayment, itRequest: formData.itRequest, cashVoucher: formData.cashVoucher, expenseClaim: formData.expenseClaim, rnd: formData.rnd },
        attachments, comment, signatureDataUrl: signatureDataUrl || '',
        emailNote: emailNote || formData.emailNote };
      const record = draftCoordinator && (legacy || formType === 'IT Request')
        ? await draftCoordinator.submit(validation.companyId, currentUserId, input)
        : await actionRepository.submit(input);
      lastSubmissionAttempt.current = null;
      setRequests(prev => [record, ...prev]);
      if (legacy) {
        if (draftCoordinator) { if (activeDraftKey.current === draftKey) setDraftFormData(null); }
        else try { await clearDraft(); } catch (error) { console.error('Request saved but draft could not be cleared:', error); }
      }
      if (formType === 'IT Request') {
        const key = `precisign_draft_${currentUserId}_${validation.companyId}_IT_Request`;
        try { localStorage.removeItem(key); } catch {}
      }
      navigation.clearDirty();
      return { success: true, newId: record.id };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const isWorkflowConflict = error.code === 'WORKFLOW_CONFLICT' || (!error.code && /route|workflow/i.test(error.message));
        const isDraftConflict = error.code === 'DRAFT_CONFLICT' || (!error.code && /draft/i.test(error.message));
        const isSubmissionConflict = error.code === 'SUBMISSION_CONFLICT' || (!error.code && /submission key/i.test(error.message));

        if (isWorkflowConflict) {
          try {
            const [latestWorkflows, latestUsers] = await Promise.all([actionRepository.getWorkflows(), actionRepository.getUsers()]);
            setWorkflows(latestWorkflows);
            setUsers(latestUsers);
            return { success: false, routeChanged: true, error: 'The signing route changed. The latest route has been loaded. Your entries are preserved. Review the updated route before sending.' };
          } catch {
            return { success: false, routeChanged: true, error: 'The route changed and could not be refreshed. Your entries are still here. Check your connection and try again.' };
          }
        }
        if (isDraftConflict) {
          return { success: false, error: 'Your draft was updated in another session. Please reload the draft to review the latest changes before submitting.' };
        }
        if (isSubmissionConflict) {
          return { success: false, error: 'This submission key was already used for a different request. Please review your existing requests before submitting.' };
        }
      }
      if (typeof captureFrontendError !== 'undefined') {
        captureFrontendError(error, { flow: 'request-submission' });
      }
      return actionFailure(error);
    }
  };
  const revisionOf = (id: string) => (requests.find(r => r.id === id) as VersionedRequest | undefined)?.revision ?? 1;
  const pendingActions = useRef(new Set<string>());
  const runAction = async (requestId: string, performAction: () => Promise<VersionedRequest>) => {
    if (pendingActions.current.has(requestId)) return { success: false, error: 'A save is already in progress. Please wait.' };
    pendingActions.current.add(requestId);
    try {
      const updatedRequest = await performAction();
      setRequests(currentRequests => currentRequests.map(request => request.id === updatedRequest.id ? updatedRequest : request));
      return { success: true };
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        if (error.code === 'WORKFLOW_CONFLICT') {
          return { success: false, error: 'The workflow configuration changed in another session. Refresh the page to view the latest route.' };
        }
        if (error.code === 'DRAFT_CONFLICT') {
          return { success: false, error: 'The draft changed in another session. Refresh to load the latest draft.' };
        }
        try {
          const latestRequest = await actionRepository.getRequestById(requestId);
          if (latestRequest) {
            setRequests(currentRequests => currentRequests.map(request => request.id === requestId ? latestRequest : request));
            return { success: false, error: 'This request changed in another session. The latest version is now loaded. Your entries are preserved. Cancel this dialog to review the latest stage and document before confirming again.' };
          }
          return { success: false, error: 'This request changed in another session and is no longer available. Your entries are preserved.' };
        } catch (refreshError) {
          if (refreshError instanceof ApiError && (refreshError.status === 404 || refreshError.status === 403)) {
            return { success: false, error: 'This request changed in another session and is no longer available. Your entries are preserved.' };
          }
          return { success: false, error: 'This request changed in another session, but the latest version could not be loaded. Your entries are preserved. Check the connection and try again; no action was retried.' };
        }
      }
      if (typeof captureFrontendError !== 'undefined') {
        captureFrontendError(error, { flow: 'request-action' });
      }
      return actionFailure(error);
    } finally { pendingActions.current.delete(requestId); }
  };
  const approveRequest = (id: string, comment?: string, signatureDataUrl?: string) => runAction(id, () => actionRepository.approve(id, { expectedRevision: revisionOf(id), comment, signatureDataUrl: signatureDataUrl || '' }));
  const returnRequest = (id: string, reason: string) => runAction(id, () => actionRepository.returnForCorrection(id, { expectedRevision: revisionOf(id), reason }));
  const rejectRequestAction = (id: string, reason: string) => runAction(id, () => actionRepository.reject(id, { expectedRevision: revisionOf(id), reason }));
  const resubmitRequest = (id: string, formData: AdminWorkFormData, changeNote?: string, signatureDataUrl?: string, attachments?: AttachmentItem[]) => runAction(id, () => actionRepository.resubmit(id, {
    expectedRevision: revisionOf(id), formData: {
      dateOfRequest: formData.dateOfRequest, department: formData.department, priority: formData.priority,
      workDescription: formData.workDescription, documents: formData.documents, itRequest: formData.itRequest, rnd: formData.rnd && { ...formData.rnd, fields: Object.fromEntries(Object.entries(formData.rnd.fields).filter(([id]) => !id.startsWith('inpH'))), choices: Object.fromEntries(Object.entries(formData.rnd.choices).filter(([id]) => !id.startsWith('h'))) },
      administrativePayment: formData.administrativePayment && {
        documentDescription: formData.administrativePayment.documentDescription, payment: formData.administrativePayment.payment,
      },
      expenseClaim: formData.expenseClaim && {
        designation: formData.expenseClaim.designation, project: formData.expenseClaim.project, lines: formData.expenseClaim.lines,
      },
    }, changeNote, signatureDataUrl: signatureDataUrl || '', attachments,
  }));
  const readLatestRoute = (id: string) => actionRepository.getRequestById(id);
  const replaceSigner = (id: string, stageId: string, newUserId: string, reason: string) => runAction(id, () => actionRepository.replaceSigner(id,{ expectedRevision: revisionOf(id), stageId, newUserId, reason }));
  const acceptReplacement = (id: string, accept: boolean) => runAction(id, () => actionRepository.acceptReplacement(id,{ expectedRevision: revisionOf(id), accept }));
  const saveRndEvaluation: AppContextType['saveRndEvaluation'] = (id, evaluation) => runAction(id, () => actionRepository.saveRndEvaluation(id, { expectedRevision: revisionOf(id), evaluation }));
  const cancelRoute = (id: string, reason: string) => runAction(id, () => actionRepository.cancel(id, { expectedRevision: revisionOf(id), reason }));
  const recordRouteProcessing: AppContextType['recordRouteProcessing'] = (id, action, note, signatureDataUrl, attachment) => runAction(id, () => actionRepository.recordProcessing(id, { expectedRevision: revisionOf(id), action, note, signatureDataUrl, attachment }));
  const directorOverrideAction = (id: string, reason: string, signatureDataUrl?: string) => runAction(id, () => actionRepository.override(id, { expectedRevision: revisionOf(id), reason, signatureDataUrl: signatureDataUrl || '' }));

  const resetDemoData = async () => {
    if (readOnly) return;
    await dataService.resetToSeedData();
    const [allCompanies, allUsers, allWorkflows, allRequests] = await Promise.all([
      dataService.getCompanies(),
      dataService.getUsers(),
      dataService.getWorkflows(),
      dataService.getRequests(),
    ]);
    setRequests(allRequests);
    setWorkflows(allWorkflows);
    setUsers(allUsers);
    setCompanies(allCompanies);
    setSelectedScopeState(activeDemoDataset.session.companyId);
    setCurrentUserIdState(activeDemoDataset.session.userId);
    setActiveView('dashboard');
    setDraftFormData(null);
  };

  if (initialError) return <div className="p-6 text-sm" role="alert">{initialError}</div>;

  if (readOnly && !matchingUser) return <p role="alert" className="p-6">Could not load your account. Reload to sign in again.</p>;

  return (
    <AppContext.Provider
      value={{
        readOnly,
        companies,
        selectedScope,
        selectedCompanyId: selectedScope,
        selectedCompany,
        setSelectedScope,
        setSelectedCompanyId: setSelectedScope,
        users,
        currentUser,
        setCurrentUserId,
        requestEmailChange: apiRepository ? (email, currentPassword) => apiRepository.requestEmailChange(email, currentPassword) : undefined,
        updateUserName,
        updateUserSignature,
        requests,
        refreshRequests,
        recordProcessorRead,
        reassignProcessor,
        companyRequests,
        signingQueue,
        showSigningInbox,
        workflows,
        currentWorkflow,
        saveWorkflow,
        navigationPrompt: navigation.pending ? { stay: navigation.stay, leave: navigation.leave } : null,
        setUnsavedWork: navigation.setDirty,
        requestRouteStatus,
        retryRequestRoute: () => { setResolvedRoute({ key: routeKey, status: 'loading' }); setRouteRetry(value => value + 1); },
        activeView,
        setActiveView,
        isMobileSidebarOpen,
        setIsMobileSidebarOpen,
        requestsFilter,
        setRequestsFilter,
        selectedRequestId,
        openReviewRequest,
        signatureReturn,
        setSignatureReturn,
        openSignatureProfile: () => {
          navigation.clearDirty();
          navigation.setActiveView('user-profile');
        },
        selectedRequestFormType,
        setSelectedRequestFormType,
        locationHook: navigation.locationHook,
        draftFormData,
        draftCompanyId,
        selectDraftCompany: (company) => { if (selectedScope === 'PEG') setGroupDraftCompany(company); else setSelectedScope(company); },
        reloadDraft: () => { reloadDraftKeys.current.add(draftKey); setLoadedDraftKey(''); setDraftRetry(value => value + 1); },
        draftReady: initialLoaded && loadedDraftKey === draftKey,
        draftError,
        retryDraft: () => setDraftRetry(value => value + 1),
        saveDraft,
        clearDraft,
        loadITDraft,
        saveITDraft,
        clearITDraft,
        submitNewRequest,
        approveRequest,
        returnRequest,
        resubmitRequest,
        rejectRequestAction,
        directorOverrideAction,
        saveRndEvaluation,
      cancelRoute,
        recordRouteProcessing,
        replaceSigner,
        acceptReplacement,
        readLatestRoute,
        downloadAttachment: apiRepository ? (id, version, fileId) => apiRepository.downloadAttachment(id, version, fileId) : undefined,
        downloadDocumentPdf: apiRepository
          ? (id, version, updatedAt) => apiRepository.downloadDocumentPdf(id, version, updatedAt)
          : async (id, version, updatedAt) => {
              const record = await actionRepository.getRequestById(id);
              if (!record || !canReadPreciRoute(currentUser, record) || record.updatedAt !== updatedAt) throw new Error('The route changed or is unavailable. Reload and review before downloading.');
              const { createDemoDocumentPdf } = await import('../components/document/downloadDemoPdf');
              const pdf = await createDemoDocumentPdf(record, version);
              const latest = await actionRepository.getRequestById(id);
              if (!latest || !canReadPreciRoute(currentUser, latest) || latest.updatedAt !== updatedAt) throw new Error('The route changed or is unavailable. Reload and review before downloading.');
              return pdf;
            },
        resetDemoData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};

/** Compare editable state against its mounted/loaded baseline; UI-only state is excluded. */
export function useUnsavedWork(snapshot: string, ready = true) {
  const { setUnsavedWork } = useApp();
  const key = useRef(Symbol('editor'));
  const baseline = useRef<string | null>(ready ? snapshot : null);
  useEffect(() => {
    if (!ready) return;
    if (baseline.current === null) baseline.current = snapshot;
    setUnsavedWork(key.current, snapshot !== baseline.current);
    return () => setUnsavedWork(key.current, false);
  }, [snapshot, ready, setUnsavedWork]);
}
