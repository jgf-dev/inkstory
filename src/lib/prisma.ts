/**
 * Prisma 8 (Prisma Next) client singleton.
 *
 * Avoids creating a new connection per request in dev where Next.js hot-reloads
 */
import "temporal-polyfill/full/global";
import postgres from "@prisma/orm-postgres/runtime";
import type { Contract } from "../../prisma/contract.d";
import contractJson from "../../prisma/contract.json" with { type: "json" };

export type DbClient = ReturnType<typeof postgres<Contract>>;

const globalForPrisma = globalThis as unknown as {
  db: DbClient | undefined;
};

function createDbClient(): DbClient {
  return postgres<Contract>({
    contractJson,
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  });
}

export const db = globalForPrisma.db ?? createDbClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.db = db;
}

// Backward-compatible alias for call sites transitioning from Prisma 7
export const prisma = db;
