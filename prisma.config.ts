import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma CLI runs this file in its own Node process — it does NOT go through
// Next.js env loading. Load .env.local first (higher priority), then .env as
// fallback. `override: false` keeps any env vars already set in the process.
config({ path: ".env.local", override: false });
config({ path: ".env", override: false });

// Prisma 7: datasource URL is no longer allowed in schema.prisma.
// It must be declared here. See: https://pris.ly/d/config-datasource
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // CLI operations (migrate, push) require direct connection/session pooler (DDL support).
    // Runtime PrismaClient in src/lib/prisma.ts uses DATABASE_URL (transaction pooler).
    url: (process.env.DIRECT_URL ?? process.env.DATABASE_URL) as string,
  },
  migrations: {
    seed: "tsx prisma/seed.ts",
  },
});
