import { defineCloudflareOptions } from "@sentry/cloudflare";

export default defineCloudflareOptions((env) => ({
  dsn: "https://da0edad286f5ff43118271631a88513b@o4512477442015232.ingest.de.sentry.io/4512477534945360",

  // Enables Tracing.
  // Set to 1.0 to capture 100% of spans for tracing.
  // We recommend reducing this value in production.
  tracesSampleRate: 1.0,
}));
