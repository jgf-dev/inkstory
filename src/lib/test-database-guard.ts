/**
 * Refuse to run tests against a hosted or otherwise non-local database.
 *
 * Blocked project refs (must never be a test target):
 * - wntgnjrrzfndunqaiobo (prod Supabase)
 * - oobhhexdoufnwdltoren (dev/preview Supabase)
 *
 * Allowed hosts match local loopback and the Sonar CI service mapping
 * (`localhost` in `.github/workflows/sonarqube.yml`).
 */

const BLOCKED_REF_FRAGMENTS = ["wntgnjrrzfndunqaiobo", "oobhhexdoufnwdltoren"] as const;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export const SAFE_TEST_DATABASE_ERROR = "INKSTORY_UNSAFE_TEST_DATABASE";

function hostnameOf(url: URL): string {
  // URL.hostname strips brackets from IPv6 literals (`[::1]` → `::1`).
  return url.hostname.replace(/^\[(.*)\]$/, "$1").toLowerCase();
}

export function assertSafeTestDatabaseUrl(raw: string | undefined, label = "DATABASE_URL"): void {
  if (raw == null || raw.trim() === "") {
    return;
  }

  const value = raw.trim();
  const lower = value.toLowerCase();
  for (const fragment of BLOCKED_REF_FRAGMENTS) {
    if (lower.includes(fragment)) {
      throw new Error(
        `${SAFE_TEST_DATABASE_ERROR}: ${label} contains a blocked Supabase project ref (${fragment}). ` +
          `Tests must use the disposable local Postgres in docker-compose.test.yml (or CI's localhost service), ` +
          `never prod or preview. See README.md.`,
      );
    }
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${SAFE_TEST_DATABASE_ERROR}: ${label} is not a valid URL.`);
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      `${SAFE_TEST_DATABASE_ERROR}: ${label} must be a postgres:// or postgresql:// URL.`,
    );
  }

  const host = hostnameOf(url);
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `${SAFE_TEST_DATABASE_ERROR}: ${label} host must be localhost, 127.0.0.1, or ::1 ` +
        `(got "${host}"). Tests must never target a remote database.`,
    );
  }
}

export function assertSafeTestDatabaseEnv(
  env: Record<string, string | undefined> = process.env,
): void {
  assertSafeTestDatabaseUrl(env.DATABASE_URL, "DATABASE_URL");
  assertSafeTestDatabaseUrl(env.DIRECT_URL, "DIRECT_URL");
}
