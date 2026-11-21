import * as Sentry from '@sentry/react';
import React from 'react';

/**
 * PreciSign Privacy-Conscious Frontend Sentry Integration.
 *
 * Configured through Vite environment variables:
 * - VITE_SENTRY_DSN: Public Sentry DSN (safe to expose in client bundle). Optional.
 * - VITE_SENTRY_ENVIRONMENT: Application environment (e.g., 'production', 'development').
 * - VITE_SENTRY_RELEASE: Optional release identifier.
 *
 * If VITE_SENTRY_DSN is absent or empty, Sentry remains disabled and PreciSign operates
 * completely normally with zero telemetry overhead or network traffic.
 */

const DATA_URL_REGEX = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g;
const TOKEN_REGEX = /([?&#](?:token|key|password|sig|reset)=)[^&#\s]+/gi;
const RESET_HASH_REGEX = /#reset=[^&#\s]+/gi;

/** Sanitize URLs to remove password reset tokens or secret query params */
export function sanitizeUrl(url?: string): string | undefined {
  if (!url) return url;
  return url
    .replace(RESET_HASH_REGEX, '#reset=[REDACTED]')
    .replace(TOKEN_REGEX, '$1[REDACTED]');
}

/** Sanitize strings to strip base64 signature/attachment images and token bytes */
export function sanitizeString(text?: string): string | undefined {
  if (!text) return text;
  return text
    .replace(DATA_URL_REGEX, '[IMAGE_DATA_REDACTED]')
    .replace(TOKEN_REGEX, '$1[REDACTED]');
}

export function filterFrontendSentryEvent<T extends Sentry.Event>(event: T, hint: Sentry.EventHint) {
  // 1. Never report expected 4xx user validation, auth, or conflict errors.
  // Free-tier quota is reserved exclusively for unexpected application failures (5xx, uncaught crashes).
  const error = hint.originalException as { status?: number } | undefined;
  if (error && typeof error.status === 'number' && error.status >= 400 && error.status < 500) {
    return null;
  }

  // 2. Strict User Privacy: Strip any employee identifiers, names, or emails
  delete event.user;

  // 3. Strip sensitive request context
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    if (event.request.url) {
      event.request.url = sanitizeUrl(event.request.url);
    }
  }

  // 4. Sanitize exception values to ensure base64 signature/attachment bytes are redacted
  if (event.exception?.values) {
    for (const exception of event.exception.values) {
      if (exception.value) {
        exception.value = sanitizeString(exception.value);
      }
    }
  }

  // 5. Sanitize breadcrumbs attached to the event
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map(breadcrumb => {
      if (breadcrumb.data?.url) {
        breadcrumb.data.url = sanitizeUrl(String(breadcrumb.data.url));
      }
      if (breadcrumb.message) {
        breadcrumb.message = sanitizeString(breadcrumb.message);
      }
      if (breadcrumb.data?.body) {
        delete breadcrumb.data.body;
      }
      return breadcrumb;
    });
  }

  return event;
}

export function initFrontendSentry(): void {
  const dsn = import.meta.env?.VITE_SENTRY_DSN;
  if (!dsn || typeof dsn !== 'string' || !dsn.trim()) {
    return;
  }

  Sentry.init({
    dsn: dsn.trim(),
    enabled: true,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || (import.meta.env.DEV ? 'development' : 'production'),
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,

    // Conservative Free-Tier Configuration:
    // Performance tracing and session replays are disabled to minimize data volume,
    // prevent quota exhaustion, and eliminate memory/CPU overhead on client devices.
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    // Strict Employee Privacy Configuration:


    beforeSend: filterFrontendSentryEvent,

    beforeBreadcrumb(breadcrumb) {
      // Strip request bodies and sanitize URLs in fetch/xhr breadcrumbs
      if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
        if (breadcrumb.data?.url) {
          breadcrumb.data.url = sanitizeUrl(String(breadcrumb.data.url));
        }
        if (breadcrumb.data?.body) {
          delete breadcrumb.data.body;
        }
      }
      if (breadcrumb.message) {
        breadcrumb.message = sanitizeString(breadcrumb.message);
      }
      return breadcrumb;
    },
  });
}

/**
 * Capture an unexpected frontend failure with sanitized operational tags.
 * Only unexpected errors (5xx or uncaught crashes) are captured.
 */
export function captureFrontendError(error: unknown, context?: { flow?: string; status?: number; formType?: string }): void {
  if (!import.meta.env?.VITE_SENTRY_DSN) return;
  const status = typeof (error as any)?.status === 'number' ? (error as any).status : context?.status;

  // Do not report expected user/client errors (400, 401, 403, 404, 409, 429)
  if (status && status >= 400 && status < 500) {
    return;
  }

  Sentry.withScope(scope => {
    if (context?.flow) scope.setTag('flow', context.flow);
    if (context?.formType) scope.setTag('form_type', context.formType);
    if (status) scope.setTag('http_status', String(status));
    Sentry.captureException(error);
  });
}

/** Fallback UI presented when a React component crashes */
export const DefaultErrorFallback: React.FC<{ resetError?: () => void }> = ({ resetError }) => (
  <div role="alert" className="workspace-panel m-6 max-w-xl space-y-4 p-6">
    <h1 className="text-xl font-bold text-slate-900">An unexpected application error occurred</h1>
    <p className="text-sm text-workspace-muted">
      PreciSign encountered a problem loading this view. Your entries and account access remain secure.
    </p>
    <div className="flex gap-3">
      <button
        type="button"
        onClick={() => resetError ? resetError() : window.location.reload()}
        className="workspace-primary min-h-10 px-4 text-sm font-semibold"
      >
        Reload page
      </button>
      <a
        href="/"
        className="workspace-control inline-flex min-h-10 items-center px-4 text-sm font-semibold"
      >
        Return to Dashboard
      </a>
    </div>
  </div>
);

/**
 * Sentry ErrorBoundary wrapper: preserves user-friendly crash recovery while
 * capturing uncaught component errors to Sentry if configured.
 */
export const SentryErrorBoundary: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  if (!import.meta.env?.VITE_SENTRY_DSN) {
    return <>{children}</>;
  }
  return (
    <Sentry.ErrorBoundary fallback={({ resetError }) => <DefaultErrorFallback resetError={resetError} />}>
      {children}
    </Sentry.ErrorBoundary>
  );
};

