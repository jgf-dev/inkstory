import { describe, expect, it, vi } from "vite-plus/test";
import { isTestRuntime, loadAppDatabaseEnv } from "../src/lib/database-env";

describe("isTestRuntime", () => {
  it("is true when Vitest or the test:db flag is set", () => {
    expect(isTestRuntime({ VITEST: "true" })).toBe(true);
    expect(isTestRuntime({ VITEST: "1" })).toBe(true);
    expect(isTestRuntime({ INKSTORY_TEST_ENV: "1" })).toBe(true);
  });

  it("is false for dev and production environments", () => {
    expect(isTestRuntime({})).toBe(false);
    expect(isTestRuntime({ NODE_ENV: "development" })).toBe(false);
    expect(isTestRuntime({ NODE_ENV: "production" })).toBe(false);
    expect(isTestRuntime({ VITEST: "false" })).toBe(false);
  });
});

describe("loadAppDatabaseEnv", () => {
  it("does not load .env.local or .env in the test runtime", () => {
    const loadDotenv = vi.fn();
    loadAppDatabaseEnv({ VITEST: "true" }, loadDotenv);
    loadAppDatabaseEnv({ INKSTORY_TEST_ENV: "1" }, loadDotenv);
    expect(loadDotenv).not.toHaveBeenCalled();
  });

  it("loads .env.local then .env without overriding existing process env in dev", () => {
    const loadDotenv = vi.fn();
    loadAppDatabaseEnv({ NODE_ENV: "development" }, loadDotenv);
    expect(loadDotenv).toHaveBeenCalledTimes(2);
    expect(loadDotenv).toHaveBeenNthCalledWith(1, { path: ".env.local", override: false });
    expect(loadDotenv).toHaveBeenNthCalledWith(2, { path: ".env", override: false });
  });
});
