import { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname, navigate as wouterNavigate } from 'wouter/use-browser-location';

const positionKey = 'precisignPagePosition';

export interface NavigationPromptState {
  stay: () => void;
  leave: () => void;
}

export interface GuardedLocationOptions {
  hasUnsavedWork?: () => boolean;
  clearDirty?: () => void;
}

export function useGuardedLocation(options?: GuardedLocationOptions) {
  const pathname = usePathname();
  const position = useRef(Number(window.history.state?.[positionKey]) || 0);
  const [pending, setPending] = useState<{ to?: string; delta?: number; run?: () => void; replace?: boolean } | null>(null);
  const pendingRef = useRef(pending);
  const ignorePop = useRef(false);

  // Initialize position key
  useEffect(() => {
    window.history.replaceState({ ...window.history.state, [positionKey]: position.current }, '');
  }, []);

  const guardedNavigate = useCallback((to: string, navOptions?: { replace?: boolean; state?: any }) => {
    const currentFull = window.location.pathname + window.location.search;
    if (to === currentFull) return;

    if (options?.hasUnsavedWork && options.hasUnsavedWork()) {
      const val = { to, replace: navOptions?.replace };
      pendingRef.current = val;
      setPending(val);
      return;
    }

    if (!navOptions?.replace) {
      position.current++;
    }
    wouterNavigate(to, {
      ...navOptions,
      state: { ...navOptions?.state, [positionKey]: position.current },
    });
  }, [options]);

  useEffect(() => {
    const onPop = () => {
      const target = Number(window.history.state?.[positionKey]);
      if (ignorePop.current) {
        ignorePop.current = false;
        return;
      }
      if (options?.hasUnsavedWork && options.hasUnsavedWork() && Number.isFinite(target) && target !== position.current) {
        const delta = target - position.current;
        ignorePop.current = true;
        window.history.go(-delta);
        const val = { delta };
        pendingRef.current = val;
        setPending(val);
        return;
      }
      position.current = Number.isFinite(target) ? target : 0;
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (options?.hasUnsavedWork && options.hasUnsavedWork()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    window.addEventListener('popstate', onPop);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [options]);

  const stay = useCallback(() => {
    pendingRef.current = null;
    setPending(null);
  }, []);

  const leave = useCallback(() => {
    const destination = pendingRef.current;
    if (options?.clearDirty) {
      options.clearDirty();
    }
    pendingRef.current = null;
    setPending(null);

    if (destination?.run) {
      destination.run();
    } else if (destination?.delta) {
      window.history.go(destination.delta);
    } else if (destination?.to) {
      if (!destination.replace) {
        position.current++;
      }
      wouterNavigate(destination.to, {
        replace: destination.replace,
        state: { [positionKey]: position.current },
      });
    }
  }, [options]);

  const runGuarded = useCallback((run: () => void) => {
    if (options?.hasUnsavedWork && options.hasUnsavedWork()) {
      const val = { run };
      pendingRef.current = val;
      setPending(val);
    } else {
      run();
    }
  }, [options]);

  const locationHook = useCallback(() => {
    return [pathname, guardedNavigate] as const;
  }, [pathname, guardedNavigate]);

  return {
    pathname,
    navigate: guardedNavigate,
    locationHook,
    pendingPrompt: pending ? { stay, leave } : null,
    runGuarded,
  };
}
