import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 45000,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        launchOptions: {
          executablePath: "/usr/bin/google-chrome",
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        },
      },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    env: {
      NEXT_PUBLIC_E2E: "true",
    },
  },
});
