import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  estimateFormattedContextTokens,
  estimateWrapperTokens,
  formatAssembledContext,
} from "../src/lib/codex/prompt-formatter";
import { assembleSceneContext, CodexError } from "../src/lib/codex/service";
import { db } from "../src/lib/prisma";

describe("assembleSceneContext (Codex context assembly service)", { timeout: 20_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();

  const seriesId = `test-asm-series-${runId}`;
  const novelId = `test-asm-novel-${runId}`;
  const novelSeries2Id = `test-asm-novel-s2-${runId}`;

  const actId = `test-asm-act-${runId}`;
  const chapterId = `test-asm-chapter-${runId}`;
  const scene1Id = `test-asm-scene-1-${runId}`;
  const scene2Id = `test-asm-scene-2-${runId}`;
  const seriesSceneId = `test-asm-scene-s2-${runId}`;

  const elaraId = `test-asm-elara-${runId}`;
  const emberfallId = `test-asm-emberfall-${runId}`;
  const vaerinId = `test-asm-vaerin-${runId}`;
  const hiddenVaultId = `test-asm-hidden-vault-${runId}`;
  const seriesLoreId = `test-asm-series-lore-${runId}`;

  const elaraProgressionId = `test-asm-progression-${runId}`;
  const relationId = `test-asm-relation-${runId}`;

  beforeAll(async () => {
    const now = Temporal.Now.plainDateTimeISO();

    await db.orm.public.User.upsert({
      create: {
        id: userId,
        email: `asm-${runId}@inkstory.local`,
        name: "Asm User",
        updatedAt: now,
      },
      update: { updatedAt: now },
    });
    await db.orm.public.User.upsert({
      create: {
        id: otherUserId,
        email: `asm-other-${runId}@inkstory.local`,
        name: "Other User",
        updatedAt: now,
      },
      update: { updatedAt: now },
    });

    await db.orm.public.Series.upsert({
      create: { id: seriesId, ownerId: userId, title: "Asm Series", position: 0, updatedAt: now },
      update: { updatedAt: now },
    });

    await db.orm.public.Novel.upsert({
      create: {
        id: novelId,
        ownerId: userId,
        seriesId: null,
        title: "Asm Standalone",
        position: 0,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });
    await db.orm.public.Novel.upsert({
      create: {
        id: novelSeries2Id,
        ownerId: userId,
        seriesId,
        title: "Asm Series Book",
        position: 0,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });

    await db.orm.public.Act.upsert({
      create: { id: actId, novelId, title: "Act 1", position: 0, updatedAt: now },
      update: { updatedAt: now },
    });
    await db.orm.public.Chapter.upsert({
      create: { id: chapterId, actId, title: "Chapter 1", position: 0, updatedAt: now },
      update: { updatedAt: now },
    });
    await db.orm.public.Scene.upsert({
      create: { id: scene1Id, chapterId, title: "Scene 1", position: 0, updatedAt: now },
      update: { updatedAt: now },
    });
    await db.orm.public.Scene.upsert({
      create: { id: scene2Id, chapterId, title: "Scene 2", position: 1, updatedAt: now },
      update: { updatedAt: now },
    });

    // Series novel hierarchy (separate novel so series scoping is observable).
    await db.orm.public.Act.upsert({
      create: {
        id: `${actId}-s2`,
        novelId: novelSeries2Id,
        title: "Act 1",
        position: 0,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });
    await db.orm.public.Chapter.upsert({
      create: {
        id: `${chapterId}-s2`,
        actId: `${actId}-s2`,
        title: "Chapter 1",
        position: 0,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });
    await db.orm.public.Scene.upsert({
      create: {
        id: seriesSceneId,
        chapterId: `${chapterId}-s2`,
        title: "Scene 1",
        position: 0,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });

    // Codex entries: always-tracked character, detected location, relation-only
    // rival, and a series-scoped lore entry.
    await db.orm.public.CodexEntry.upsert({
      create: {
        id: elaraId,
        ownerId: userId,
        novelId,
        seriesId: null,
        seriesScoped: false,
        name: "Elara",
        type: "CHARACTER",
        description: "An archmage of the Emberfall tower.",
        trackingMode: "ALWAYS",
        position: 0,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });
    await db.orm.public.CodexEntry.upsert({
      create: {
        id: emberfallId,
        ownerId: userId,
        novelId,
        seriesId: null,
        seriesScoped: false,
        name: "Emberfall",
        type: "LOCATION",
        description: "A city built into a dormant volcano.",
        trackingMode: "DETECTED",
        position: 1,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });
    await db.orm.public.CodexEntry.upsert({
      create: {
        id: vaerinId,
        ownerId: userId,
        novelId,
        seriesId: null,
        seriesScoped: false,
        name: "Vaerin",
        type: "CHARACTER",
        description: "Elara's rival, exiled for forbidden rites.",
        trackingMode: "DETECTED",
        position: 2,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });
    // NEVER-tracked entries stay out of context unless manually attached.
    await db.orm.public.CodexEntry.upsert({
      create: {
        id: hiddenVaultId,
        ownerId: userId,
        novelId,
        seriesId: null,
        seriesScoped: false,
        name: "The Hidden Vault",
        type: "LORE",
        description: "A vault sealed by the first archmage.",
        trackingMode: "NEVER",
        position: 3,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });
    await db.orm.public.CodexEntry.upsert({
      create: {
        id: seriesLoreId,
        ownerId: userId,
        novelId: null,
        seriesId,
        seriesScoped: true,
        name: "The Great Fracture",
        type: "LORE",
        description: "The cataclysm that shattered the old empire.",
        trackingMode: "DETECTED",
        position: 0,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });

    await db.orm.public.CodexAlias.upsert({
      create: { id: `test-asm-alias-${runId}`, entryId: elaraId, name: "El", updatedAt: now },
      update: { updatedAt: now },
    });

    await db.orm.public.CodexRelation.upsert({
      create: {
        id: relationId,
        sourceEntryId: elaraId,
        targetEntryId: vaerinId,
        relationType: "RIVAL_OF",
        reverseType: "RIVAL_OF",
        updatedAt: now,
      },
      update: { updatedAt: now },
    });

    // Vaerin is NEVER-tracked; the relation edge must still be traversable
    // from the always-tracked seed Elara.
    await db.orm.public.CodexProgression.upsert({
      create: {
        id: elaraProgressionId,
        entryId: elaraId,
        sceneId: scene2Id,
        mode: "REPLACEMENT",
        description: "Elara has ascended on wings of ash, her tower body left behind.",
        position: 0,
        updatedAt: now,
      },
      update: { updatedAt: now },
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

  it("assembles mentions, relations, and progressions for a scene", async () => {
    const result = await assembleSceneContext(userId, {
      sceneId: scene2Id,
      recentProse: "El walked the rim while Emberfall smoldered below.",
    });

    const byId = new Map(result.context.entries.map((entry) => [entry.id, entry]));

    // Elara resolves her scene-2 REPLACEMENT progression.
    expect(byId.get(elaraId)?.description).toBe(
      "Elara has ascended on wings of ash, her tower body left behind.",
    );
    expect(byId.get(elaraId)?.appliedProgressionIds).toEqual([elaraProgressionId]);
    // Emberfall is detected from prose.
    expect(byId.get(emberfallId)?.source).toBe("mention");
    // Vaerin (DETECTED) arrives via relation expansion from the always-tracked
    // seed Elara.
    expect(byId.get(vaerinId)?.source).toBe("relation");
    expect(byId.get(vaerinId)?.relationDepth).toBe(1);
    // NEVER-tracked entries are excluded even when related to a seed.
    expect(byId.has(hiddenVaultId)).toBe(false);
    // The standalone novel has no series, so the series-scoped lore is out
    // of scope for its scenes.
    expect(byId.has(seriesLoreId)).toBe(false);

    // The prompt is the formatted XML block for the budgeted context.
    expect(result.prompt).toContain("<codex_context>");
    expect(result.prompt).toContain('<entity id="' + elaraId + '"');
    expect(result.prompt).toBe(formatAssembledContext(result.context));
    expect(result.context.meta.maxTokens).toBe(4000);
  });

  it("includes series-scoped lore for series novels and honors includeSeriesCodex", async () => {
    const withSeries = await assembleSceneContext(userId, {
      sceneId: seriesSceneId,
      recentProse: "The Great Fracture still echoes in every ruin.",
    });
    expect(withSeries.context.entries.some((entry) => entry.id === seriesLoreId)).toBe(true);

    const withoutSeries = await assembleSceneContext(userId, {
      sceneId: seriesSceneId,
      recentProse: "The Great Fracture still echoes in every ruin.",
      options: { includeSeriesCodex: false },
    });
    expect(withoutSeries.context.entries.some((entry) => entry.id === seriesLoreId)).toBe(false);
  });

  it("ignores unknown manual attachment ids instead of failing", async () => {
    const result = await assembleSceneContext(userId, {
      sceneId: scene1Id,
      manualAttachmentIds: ["does-not-exist"],
    });
    expect(result.context.entries.every((entry) => entry.id !== "does-not-exist")).toBe(true);
  });

  it("enforces a hard token budget on the formatted prompt", async () => {
    const result = await assembleSceneContext(userId, {
      sceneId: scene2Id,
      recentProse: "El walked the rim while Emberfall smoldered below.",
      options: { maxTokens: estimateWrapperTokens() + 40 },
    });

    expect(estimateFormattedContextTokens(result.context)).toBeLessThanOrEqual(
      estimateWrapperTokens() + 40,
    );
    expect(
      result.context.meta.droppedEntryIds.length + result.context.meta.truncatedEntryIds.length,
    ).toBeGreaterThan(0);
  });

  it("throws NOT_FOUND for unknown or reading-order-missing scenes", async () => {
    await expect(assembleSceneContext(userId, { sceneId: "nope" })).rejects.toThrow(CodexError);

    let caught: unknown;
    try {
      await assembleSceneContext(userId, { sceneId: "nope" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CodexError);
    expect((caught as CodexError).code).toBe("NOT_FOUND");
    expect((caught as CodexError).status).toBe(404);
  });

  it("throws FORBIDDEN when the caller does not own the scene", async () => {
    let caught: unknown;
    try {
      await assembleSceneContext(otherUserId, { sceneId: scene1Id });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CodexError);
    expect((caught as CodexError).code).toBe("FORBIDDEN");
    expect((caught as CodexError).status).toBe(403);
  });
});
