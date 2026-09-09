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

function getValidDbUrl(): string | undefined {
  const raw = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") {
      return raw;
    }
  } catch {
    // If unparseable (e.g. masked "[SENSITIVE]" in local Vercel builds), return undefined for lazy connection
    return undefined;
  }
  return undefined;
}

function createDbClient(): DbClient {
  return postgres<Contract>({
    contractJson,
    url: getValidDbUrl(),
  });
}

export const db = globalForPrisma.db ?? createDbClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.db = db;
}

// Backward-compatible alias for call sites transitioning from Prisma 7
export const prisma = db;
