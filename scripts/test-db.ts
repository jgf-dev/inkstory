/**
 * Start the disposable test Postgres, apply the Prisma contract the same way
 * CI does (`prisma db update`), then run the Vitest suite.
 *
 * Never inherits DATABASE_URL / DIRECT_URL from the shell or from `.env` /
 * `.env.local`. Only `.env.test` is loaded. The host port can be overridden
 * with INKSTORY_TEST_POSTGRES_PORT or `--port` after that load, so the
 * committed 5432 URLs do not clobber a custom port.
 */
import { prepareTestDatabase, run } from "./prepare-test-database";

async function main(): Promise<void> {
  const { rest } = await prepareTestDatabase("bun run test");
  run("./node_modules/.bin/vp", ["test", ...rest]);
}

await main();
