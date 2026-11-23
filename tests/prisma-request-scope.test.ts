import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  closeAfterResponse,
  createRequestContext,
  runWithRequestContext,
  type UnifiedRequestContext,
} from "vinext/shims/unified-request-context";

type FakeClient = {
  id: number;
  orm: { public: Record<string, unknown> };
  close: ReturnType<typeof vi.fn>;
  transaction: (this: FakeClient, fn: () => unknown) => TransactionOutcome;
};
type TransactionOutcome = { self: FakeClient; result: unknown };
type BoundTransaction = (fn: () => unknown) => TransactionOutcome;

const { postgres } = vi.hoisted(() => {
  let nextId = 0;
  const postgres = vi.fn((): FakeClient => {
    nextId += 1;
    return {
      id: nextId,
      orm: { public: {} },
      close: vi.fn(async () => undefined),
      transaction(fn) {
        return { self: this, result: fn() };
      },
    };
  });
  return { postgres };
});

vi.mock("@prisma/orm-postgres/runtime", () => ({ default: postgres }));

const globalForPrisma = globalThis as unknown as { db: unknown };

async function loadPrismaModule() {
  vi.resetModules();
  return import("../src/lib/prisma");
}

function asFake(client: unknown): FakeClient {
  return client as FakeClient;
}

function inRequest<T>(ctx: UnifiedRequestContext, fn: () => T): T {
  return runWithRequestContext(ctx, fn) as T;
}

beforeEach(() => {
  postgres.mockClear();
  globalForPrisma.db = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  globalForPrisma.db = undefined;
});

describe("isWorkersRuntime", () => {
  it("detects the Cloudflare Workers user agent", async () => {
    const { isWorkersRuntime } = await loadPrismaModule();
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
    expect(isWorkersRuntime()).toBe(true);
  });

  it("is false for Node and when navigator is missing", async () => {
    const { isWorkersRuntime } = await loadPrismaModule();
    vi.stubGlobal("navigator", { userAgent: "Node.js/24" });
    expect(isWorkersRuntime()).toBe(false);
    vi.stubGlobal("navigator", undefined);
    expect(isWorkersRuntime()).toBe(false);
  });
});

describe("db outside Workers", () => {
  it("keeps one module singleton across calls and request scopes", async () => {
    const { db, getDbClient, prisma } = await loadPrismaModule();
    const first = getDbClient();
    const inScope = inRequest(createRequestContext(), () => getDbClient());

    expect(inScope).toBe(first);
    expect(getDbClient()).toBe(first);
    expect(postgres).toHaveBeenCalledTimes(1);
    expect(globalForPrisma.db).toBe(first);
    expect(db.orm).toBe(asFake(first).orm);
    expect(prisma).toBe(db);
  });

  it("reuses a client already stored on globalThis", async () => {
    const { getDbClient } = await loadPrismaModule();
    const existing = { orm: { public: {} } };
    globalForPrisma.db = existing;

    expect(getDbClient()).toBe(existing);
    expect(postgres).not.toHaveBeenCalled();
  });

  it("does not store the singleton on globalThis in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { getDbClient } = await loadPrismaModule();

    const client = getDbClient();
    expect(getDbClient()).toBe(client);
    expect(globalForPrisma.db).toBeUndefined();
  });
});

describe("db on Workers", () => {
  beforeEach(() => {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  });

  it("gives two request scopes different clients", async () => {
    const { getDbClient } = await loadPrismaModule();
    const a = inRequest(createRequestContext(), () => getDbClient());
    const b = inRequest(createRequestContext(), () => getDbClient());

    expect(a).not.toBe(b);
    expect(postgres).toHaveBeenCalledTimes(2);
  });

  it("reuses one client within a request scope, through the db proxy too", async () => {
    const { db, getDbClient } = await loadPrismaModule();
    const ctx = createRequestContext();

    const [direct, viaProxy, again] = inRequest(ctx, () => [getDbClient(), db.orm, getDbClient()]);

    expect(again).toBe(direct);
    expect(viaProxy).toBe(asFake(direct).orm);
    expect(postgres).toHaveBeenCalledTimes(1);
  });

  it("binds proxied functions to the request's client", async () => {
    const { db, getDbClient } = await loadPrismaModule();
    const ctx = createRequestContext();

    const { client, outcome } = inRequest(ctx, () => {
      const transaction = Reflect.get(db, "transaction") as unknown as BoundTransaction;
      return { client: getDbClient(), outcome: transaction(() => "done") };
    });

    expect(outcome).toEqual({ self: client, result: "done" });
  });

  it("forwards `in` checks and property writes to the request's client", async () => {
    const { db, getDbClient } = await loadPrismaModule();
    const ctx = createRequestContext();

    inRequest(ctx, () => {
      expect("orm" in db).toBe(true);
      expect("missing" in db).toBe(false);
      (db as unknown as Record<string, unknown>).marker = 42;
      expect(asFake(getDbClient())).toHaveProperty("marker", 42);
    });
  });

  it("closes the request's client only once the response has finished", async () => {
    const { getDbClient } = await loadPrismaModule();
    const ctx = createRequestContext();
    const client = asFake(inRequest(ctx, () => getDbClient()));

    expect(client.close).not.toHaveBeenCalled();
    await closeAfterResponse(ctx);
    await ctx.afterContext.completion;

    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it("warns and still returns a client when close cannot be scheduled", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getDbClient } = await loadPrismaModule();

    const client = asFake(getDbClient());

    expect(client.close).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "[prisma] could not schedule per-request db client close:",
      expect.any(Error),
    );
  });
});
