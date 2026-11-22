import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs';

interface PostHogLogger {
  emit(body: string, attributes?: Record<string, string | number | boolean>): void;
  shutdown(): Promise<void>;
}

const noopLogger: PostHogLogger = {
  emit: () => {},
  shutdown: async () => {},
};

let activeLogger: PostHogLogger = noopLogger;

export function createPostHogLogger(): PostHogLogger {
  const token = process.env.VITE_POSTHOG_KEY?.trim();
  const host = process.env.VITE_POSTHOG_HOST?.trim().replace(/\/$/, '');
  if (!token || !host) {
    if (process.env.NODE_ENV !== 'production') {
      if (!token) console.warn('VITE_POSTHOG_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_KEY is configured');
      if (!host) console.warn('VITE_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once VITE_POSTHOG_HOST is configured');
    }
    return noopLogger;
  }

  const provider = new LoggerProvider({
    resource: resourceFromAttributes({ 'service.name': 'precisign-api' }),
  });
  provider.addLogRecordProcessor(new BatchLogRecordProcessor(new OTLPLogExporter({
    url: `${host}/i/v1/logs`,
    headers: { Authorization: `Bearer ${token}` },
  })));
  const logger = provider.getLogger('precisign-posthog');

  return {
    emit(body, attributes) {
      logger.emit({ severityText: 'info', body, attributes });
    },
    async shutdown() {
      await Promise.race([
        provider.shutdown(),
        new Promise<void>(resolve => setTimeout(resolve, 2000)),
      ]).catch(() => console.warn('PostHog log exporter shutdown did not complete.'));
    },
  };
}

export function initializePostHogLogger(): PostHogLogger {
  activeLogger = createPostHogLogger();
  return activeLogger;
}

export function emitPostHogLog(body: string, attributes?: Record<string, string | number | boolean>): void {
  activeLogger.emit(body, attributes);
}
