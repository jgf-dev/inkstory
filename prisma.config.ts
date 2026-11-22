import { definePrismaConfig } from "@prisma/cli-engine";
import { defineConfig as ormConfig } from "@prisma/orm-postgres/config";
import { loadAppDatabaseEnv } from "./src/lib/database-env";

// Load .env.local first (higher priority), then .env as fallback.
// Skipped when VITEST or INKSTORY_TEST_ENV is set so tests never
// fall through to a real Supabase URL.
loadAppDatabaseEnv();

export default definePrismaConfig({
  orm: ormConfig({
    contract: "./prisma/contract.prisma",
    db: {
      connection: (process.env.DIRECT_URL ?? process.env.DATABASE_URL) as string,
    },
  }),
  skills: {
    check: true,
  },
});
