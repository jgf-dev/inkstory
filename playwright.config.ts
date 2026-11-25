import { defineConfig, devices } from "@playwright/test";
import { assertSafeTestDatabaseEnv } from "./src/lib/test-database-guard";

if (process.env.INKSTORY_E2E_DATABASE_READY !== "1") {
  throw new Error(
    "Playwright must be started with `bun run test:e2e` so the isolated local test database is prepared.",
  );
}
assertSafeTestDatabaseEnv(process.env);

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
      DATABASE_URL: process.env.DATABASE_URL!,
      DIRECT_URL: process.env.DIRECT_URL!,
      INKSTORY_TEST_ENV: "1",
      INKSTORY_E2E: "1",
      NEXT_PUBLIC_E2E: "true",
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "e2e-anon-key",
      PORT: String(port),
      // The isolated E2E server must not claim or depend on the normal dev lock.
      VINEXT_NO_DEV_LOCK: "1",
    },
  },
});
