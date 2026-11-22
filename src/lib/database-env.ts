/**
 * Dev/prod database env loading for Prisma.
 *
 * The test path must never fall through to `.env.local` or `.env`, which may
 * point at a real Supabase project. Vitest sets `VITEST`; the local `test:db`
 * script sets `INKSTORY_TEST_ENV=1` for `prisma db update`.
 */
import { config as dotenvConfig } from "dotenv";

export type DotenvConfig = typeof dotenvConfig;
export type EnvLike = Record<string, string | undefined>;

export function isTestRuntime(env: EnvLike = process.env): boolean {
  return env.VITEST === "true" || env.VITEST === "1" || env.INKSTORY_TEST_ENV === "1";
}

export function loadAppDatabaseEnv(
  env: EnvLike = process.env,
  loadDotenv: DotenvConfig = dotenvConfig,
): void {
  if (isTestRuntime(env)) {
    return;
  }
  loadDotenv({ path: ".env.local", override: false });
  loadDotenv({ path: ".env", override: false });
}
