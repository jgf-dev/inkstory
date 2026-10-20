import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  ensureCodexEntryQuota,
  ensureNovelQuota,
  getEntitlements,
  getPlanTierForUser,
  resolveContextTokenBudget,
} from "../src/lib/billing/entitlements";
import { CodexError } from "../src/lib/codex/errors";
import { db } from "../src/lib/prisma";

describe("billing entitlements & quota guards", { timeout: 20_000 }, () => {
  const runId = crypto.randomUUID();
  const freeUserId = `test-ent-free-${runId}`;
  const proUserId = `test-ent-pro-${runId}`;
  const novelId = `test-ent-novel-${runId}`;

  beforeAll(async () => {
    const now = Temporal.Now.plainDateTimeISO();

    await db.orm.public.User.upsert({
      create: { id: freeUserId, email: `ent-free-${runId}@inkstory.local`, updatedAt: now },
      update: { updatedAt: now },
    });
    await db.orm.public.User.upsert({
      create: {
        id: proUserId,
        email: `ent-pro-${runId}@inkstory.local`,
        planTier: "PRO",
        updatedAt: now,
      },
      update: { updatedAt: now },
    });
    await db.orm.public.Novel.upsert({
      create: { id: novelId, ownerId: freeUserId, title: "Ent Novel", position: 0, updatedAt: now },
      update: { updatedAt: now },
    });
  });

  afterAll(async () => {
    for (const id of [freeUserId, proUserId]) {
      try {
        await db.orm.public.User.where({ id }).delete();
      } catch {
        // ignore
      }
    }
  });

  it("resolves tier and entitlements; unknown users are Free", async () => {
    expect(await getPlanTierForUser(freeUserId)).toBe("FREE");
    expect(await getPlanTierForUser(proUserId)).toBe("PRO");
    expect(await getPlanTierForUser("missing-user")).toBe("FREE");

    expect(await getEntitlements(proUserId)).toMatchObject({
      maxNovels: Number.POSITIVE_INFINITY,
      maxCodexEntries: Number.POSITIVE_INFINITY,
      maxContextTokens: 6000,
    });
  });

  it("enforces the Free novel cap of 1", async () => {
    await expect(ensureNovelQuota(freeUserId)).rejects.toMatchObject({
      code: "QUOTA_EXCEEDED",
      status: 402,
    });
    await expect(ensureNovelQuota(proUserId)).resolves.toBeUndefined();
  });

  it("enforces the Free codex entry cap of 30 with a 402 upgrade trigger", async () => {
    const now = Temporal.Now.plainDateTimeISO();
    for (let i = 0; i < 30; i += 1) {
      await db.orm.public.CodexEntry.create({
        id: `test-ent-entry-${runId}-${i}`,
        ownerId: freeUserId,
        novelId,
        name: `Entry ${i}`,
        type: "CHARACTER",
        description: "",
        trackingMode: "DETECTED",
        seriesScoped: false,
        position: i,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    }

    let caught: unknown;
    try {
      await ensureCodexEntryQuota(freeUserId);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CodexError);
    expect((caught as CodexError).code).toBe("QUOTA_EXCEEDED");
    expect((caught as CodexError).status).toBe(402);
    expect((caught as CodexError).message).toMatch(/Upgrade for unlimited entries/);

    // Paid tiers are unlimited.
    await expect(ensureCodexEntryQuota(proUserId)).resolves.toBeUndefined();
  });

  it("resolves the context token budget from the tier ceiling", () => {
    // Free: default 4,000; paid: ceiling 6,000; callers cannot exceed the ceiling.
    expect(resolveContextTokenBudget(undefined, 4000)).toBe(4000);
    expect(resolveContextTokenBudget(undefined, 6000)).toBe(6000);
    expect(resolveContextTokenBudget(2500, 6000)).toBe(2500);
    expect(resolveContextTokenBudget(9000, 6000)).toBe(6000);
  });
});
