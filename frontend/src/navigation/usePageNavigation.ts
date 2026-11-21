import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearch as browserSearchHook } from 'wouter/use-browser-location';
import { pageRouteHref, parsePageRoute, type PageRoute, type PageView, type RequestFilter } from './pageRoutes';

const positionKey = 'precisignPagePosition';

/** One URL-derived page state; connects wouter declarative routing with unsaved work protection. */
export function usePageNavigation() {
  const [route, setRoute] = useState(() => parsePageRoute(window.location.href));
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const current = useRef(route);
  const position = useRef(Number(window.history.state?.[positionKey]) || 0);
  const dirty = useRef(new Map<symbol, boolean>());
  const [pending, setPending] = useState<{ href?: string; delta?: number; run?: () => void } | null>(null);
  const pendingRef = useRef(pending);
  const ignorePop = useRef(false);
  const form = useRef(route.formType || 'Admin Work Request');
  const filter = useRef<RequestFilter>(route.filter || 'all');
  const setDirty = useCallback((key: symbol, value: boolean) => { if (value) dirty.current.set(key, true); else dirty.current.delete(key); }, []);
  const hasUnsavedWork = useCallback(() => [...dirty.current.values()].some(Boolean), []);

  const applyLocation = useCallback(() => {
    const next = parsePageRoute(window.location.href);
    current.current = next;
    setPathname(window.location.pathname);
    if (next.formType) form.current = next.formType;
    if (next.filter) filter.current = next.filter;
    setRoute(next);
  }, []);

  const commit = useCallback((href: string, replace = false) => {
    const destination = new URL(href, window.location.origin);
    if (destination.origin !== window.location.origin) throw Error('Navigation must stay inside PreciSign.');
    if (destination.pathname + destination.search + destination.hash === window.location.pathname + window.location.search + window.location.hash) return;
    if (!replace) {
      position.current++;
    }
    const state = { ...window.history.state, [positionKey]: position.current };
    if (replace) {
      window.history.replaceState(state, '', href);
    } else {
      window.history.pushState(state, '', href);
    }
    applyLocation();
    window.dispatchEvent(new Event('pushState'));
    window.dispatchEvent(new Event('popstate'));
  }, [applyLocation]);

  const navigateByHref = useCallback((href: string, replace = false) => {
    const target = new URL(href, window.location.origin);
    const targetFull = target.pathname + target.search;
    const currentFull = window.location.pathname + window.location.search;
    if (targetFull === currentFull) return;
    if (hasUnsavedWork()) {
      const value = { href };
      pendingRef.current = value;
      setPending(value);
      return;
    }
    commit(href, replace);
  }, [hasUnsavedWork, commit]);

  const navigate = useCallback((next: PageRoute) => {
    navigateByHref(pageRouteHref(next));
  }, [navigateByHref]);

  useEffect(() => {
    window.history.replaceState({ ...window.history.state, [positionKey]: position.current }, '');
    const onPop = () => {
      const target = Number(window.history.state?.[positionKey]);
      if (ignorePop.current) { ignorePop.current = false; return; }
      if (hasUnsavedWork()) {
        const delta = (Number.isFinite(target) && target !== position.current)
          ? (target - position.current)
          : -1;
        ignorePop.current = true;
        window.history.go(-delta);
        const value = { delta }; pendingRef.current = value; setPending(value);
        return;
      }
      position.current = Number.isFinite(target) ? target : 0;
      applyLocation();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedWork()) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => { window.removeEventListener('popstate', onPop); window.removeEventListener('beforeunload', onBeforeUnload); };
  }, [applyLocation, hasUnsavedWork]);

  const locationHook = useMemo(() => {
    const fn = () => [pathname, (to: string, opts?: { replace?: boolean }) => navigateByHref(to, opts?.replace)] as [string, (to: string, ...args: any[]) => any];
    (fn as any).searchHook = browserSearchHook;
    return fn;
  }, [pathname, navigateByHref]);

  return {
    route, pending,
    pathname,
    locationHook,
    navigateByHref,
    setDirty,
    runGuarded: (run: () => void) => {
      if (hasUnsavedWork()) { const value = { run }; pendingRef.current = value; setPending(value); }
      else run();
    },
    clearDirty: () => dirty.current.clear(),
    stay: () => { pendingRef.current = null; setPending(null); },
    leave: () => {
      const destination = pendingRef.current;
      dirty.current.clear(); pendingRef.current = null; setPending(null);
      if (destination?.run) destination.run();
      else if (destination?.delta) window.history.go(destination.delta);
      else if (destination?.href) commit(destination.href);
    },
    setActiveView: (view: PageView) => navigate({ view, formType: form.current, filter: filter.current, requestId: current.current.requestId }),
    setForm: (value: string) => { form.current = value; if (current.current.view === 'create-request') navigate({ view: 'create-request', formType: value }); },
    setFilter: (value: RequestFilter) => { filter.current = value; if (current.current.view === 'requests') navigate({ view: 'requests', filter: value }); },
    openRequest: (requestId: string) => navigate({ view: 'review-sign', requestId }),
    selectedForm: route.formType || form.current,
    selectedFilter: route.filter || filter.current,
  };
}
