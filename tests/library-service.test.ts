import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { db } from "../src/lib/prisma";
import { CodexError } from "../src/lib/codex/errors";
import { createNovel, createSeries } from "../src/lib/library/service";

describe("Library Service (novel & series creation)", { timeout: 30_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();

  const seriesId = `lib-series-${runId}`;
  const freeNovelId = `lib-free-novel-${runId}`;

  async function now() {
    return Temporal.Now.plainDateTimeISO();
  }

  beforeAll(async () => {
    const ts = await now();

    await db.orm.public.User.upsert({
      create: { id: userId, email: `lib-owner-${runId}@inkstory.local`, updatedAt: ts },
      update: { updatedAt: ts },
    });
    await db.orm.public.User.upsert({
      create: { id: otherUserId, email: `lib-other-${runId}@inkstory.local`, updatedAt: ts },
      update: { updatedAt: ts },
    });
    await db.orm.public.Series.upsert({
      create: {
        id: seriesId,
        ownerId: otherUserId,
        title: "Foreign Series",
        position: 0,
        updatedAt: ts,
      },
      update: { updatedAt: ts },
    });
    await db.orm.public.Novel.upsert({
      create: {
        id: freeNovelId,
        ownerId: userId,
        title: "Free Tier Novel",
        position: 0,
        updatedAt: ts,
      },
      update: { updatedAt: ts },
    });
  });

  afterAll(async () => {
    for (const id of [userId, otherUserId]) {
      try {
        await db.orm.public.User.where({ id }).delete();
      } catch {
        // ignore
      }
    }
  });

  describe("createSeries", () => {
    it("creates a series with trimmed title and optional description", async () => {
      const series = await createSeries(userId, {
        title: "  The Ashfall Cycle  ",
        description: "  Three books of falling ash. ",
      });

      expect(series.title).toBe("The Ashfall Cycle");
      expect(series.description).toBe("Three books of falling ash.");
      expect(series.ownerId).toBe(userId);
      expect(series.deletedAt).toBeNull();
    });

    it("creates a series without a description", async () => {
      const series = await createSeries(userId, { title: "Minimal Series" });
      expect(series.title).toBe("Minimal Series");
      expect(series.description).toBeNull();
    });

    it("rejects empty and oversized titles", async () => {
      await expect(createSeries(userId, { title: "   " })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        status: 422,
      });
      await expect(createSeries(userId, { title: "" })).rejects.toBeInstanceOf(CodexError);
      await expect(createSeries(userId, { title: "x".repeat(201) })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        status: 422,
      });
    });
  });

  describe("createNovel", () => {
    it("rejects empty titles without consuming quota", async () => {
      await expect(createNovel(userId, { title: "  " })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        status: 422,
      });
    });

    it("attaches a novel to an owned series", async () => {
      // The user is over the Free novel quota, so switch to PRO first.
      await db.orm.public.User.where({ id: userId }).update({ planTier: "PRO" });

      const ownedSeries = await createSeries(userId, { title: "Owned Series" });
      const novel = await createNovel(userId, {
        title: "Book Two",
        subtitle: "The Ash Rises",
        seriesId: ownedSeries.id,
      });

      expect(novel.title).toBe("Book Two");
      expect(novel.subtitle).toBe("The Ash Rises");
      expect(novel.seriesId).toBe(ownedSeries.id);
      expect(novel.ownerId).toBe(userId);
    });

    it("rejects a series owned by another user with 403", async () => {
      await expect(createNovel(userId, { title: "Hijack", seriesId })).rejects.toMatchObject({
        code: "FORBIDDEN",
        status: 403,
      });
    });

    it("rejects an unknown series with 404", async () => {
      await expect(
        createNovel(userId, { title: "Orphan", seriesId: `missing-${runId}` }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    });

    it("enforces the Free-tier single-novel quota with 402", async () => {
      await db.orm.public.User.where({ id: userId }).update({ planTier: "FREE" });

      await expect(createNovel(userId, { title: "Second Book" })).rejects.toMatchObject({
        code: "QUOTA_EXCEEDED",
        status: 402,
      });
    });

    it("allows unlimited novels on PRO", async () => {
      await db.orm.public.User.where({ id: userId }).update({ planTier: "PRO" });

      const novel = await createNovel(userId, { title: "Book Three" });
      expect(novel.ownerId).toBe(userId);
    });
  });
});
