/**
 * Prepare an isolated local database, seed deterministic fixtures, then run the
 * Playwright suite against a dedicated dev server started by Playwright.
 *
 * Never inherits DATABASE_URL / DIRECT_URL from the shell or from `.env` /
 * `.env.local`. Only `.env.test` is loaded, and the same loopback-only safety
 * guard used by the Vitest database suite is enforced before any app code runs.
 */
import { prepareTestDatabase, run } from "./prepare-test-database";

async function main(): Promise<void> {
  const { rest } = await prepareTestDatabase("bun run test:e2e");
  process.env.INKSTORY_E2E_DATABASE_READY = "1";
  process.env.NEXT_PUBLIC_E2E = "true";
  // Seed SYSTEM_DEFAULT prompt templates and baseline fixtures in the fresh DB;
  // authenticated specs still create fresh per-test users to avoid state collisions.
  run("./node_modules/.bin/vpx", ["prisma/seed.ts"]);
  run("./node_modules/.bin/playwright", ["test", ...rest]);
}

await main();
