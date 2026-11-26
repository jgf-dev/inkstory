/**
 * Shared setup for the Vitest database suite and the Playwright E2E runner:
 * load only `.env.test`, enforce the loopback safety guard, start the disposable
 * test Postgres if needed, and apply the Prisma contract.
 */
import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { config } from "dotenv";
import pg from "pg";
import { assertSafeTestDatabaseEnv } from "../src/lib/test-database-guard";
import {
  TEST_POSTGRES_PORT_ENV,
  applyTestPostgresPortToEnv,
  resolveTestPostgresPort,
  takePortFlag,
} from "../src/lib/test-database-port";

/** Absolute docker binaries only — never search PATH (Sonar S4036). */
const DOCKER_BINARIES = [
  "/usr/bin/docker",
  "/usr/local/bin/docker",
  "/opt/homebrew/bin/docker",
  "/snap/bin/docker",
  "/run/current-system/sw/bin/docker",
  "/Applications/Docker.app/Contents/Resources/bin/docker",
];

export function fail(message: string, status = 1): never {
  console.error(message);
  process.exit(status);
}

export function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.error) {
    fail(`${command} failed to start: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function isExecutable(bin: string): boolean {
  try {
    accessSync(bin, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveDockerBin(): string | undefined {
  return DOCKER_BINARIES.find((bin) => isExecutable(bin));
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

async function ensureTestDatabase(
  databaseUrl: string,
  port: number,
  composeHelp: string,
): Promise<void> {
  if (await isTestDatabaseReachable(databaseUrl)) {
    console.log("Using already-running local test database from .env.test");
    return;
  }

  const noDockerMessage =
    "No reachable local test database, and docker is not available.\n" +
    "Install Docker (or start the Docker daemon), then retry, or start Postgres 17 yourself " +
    "with database inkstory_test and user/password postgres/postgres on " +
    `localhost:${port}.\n` +
    composeHelp;

  const docker = resolveDockerBin();
  if (!docker) {
    fail(noDockerMessage);
  }

  const version = spawnSync(docker, ["version"], {
    stdio: "pipe",
    encoding: "utf8",
    env: process.env,
  });
  if (version.status !== 0) {
    const details = version.stderr?.trim();
    fail(details ? `${noDockerMessage}\n\nDocker reported:\n${details}` : noDockerMessage);
  }

  const compose = spawnSync(
    docker,
    ["compose", "-f", "docker-compose.test.yml", "up", "-d", "--wait"],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  if (compose.status !== 0) {
    fail(
      `Failed to start docker-compose.test.yml. If port ${port} is already in use, stop that ` +
        `process or set ${TEST_POSTGRES_PORT_ENV} (or --port) to a free port, ` +
        "or point .env.test at a reachable local test database.\n" +
        composeHelp,
    );
  }
}

/**
 * Load `.env.test`, start or reuse the local test database, and run
 * `prisma db update`. Returns leftover CLI args after `--port`.
 */
export async function prepareTestDatabase(retryCommand: string): Promise<{
  databaseUrl: string;
  rest: string[];
}> {
  const composeHelp =
    "If pulling ghcr.io/jgf-dev/postgres:17 fails, retry with:\n" +
    `  INKSTORY_TEST_POSTGRES_IMAGE=postgres:17 ${retryCommand}`;

  if (!existsSync(".env.test")) {
    fail(
      "Missing .env.test. This file is committed and must point at the local test database only.",
    );
  }

  let portFlag: string | undefined;
  let rest: string[];
  try {
    ({ flag: portFlag, rest } = takePortFlag(process.argv.slice(2)));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  delete process.env.DATABASE_URL;
  delete process.env.DIRECT_URL;
  delete process.env.INKSTORY_NO_DB;

  config({ path: ".env.test", override: true });
  process.env.INKSTORY_TEST_ENV = "1";

  let port: number;
  try {
    port = resolveTestPostgresPort(portFlag, process.env[TEST_POSTGRES_PORT_ENV]);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  applyTestPostgresPortToEnv(process.env, port);
  assertSafeTestDatabaseEnv(process.env);

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail(".env.test must set DATABASE_URL.");
  }

  process.env.INKSTORY_TEST_POSTGRES_IMAGE =
    process.env.INKSTORY_TEST_POSTGRES_IMAGE ?? "ghcr.io/jgf-dev/postgres:17";

  await ensureTestDatabase(databaseUrl, port, composeHelp);
  run("./node_modules/.bin/prisma", ["db", "update", "-y", "--db", databaseUrl]);

  return { databaseUrl, rest };
}
