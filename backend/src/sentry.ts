import * as Sentry from '@sentry/node';

/**
 * PreciSign Privacy-Conscious Backend Sentry Integration.
 *
 * Configured through environment variables:
 * - SENTRY_DSN: Private Sentry DSN. If absent or empty, Sentry remains disabled
 *   and PreciSign operates completely normally with zero telemetry overhead.
 * - SENTRY_ENVIRONMENT: Application environment ('production', 'development', etc.).
 * - SENTRY_RELEASE: Optional release tag.
 */

const DATA_URL_REGEX = /data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g;
const TOKEN_REGEX = /([?&#](?:token|key|password|sig|reset)=)[^&#\s]+/gi;
const RESET_HASH_REGEX = /#reset=[^&#\s]+/gi;

/** Sanitize URLs to remove password reset tokens or secret query parameters */
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

/**
 * Event filter for Sentry. Enforces:
 * 1. Dropping expected 4xx user validation, authorization, or conflict responses.
 * 2. Scrubbing user identity (no names, IDs, or emails sent).
 * 3. Scrubbing request bodies, cookies, and sensitive headers.
 * 4. Redacting base64 signatures/attachment bytes from exception messages.
 */
export function filterSentryEvent(event: any, hint?: any): any | null {
  // 1. Never report expected 4xx user validation, auth, or conflict errors.
  const error = hint?.originalException as { status?: number; statusCode?: number } | undefined;
  const status = error?.status ?? error?.statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return null;
  }

  // 2. Strict User Privacy: Strip any employee identifiers, names, or emails
  delete event.user;

  // 3. Strip sensitive request context: cookies, headers, and request body (data)
  if (event.request) {
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.data;
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
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb: any) => {
      if (breadcrumb.data?.url) {
        breadcrumb.data.url = sanitizeUrl(String(breadcrumb.data.url));
      }
      if (breadcrumb.data?.body) {
        delete breadcrumb.data.body;
      }
      if (breadcrumb.message) {
        breadcrumb.message = sanitizeString(breadcrumb.message);
      }
      return breadcrumb;
    });
  }

  return event;
}

export function initBackendSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || typeof dsn !== 'string' || !dsn.trim()) {
    return;
  }

  Sentry.init({
    dsn: dsn.trim(),
    enabled: true,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production',
    release: process.env.SENTRY_RELEASE || undefined,

    // Conservative Free-Tier Configuration:
    // Performance tracing disabled to minimize data volume and memory footprint
    tracesSampleRate: 0,

    beforeSend(event, hint) {
      return filterSentryEvent(event, hint);
    },

    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data?.url) {
        breadcrumb.data.url = sanitizeUrl(String(breadcrumb.data.url));
      }
      if (breadcrumb.data?.body) {
        delete breadcrumb.data.body;
      }
      if (breadcrumb.message) {
        breadcrumb.message = sanitizeString(breadcrumb.message);
      }
      return breadcrumb;
    },
  });
}

/**
 * Capture an unexpected backend failure with sanitized operational tags.
 * Only unexpected errors (5xx or uncaught server errors) are reported.
 */
export function captureBackendError(
  error: unknown,
  context?: { route?: string; status?: number; code?: string }
): void {
  if (!process.env.SENTRY_DSN) return;
  const status = typeof (error as any)?.status === 'number'
    ? (error as any).status
    : typeof (error as any)?.statusCode === 'number'
      ? (error as any).statusCode
      : context?.status;

  // Do not report expected user/client errors (400, 401, 403, 404, 409, 429)
  if (status && status >= 400 && status < 500) {
    return;
  }

  Sentry.withScope(scope => {
    if (context?.route) scope.setTag('route', context.route);
    if (context?.code) scope.setTag('error_code', context.code);
    if (status) scope.setTag('http_status', String(status));
    Sentry.captureException(error);
  });
}
