/**
 * Host-port override for the disposable test Postgres used by `bun run test:db`.
 *
 * `.env.test` is committed with port 5432. `scripts/test-db.ts` reloads that file
 * with `override: true`, so a raw `DATABASE_URL` in the shell cannot change the
 * port. Set `INKSTORY_TEST_POSTGRES_PORT` (or pass `--port`) instead; the chosen
 * port is applied to the Compose publish mapping and to `DATABASE_URL` /
 * `DIRECT_URL` after `.env.test` is loaded.
 */

export const DEFAULT_TEST_POSTGRES_PORT = 5432;
export const TEST_POSTGRES_PORT_ENV = "INKSTORY_TEST_POSTGRES_PORT";

function invalidPortMessage(label: string, raw: string): string {
  return `${label} must be an integer from 1 to 65535 (got "${raw}").`;
}

export function parseTestPostgresPort(
  raw: string | undefined,
  label = TEST_POSTGRES_PORT_ENV,
): number {
  if (raw == null || raw.trim() === "") {
    return DEFAULT_TEST_POSTGRES_PORT;
  }

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(invalidPortMessage(label, raw));
  }

  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(invalidPortMessage(label, raw));
  }

  return port;
}

export function rewriteDatabaseUrlPort(raw: string, port: number): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Cannot rewrite port on invalid database URL: "${raw}".`);
  }
  url.port = String(port);
  return url.toString();
}

export function applyTestPostgresPortToEnv(
  env: Record<string, string | undefined>,
  port: number,
): void {
  if (env.DATABASE_URL != null && env.DATABASE_URL.trim() !== "") {
    env.DATABASE_URL = rewriteDatabaseUrlPort(env.DATABASE_URL, port);
  }
  if (env.DIRECT_URL != null && env.DIRECT_URL.trim() !== "") {
    env.DIRECT_URL = rewriteDatabaseUrlPort(env.DIRECT_URL, port);
  }
  env[TEST_POSTGRES_PORT_ENV] = String(port);
}

export function takePortFlag(argv: string[]): { flag?: string; rest: string[] } {
  const rest: string[] = [];
  let flag: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") {
      const value = argv[i + 1];
      if (value == null || value.startsWith("-")) {
        throw new Error("--port must be an integer from 1 to 65535.");
      }
      flag = value;
      i += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      flag = arg.slice("--port=".length);
      continue;
    }
    rest.push(arg);
  }

  return { flag, rest };
}

export function resolveTestPostgresPort(flag?: string, envValue?: string): number {
  if (flag !== undefined) {
    if (flag.trim() === "") {
      throw new Error(invalidPortMessage("--port", flag));
    }
    return parseTestPostgresPort(flag, "--port");
  }
  return parseTestPostgresPort(envValue);
}
