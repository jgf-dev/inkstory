import { describe, expect, it } from "vite-plus/test";
import cloudflareConfig, {
  PRODUCTION_LOG_DESTINATIONS,
  PRODUCTION_TRACE_DESTINATIONS,
  resolveObservabilityConfig,
} from "../cloudflare.config";

describe("cloudflare.config observability", () => {
  it("exports logs and traces to production destinations with redaction, 0.2 trace sampling, and persist disabled", () => {
    for (const ctx of [
      { isPreview: false, mode: "production" },
      { isPreview: false, mode: undefined },
    ]) {
      const obs = resolveObservabilityConfig(ctx);

      expect(obs).toEqual({
        enabled: true,
        redactQueryString: true,
        logs: {
          destinations: [...PRODUCTION_LOG_DESTINATIONS],
          enabled: true,
          persist: false,
          invocationLogs: true,
        },
        traces: {
          enabled: true,
          headSamplingRate: 0.2,
          persist: false,
          destinations: [...PRODUCTION_TRACE_DESTINATIONS],
        },
        issues: { enabled: true },
      });
    }
  });

  it("isolates preview and non-production modes from external destinations while retaining Cloudflare persistence", () => {
    for (const ctx of [
      { isPreview: true, mode: "production" },
      { isPreview: false, mode: "preview" },
      { isPreview: false, mode: "development" },
    ]) {
      const obs = resolveObservabilityConfig(ctx);

      expect(obs).toEqual({
        enabled: true,
        redactQueryString: true,
        logs: {
          destinations: [],
          enabled: true,
          persist: true,
          invocationLogs: true,
        },
        traces: {
          enabled: true,
          headSamplingRate: 0.2,
          persist: true,
          destinations: [],
        },
        issues: { enabled: true },
      });
    }
  });

  it("evaluates the worker factory cleanly for production and preview contexts", () => {
    const workerFactory = cloudflareConfig.worker;
    expect(typeof workerFactory).toBe("function");
    if (typeof workerFactory !== "function") {
      throw new Error("Expected worker config to be a context factory");
    }

    const prodWorker = workerFactory({ isPreview: false, mode: "production" });
    const previewWorker = workerFactory({ isPreview: true, mode: "production" });

    expect(prodWorker).toMatchObject({
      name: "inkstory",
      observability: {
        redactQueryString: true,
        logs: { destinations: ["newr", "sentry"], persist: false, invocationLogs: true },
        traces: { destinations: ["sentry-traces"], headSamplingRate: 0.2, persist: false },
      },
    });
    expect(previewWorker).toMatchObject({
      name: "inkstory",
      observability: {
        redactQueryString: true,
        logs: { destinations: [], persist: true, invocationLogs: true },
        traces: { destinations: [], headSamplingRate: 0.2, persist: true },
      },
    });
  });
});
