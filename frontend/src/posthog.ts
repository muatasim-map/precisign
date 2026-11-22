import posthog from 'posthog-js';

const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
const posthogHost = import.meta.env.VITE_POSTHOG_HOST;
let isPostHogInitialized = false;

if (!posthogKey || !posthogHost) {
  if (import.meta.env.DEV) {
    const missingVariable = !posthogKey ? 'VITE_POSTHOG_KEY' : 'VITE_POSTHOG_HOST';
    throw new Error(`${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`);
  }
} else {
  posthog.init(posthogKey, {
    api_host: posthogHost,
    defaults: '2026-08-30',
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
  });
  isPostHogInitialized = true;
}

type IdentifiedUser = {
  id: string;
  email: string;
  name: string;
  role: string;
  department: string;
  companyId: string;
  isSuperAdmin?: boolean;
};

export function identifyPostHogUser(user: IdentifiedUser) {
  if (!isPostHogInitialized) return;
  posthog.identify(user.id, {
    email: user.email,
    name: user.name,
    role: user.role,
    department: user.department,
    company_id: user.companyId,
    is_super_admin: Boolean(user.isSuperAdmin),
  });
}

export function resetPostHog() {
  if (isPostHogInitialized) posthog.reset();
}

export function capturePostHog(event: string, properties?: Record<string, string | number | boolean>) {
  if (isPostHogInitialized) posthog.capture(event, properties);
}

export default posthog;
