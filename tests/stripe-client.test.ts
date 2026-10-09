import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const StripeCtor = vi.hoisted(() =>
  vi.fn(function (this: any, key: string) {
    this.key = key;
  }),
);
vi.mock("stripe", () => ({ default: StripeCtor }));

const ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "NEXT_PUBLIC_APP_URL"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.resetModules();
  StripeCtor.mockClear();
});

async function load() {
  return import("../src/lib/stripe");
}

describe("stripe client factory", () => {
  it("reports configuration from the environment", async () => {
    const m = await load();
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(m.isStripeConfigured()).toBe(false);
    expect(m.isWebhookConfigured()).toBe(false);
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    expect(m.isStripeConfigured()).toBe(true);
    expect(m.isWebhookConfigured()).toBe(false);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    expect(m.isWebhookConfigured()).toBe(true);
  });

  it("throws without a key and caches the client once configured", async () => {
    const m = await load();
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => m.getStripe()).toThrow("STRIPE_SECRET_KEY is not set");
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    const a = m.getStripe();
    const b = m.getStripe();
    expect(a).toBe(b);
    expect(StripeCtor).toHaveBeenCalledTimes(1);
    expect(StripeCtor).toHaveBeenCalledWith("sk_test_x");
  });

  it("derives the app base URL", async () => {
    const m = await load();
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(m.appBaseUrl()).toBe("http://localhost:3000");
    process.env.NEXT_PUBLIC_APP_URL = "https://inkstory.app";
    expect(m.appBaseUrl()).toBe("https://inkstory.app");
  });
});
