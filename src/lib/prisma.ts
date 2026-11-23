/**
 * Prisma 8 (Prisma Next) client.
 *
 * On Cloudflare Workers, I/O objects (sockets) opened while handling one request
 * cannot be used by a later request, so a pg pool kept for the life of the
 * isolate makes warm-isolate requests hang. There, each request gets its own
 * client (via vinext's `cacheForRequest`) that is closed once the response has
 * finished. Everywhere else (Node dev, tests) a module singleton is kept, which
 * also avoids creating a new connection per hot reload.
 */
import { loadAppDatabaseEnv } from "./database-env";
loadAppDatabaseEnv();

import "temporal-polyfill/full/global";
import postgres from "@prisma/orm-postgres/runtime";
import { after } from "vinext/shims/server";
import { cacheForRequest } from "vinext/cache";
import { contractFromJson } from "@prisma/orm-postgres/static";
import type { Contract } from "../../prisma/contract.d";
import contractJson from "../../prisma/contract.json" with { type: "json" };

export const contract = contractFromJson<Contract>(contractJson);
export type DbClient = ReturnType<typeof postgres<Contract>>;

const globalForPrisma = globalThis as unknown as {
  db: DbClient | undefined;
};

export function getValidDbUrl(customRaw?: string): string | undefined {
  const raw = customRaw ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL;
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
    contract,
    url: getValidDbUrl(),
  });
}

/** True when running inside the Cloudflare Workers runtime (workerd). */
export function isWorkersRuntime(): boolean {
  return globalThis.navigator?.userAgent === "Cloudflare-Workers";
}

let singletonDbClient: DbClient | undefined;

function getSingletonDbClient(): DbClient {
  if (singletonDbClient) return singletonDbClient;
  singletonDbClient = globalForPrisma.db ?? createDbClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.db = singletonDbClient;
  }
  return singletonDbClient;
}

/**
 * Creates the client for the current request and closes it once the response
 * has been sent, so idle sessions don't pile up on the database.
 */
function createRequestDbClient(): DbClient {
  const client = createDbClient();
  try {
    after(() => client.close());
  } catch (error) {
    console.warn("[prisma] could not schedule per-request db client close:", error);
  }
  return client;
}

const getRequestDbClient = cacheForRequest(createRequestDbClient);

/** Returns the db client for the current context: per request on Workers, a singleton elsewhere. */
export function getDbClient(): DbClient {
  if (isWorkersRuntime()) return getRequestDbClient();
  return getSingletonDbClient();
}

/**
 * Thin proxy over {@link getDbClient}, so call sites keep importing `db` and
 * each property access resolves against the current request's client.
 * Functions are bound to that client so `this` stays correct.
 */
export const db: DbClient = new Proxy({} as DbClient, {
  get(_target, property) {
    const client = getDbClient();
    const value: unknown = Reflect.get(client, property, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
  set(_target, property, value) {
    return Reflect.set(getDbClient(), property, value);
  },
  has(_target, property) {
    return Reflect.has(getDbClient(), property);
  },
});

// Backward-compatible alias for call sites transitioning from Prisma 7
export const prisma = db;
