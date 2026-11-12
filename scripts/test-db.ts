/**
 * Start the disposable test Postgres, apply the Prisma contract the same way
 * CI does (`prisma db update`), then run the Vitest suite.
 *
 * Never inherits DATABASE_URL / DIRECT_URL from the shell or from `.env` /
 * `.env.local`. Only `.env.test` is loaded.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";
import { assertSafeTestDatabaseEnv } from "../src/lib/test-database-guard";

function fail(message: string, status = 1): never {
  console.error(message);
  process.exit(status);
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.error) {
    fail(`${command} failed to start: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function isTestDatabaseReachable(connectionString: string): Promise<boolean> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await client.end().catch(() => {
      /* already closed or never opened */
    });
  }
}

const composeHelp =
  "If pulling ghcr.io/jgf-dev/postgres:17 fails, retry with:\n" +
  "  INKSTORY_TEST_POSTGRES_IMAGE=postgres:17 bun run test:db";

async function ensureTestDatabase(databaseUrl: string): Promise<void> {
  if (await isTestDatabaseReachable(databaseUrl)) {
    console.log("Using already-running local test database from .env.test");
    return;
  }

  const docker = spawnSync("docker", ["version"], { stdio: "pipe", env: process.env });
  if (docker.status !== 0) {
    fail(
      "No reachable local test database, and docker is not available.\n" +
        "Install Docker, then run `bun run test:db` again, or start Postgres 17 yourself " +
        "with database inkstory_test and user/password postgres/postgres on localhost:5432.\n" +
        composeHelp,
    );
  }

  const compose = spawnSync(
    "docker",
    ["compose", "-f", "docker-compose.test.yml", "up", "-d", "--wait"],
    { stdio: "inherit", env: process.env },
  );
  if (compose.status !== 0) {
    fail(
      "Failed to start docker-compose.test.yml. If port 5432 is already in use, stop that " +
        "process or point .env.test at a reachable local test database.\n" +
        composeHelp,
    );
  }
}

async function main(): Promise<void> {
  if (!existsSync(".env.test")) {
    fail(
      "Missing .env.test. This file is committed and must point at the local test database only.",
    );
  }

  delete process.env.DATABASE_URL;
  delete process.env.DIRECT_URL;

  config({ path: ".env.test", override: true });
  process.env.INKSTORY_TEST_ENV = "1";
  assertSafeTestDatabaseEnv(process.env);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail(".env.test must set DATABASE_URL.");
  }

  process.env.INKSTORY_TEST_POSTGRES_IMAGE =
    process.env.INKSTORY_TEST_POSTGRES_IMAGE ?? "ghcr.io/jgf-dev/postgres:17";

  await ensureTestDatabase(databaseUrl);
  run("./node_modules/.bin/prisma", ["db", "update", "-y", "--db", databaseUrl]);
  run("bun", ["run", "test", ...process.argv.slice(2)]);
}

await main();
