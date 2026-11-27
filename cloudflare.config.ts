import { createWorkersResponseStoreServiceBindingConfig } from "@vinext/cloudflare/cache/config";
import { bindings, defineConfig, defineWorker, type ConfigContext } from "cf/config";

/**
 * Account-level Cloudflare Observability OTLP destination slugs used in production:
 * - `newr`: New Relic logs destination
 * - `sentry`: Sentry logs destination
 * - `sentry-traces`: Sentry traces destination
 */
export const PRODUCTION_LOG_DESTINATIONS = ["newr", "sentry"] as const;
export const PRODUCTION_TRACE_DESTINATIONS = ["sentry-traces"] as const;

export function resolveObservabilityConfig({ isPreview, mode }: ConfigContext) {
  const isProduction = !isPreview && (mode === undefined || mode === "production");

  return {
    enabled: true,
    redactQueryString: true,
    logs: {
      // Production exports exclusively to external destinations (`persist: false`,
      // since omitting `persist` defaults to `true` in Cloudflare Workers).
      // Preview and non-production modes stay in Cloudflare Logs without polluting prod sinks.
      destinations: isProduction ? [...PRODUCTION_LOG_DESTINATIONS] : [],
      enabled: true,
      persist: !isProduction,
      invocationLogs: true,
    },
    traces: {
      enabled: true,
      headSamplingRate: 0.2,
      persist: !isProduction,
      destinations: isProduction ? [...PRODUCTION_TRACE_DESTINATIONS] : [],
    },
    issues: { enabled: true },
  };
}

const responseStore = await createWorkersResponseStoreServiceBindingConfig({
  worker: {
    name: "inkstory-response-store",
    compatibilityDate: "2026-11-08",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
  },
  bucket: "inkstory-response-store-cache-bodies",
});

export const responseStoreServiceBinding = responseStore.serviceBindingWorker;

export default defineConfig({
  worker: defineWorker((ctx) => ({
    ...responseStore.applicationWorker,
    name: "inkstory",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-08",
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ...responseStore.applicationWorker.env,
      ASSETS: bindings.assets(),
      IMAGES: bindings.images(),
      AI_GATEWAY_BASE_URL: bindings.text("https://ai-gateway.vercel.sh/v1"),
      AI_MODEL: bindings.text("anthropic/claude-sonnet-4.6"),
      NEXT_PUBLIC_SUPABASE_JWKS_URL: bindings.text(
        "https://wntgnjrrzfndunqaiobo.supabase.co/auth/v1/.well-known/jwks.json",
      ),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: bindings.text(
        "sb_publishable_DDo1gXilrcXEYIE4aA_2EQ_aMIIUc1X",
      ),
      NEXT_PUBLIC_SUPABASE_URL: bindings.text("https://wntgnjrrzfndunqaiobo.supabase.co"),
      TURNSTILE_HOSTNAMES: bindings.text(
        "syncodex.xyz,inkstory.jgeof.workers.dev,pre.syncodex.xyz",
      ),
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: bindings.text("0x4AAAAAAGGPGpjMBFjy08CL"),
      TURNSTILE_SITE_KEY: bindings.text("0x4AAAAAAGGPGpjMBFjy08CL"),
      NEXT_PUBLIC_BETTERSTACK_TOKEN: bindings.text("TKXW6BinG9JpyjaRroQaZvnM"),
    },
    observability: resolveObservabilityConfig(ctx),
  })),
});
