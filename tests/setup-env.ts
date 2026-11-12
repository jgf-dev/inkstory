/**
 * Loaded first by Vitest (see vite.config.ts `test.setupFiles`).
 * Loads `.env.test` only — never `.env.local` or `.env` — and refuses to run
 * if DATABASE_URL or DIRECT_URL points at a blocked or non-local host.
 * Already-set process env wins so CI's job env is unchanged.
 */
import { config } from "dotenv";
import { assertSafeTestDatabaseEnv } from "../src/lib/test-database-guard";

config({ path: ".env.test", override: false });
assertSafeTestDatabaseEnv(process.env);
