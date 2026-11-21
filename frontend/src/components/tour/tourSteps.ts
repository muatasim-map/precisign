import type { PageView } from '../../navigation/pageRoutes';

/** Shell the tour runs in. Each mode keeps its own "seen" flag. */
export type TourMode = 'api' | 'demo' | 'showcase';

export interface TourContext {
  mode: TourMode;
  /** Pending-signature inbox is visible to this user. */
  showApprovals: boolean;
  /** Signing-routes administration link is visible to this user. */
  showRouteSettings: boolean;
  /** User directory and branding links are visible (Super Administrator). */
  canOpenDirectory: boolean;
  /** A company is assigned, so request and form navigation is shown. */
  hasCompanies: boolean;
}

/**
 * One tour stop. `area` tells the runner whether the anchor lives in the
 * (off-canvas on mobile) sidebar or in the page, so it can open or close the
 * drawer first. `view` is the page to show before the step, navigated through
 * the existing AppContext methods.
 */
export interface TourStep {
  id: string;
  selector?: string;
  area: 'sidebar' | 'header' | 'page' | 'none';
  view?: PageView;
  title: string;
  body: string;
}

const tourAnchor = (name: string) => `[data-tour="${name}"]`;

/** Ordered tour stops for this user. Hidden steps are omitted, never shown with promises of access. */
export function buildTourSteps(ctx: TourContext): TourStep[] {
  const steps: TourStep[] = [];
  const add = (step: TourStep, when = true) => { if (when) steps.push(step); };

  add({
    id: 'welcome', area: 'none',
    title: 'Welcome to PreciSign',
    body: ctx.mode === 'api'
      ? 'A short tour of where requests are started, tracked and signed. You can replay it any time from the help button.'
      : 'A short tour of this demo workspace. You can replay it any time from the help button.',
  });

  // Navigation basics
  add({
    id: 'sidebar', selector: tourAnchor('sidebar-nav'), area: 'sidebar',
    title: 'Workspace navigation',
    body: 'Everything lives here: your overview, request lists, forms and settings.',
  });
  add({
    id: 'company', selector: tourAnchor('company-switcher'), area: 'header',
    title: 'Viewing scope',
    body: 'Focus the view on one company or the whole group. Changing the view does not change what you are allowed to do.',
  }, ctx.hasCompanies);
  add({
    id: 'search', selector: tourAnchor('search'), area: 'header',
    title: 'Find a request',
    body: 'Search visible requests by ID, requester or description.',
  }, ctx.hasCompanies);

  // Create a request
  add({
    id: 'nav-forms', selector: tourAnchor('nav-forms'), area: 'sidebar',
    title: 'Start a request',
    body: 'Open the Forms Library to start a new request.',
  }, ctx.hasCompanies);
  add({
    id: 'forms-library', selector: tourAnchor('forms-library'), area: 'page', view: 'forms-library',
    title: 'Forms Library',
    body: 'Choose a form, then the legal company it belongs to. Only forms you may start for that company can be submitted.',
  }, ctx.hasCompanies);

  // Review and sign
  add({
    id: 'nav-approvals', selector: tourAnchor('nav-approvals'), area: 'sidebar',
    title: 'To sign',
    body: 'Requests with a stage assigned to you appear here, with a count of what is waiting.',
  }, ctx.hasCompanies && ctx.showApprovals);
  add({
    id: 'nav-my-requests', selector: tourAnchor('nav-my-requests'), area: 'sidebar',
    title: 'Track your requests',
    body: 'Follow each request you submitted through its signing route, and correct any that are returned to you.',
  }, ctx.hasCompanies);
  add({
    id: 'nav-archive', selector: tourAnchor('nav-archive'), area: 'sidebar',
    title: 'Archive & Register',
    body: 'Completed requests and their signed documents are kept here.',
  }, ctx.hasCompanies);

  // Settings and profile
  add({
    id: 'nav-profile', selector: tourAnchor('nav-profile'), area: 'sidebar',
    title: 'Signature & profile',
    body: 'Set up your signature here. It is used when you sign a stage assigned to you.',
  });
  add({
    id: 'nav-signing-routes', selector: tourAnchor('nav-signing-routes'), area: 'sidebar',
    title: 'Signing routes',
    body: 'Configure who signs each form, in what order, and their backups.',
  }, ctx.showRouteSettings);
  add({
    id: 'nav-directory', selector: tourAnchor('nav-directory'), area: 'sidebar',
    title: 'Users and branding',
    body: 'Manage accounts, company and form grants, and company branding.',
  }, ctx.canOpenDirectory);

  add({
    id: 'replay', selector: tourAnchor('tour-replay'), area: 'header',
    title: 'That’s the tour',
    body: 'Use this button whenever you want to see it again.',
  });
  return steps;
}

type TourStorage = Pick<Storage, 'getItem' | 'setItem'>;

export const tourKey = (mode: TourMode, userId: string) => `precisign.tour.v1.${mode}.${userId}`;

function defaultStorage(): TourStorage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

/** True when stored; storage failures count as not seen, so the tour still works for this visit. */
export function hasSeenTour(mode: TourMode, userId: string, storage = defaultStorage()): boolean {
  try { return storage?.getItem(tourKey(mode, userId)) === 'done'; } catch { return false; }
}

export function markTourSeen(mode: TourMode, userId: string, storage = defaultStorage()): void {
  try { storage?.setItem(tourKey(mode, userId), 'done'); } catch { /* storage unavailable: the tour may show again next visit */ }
}
