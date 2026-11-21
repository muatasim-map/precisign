import { useCallback, useEffect, useRef } from 'react';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { useApp } from '../../context/AppContext';
import { isShowcaseBuild } from '../../config/demo';
import { canConfigureSigningRoutes } from '../../utils/workflowAdministration';
import { buildTourSteps, hasSeenTour, markTourSeen, type TourMode, type TourStep } from './tourSteps';

const startEvent = 'precisign:start-tour';

/** Replays the product tour from anywhere in the shell (help button, menus). */
export function requestProductTour() {
  window.dispatchEvent(new Event(startEvent));
}

const mobileQuery = '(max-width: 1023.98px)';
const isMobile = () => window.matchMedia?.(mobileQuery).matches ?? false;
const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

function visible(selector: string): Element | null {
  const element = document.querySelector(selector);
  if (!element || element.closest('[inert],[hidden]')) return null;
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' ? element : null;
}

async function waitForVisible(selector: string, timeout = 2500): Promise<Element | null> {
  const end = Date.now() + timeout;
  for (;;) {
    const element = visible(selector);
    if (element || Date.now() > end) return element;
    await wait(50);
  }
}

/**
 * Driver.js tour for the shared MainLayout (connected, demo and showcase).
 * Navigation goes through AppContext so the unsaved-work guard still applies;
 * if that guard asks the user to confirm, the tour ends and leaves the prompt alone.
 */
export function useProductTour({ awaitingAccess, canOpenDirectory, revealSidebar }: {
  awaitingAccess: boolean;
  canOpenDirectory: boolean;
  revealSidebar: () => void;
}) {
  const {
    readOnly, currentUser, companies, selectedScope, showSigningInbox, activeView,
    setActiveView, setIsMobileSidebarOpen, navigationPrompt,
  } = useApp();
  const mode: TourMode = readOnly ? 'api' : isShowcaseBuild ? 'showcase' : 'demo';
  const hasCompanies = !readOnly || companies.length > 0;
  const scopedCompanies = companies.filter(company => selectedScope === 'PEG' || company.id === selectedScope).map(company => company.id);
  const showRouteSettings = !readOnly || scopedCompanies.some(company => canConfigureSigningRoutes(currentUser, company));

  const live = useRef({ activeView, setActiveView, setIsMobileSidebarOpen, revealSidebar });
  live.current = { activeView, setActiveView, setIsMobileSidebarOpen, revealSidebar };
  const tour = useRef<Driver | null>(null);

  // Detach first so a step still waiting for its page sees the tour has ended.
  const stop = useCallback(() => {
    const current = tour.current;
    tour.current = null;
    current?.destroy();
  }, []);

  const start = useCallback(() => {
    stop();
    const steps = buildTourSteps({ mode, showApprovals: showSigningInbox, showRouteSettings, canOpenDirectory, hasCompanies });
    const userId = currentUser.id;
    let ended = false;
    let started = false;
    let busy = false;
    let openedDrawer = false;

    async function prepare(step: TourStep): Promise<boolean> {
      const { activeView: view, setActiveView: go, setIsMobileSidebarOpen: setDrawer, revealSidebar: reveal } = live.current;
      let changed = false;
      if (step.view && view !== step.view) { go(step.view); changed = true; }
      const mobile = isMobile();
      if (step.area === 'sidebar') {
        if (mobile && !openedDrawer) { setDrawer(true); openedDrawer = true; changed = true; } else if (!mobile) reveal();
      } else if (mobile && openedDrawer) {
        setDrawer(false); openedDrawer = false; changed = true;
      }
      if (!step.selector) return true;
      // Wait for a page or drawer that is still rendering; an anchor that is simply hidden (e.g. search on phones) is skipped quickly.
      const found = await waitForVisible(step.selector, changed ? 2500 : 250);
      if (found && changed && mobile) await wait(320); // let the drawer finish sliding before measuring
      return Boolean(found);
    }

    async function show(from: number, direction: 1 | -1) {
      if (busy) return;
      busy = true;
      try {
        for (let index = from; index >= 0 && index < steps.length; index += direction) {
          const ready = await prepare(steps[index]);
          // Closed while waiting (close button, Escape, persona switch, unsaved-work prompt):
          // never re-open on top of whatever the user is now looking at.
          if (ended || tour.current !== instance || (started && !instance.isActive())) return;
          if (!ready) continue;
          if (started) instance.moveTo(index);
          else { started = true; markTourSeen(mode, userId); instance.drive(index); }
          return;
        }
        if (direction === 1) instance.destroy();
      } finally {
        busy = false;
      }
    }

    const instance = driver({
      popoverClass: 'preci-tour',
      overlayColor: '#0e1d2c',
      overlayOpacity: 0.55,
      stagePadding: 6,
      stageRadius: 10,
      allowClose: true,
      showProgress: false,
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      steps: steps.map(step => ({
        element: step.selector,
        popover: { title: step.title, description: step.body },
      })),
      onNextClick: () => { void show((instance.getActiveIndex() ?? -1) + 1, 1); },
      onPrevClick: () => { void show((instance.getActiveIndex() ?? 1) - 1, -1); },
      onDestroyed: () => {
        ended = true;
        if (openedDrawer) live.current.setIsMobileSidebarOpen(false);
        if (tour.current === instance) tour.current = null;
      },
    });
    tour.current = instance;
    void show(0, 1);
  }, [mode, showSigningInbox, showRouteSettings, canOpenDirectory, hasCompanies, currentUser.id, stop]);

  const startRef = useRef(start);
  startRef.current = start;

  // Replay from the help button.
  useEffect(() => {
    const onStart = () => startRef.current();
    window.addEventListener(startEvent, onStart);
    return () => window.removeEventListener(startEvent, onStart);
  }, []);

  // First visit per user and mode, from the overview only.
  useEffect(() => {
    if (awaitingAccess || hasSeenTour(mode, currentUser.id)) return;
    const timer = window.setTimeout(() => {
      const path = window.location.pathname;
      const shellLive = !document.querySelector('.preci-shell')?.closest('[inert],[hidden]');
      if ((path === '/' || path === '/dashboard') && shellLive && !hasSeenTour(mode, currentUser.id)) startRef.current();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [awaitingAccess, mode, currentUser.id]);

  // Persona switch or sign-out: end the previous user's tour.
  useEffect(() => stop, [currentUser.id, stop]);

  // The unsaved-work guard opened its confirm dialog: get out of its way.
  useEffect(() => { if (navigationPrompt) stop(); }, [navigationPrompt, stop]);
}
