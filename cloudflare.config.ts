import { createWorkersResponseStoreServiceBindingConfig } from "@vinext/cloudflare/cache/config";
import { bindings, defineConfig, defineWorker } from "cf/config";

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
  worker: defineWorker({
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
      TURNSTILE_HOSTNAMES: bindings.text("syncodex.xyz,inkstory.jgeof.workers.dev"),
      AI_GATEWAY_BASE_URL: bindings.text("https://ai-gateway.vercel.sh/v1"),
      AI_MODEL: bindings.text("anthropic/claude-sonnet-4.6"),
      NEXT_PUBLIC_SUPABASE_JWKS_URL: bindings.text(
        "https://wntgnjrrzfndunqaiobo.supabase.co/auth/v1/.well-known/jwks.json",
      ),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: bindings.text(
        "sb_publishable_DDo1gXilrcXEYIE4aA_2EQ_aMIIUc1X",
      ),
      NEXT_PUBLIC_SUPABASE_URL: bindings.text("https://wntgnjrrzfndunqaiobo.supabase.co"),
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: bindings.text("0x4AAAAAAGGPGpjMBFjy08CL"),
      TURNSTILE_SITE_KEY: bindings.text("0x4AAAAAAGGPGpjMBFjy08CL"),
    },
    observability: {
      issues: {
        enabled: true,
      },
      logs: {
        destinations: ["newr"],
        enabled: false,
      },
      traces: {
        enabled: true,
      },
    },
  }),
});
