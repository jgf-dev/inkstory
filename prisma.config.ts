import { config } from "dotenv";
import { definePrismaConfig } from "@prisma/cli-engine";
import { defineConfig as ormConfig } from "@prisma/orm-postgres/config";

// Load .env.local first (higher priority), then .env as fallback
config({ path: ".env.local", override: false });
config({ path: ".env", override: false });

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
