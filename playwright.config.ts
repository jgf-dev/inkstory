import { defineConfig, devices } from "@playwright/test";
import { assertSafeTestDatabaseEnv } from "./src/lib/test-database-guard";

if (process.env.INKSTORY_E2E_DATABASE_READY !== "1") {
  throw new Error(
    "Playwright must be started with `bun run test:e2e` so the isolated local test database is prepared.",
  );
}
assertSafeTestDatabaseEnv(process.env);

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set in .env.test before running Playwright E2E.");
}
const directUrl = process.env.DIRECT_URL?.trim() || databaseUrl;

const port = 3100;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        },
      },
    },
  ],
  webServer: {
    command: `./node_modules/.bin/vp dev --port ${port} --strictPort`,
    url: `${baseURL}/api/health`,
    // Never attach authenticated tests to a developer's normal server or database.
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      DATABASE_URL: databaseUrl,
      DIRECT_URL: directUrl,
      INKSTORY_TEST_ENV: "1",
      INKSTORY_E2E: "1",
      NEXT_PUBLIC_E2E: "true",
      NEXT_PUBLIC_APP_URL: baseURL,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "e2e-anon-key",
      // Explicitly blank external/secret keys so vinext's dev dotenv loader
      // never inherits local developer credentials or overrides from .env.local.
      AI_GATEWAY_API_KEY: "",
      AI_GATEWAY_BASE_URL: "",
      AI_MODEL: "",
      BYOK_ENCRYPTION_KEY: "",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      STRIPE_PRICE_PRO_MONTHLY: "",
      STRIPE_PRICE_PRO_ANNUAL: "",
      STRIPE_PRICE_STUDIO_MONTHLY: "",
      TURNSTILE_SECRET: "",
      TURNSTILE_HOSTNAMES: "",
      NEXT_PUBLIC_TURNSTILE_KEY: "",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
      NEXT_PUBLIC_BETTERSTACK_TOKEN: "",
      NEXT_PUBLIC_BETTERSTACK_ENV: "",
      NEXT_PUBLIC_INKSTORY_OPERATING_MODES: "",
      PORT: String(port),
      // The isolated E2E server must not claim or depend on the normal dev lock.
      VINEXT_NO_DEV_LOCK: "1",
    },
  },
});
