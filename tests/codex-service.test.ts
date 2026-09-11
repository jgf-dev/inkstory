import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  CodexError,
  createCodexAlias,
  createCodexEntry,
  createCodexProgression,
  createCodexRelation,
  createCodexTag,
  deleteCodexAlias,
  deleteCodexEntry,
  deleteCodexProgression,
  deleteCodexRelation,
  deleteCodexTag,
  getCodexEntry,
  listCodexEntriesForNovel,
  listCodexEntriesForSeries,
  scanMentionsInNovel,
  scanMentionsInScene,
  updateCodexEntry,
  updateCodexProgression,
  updateCodexRelation,
} from "../src/lib/codex/service";
import { db } from "../src/lib/prisma";

describe("Codex Service & Scoping Engine", () => {
  const userId = "11111111-1111-1111-1111-111111111111";
  const otherUserId = "22222222-2222-2222-2222-222222222222";

  const seriesId = "test-codex-series-1";
  const novelAId = "test-codex-novel-a";
  const novelBId = "test-codex-novel-b"; // In same series as novel A
  const novelStandaloneId = "test-codex-novel-standalone"; // No series

  const actAId = "test-codex-act-a";
  const chapterAId = "test-codex-chapter-a";
  const sceneA1Id = "test-codex-scene-a1";

  const actBId = "test-codex-act-b";
  const chapterBId = "test-codex-chapter-b";
  const sceneB1Id = "test-codex-scene-b1";

  beforeAll(async () => {
    const now = Temporal.Now.plainDateTimeISO();

    // 1. Create primary test user
    await db.orm.public.User.upsert({
      create: {
        id: userId,
        email: "codex-test@inkstory.local",
        name: "Codex Test User",
        updatedAt: now,
      },
      update: { updatedAt: now },
    });

    // 2. Create other user for permission testing
    await db.orm.public.User.upsert({
      create: {
        id: otherUserId,
        email: "codex-other@inkstory.local",
        name: "Other User",
        updatedAt: now,
      },
      update: { updatedAt: now },
    });

    // 3. Create Series
    await db.orm.public.Series.upsert({
      create: {
        id: seriesId,
        ownerId: userId,
        title: "Test Chronicles Series",
        position: 0,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });

    // 4. Create Novel A in Series
    await db.orm.public.Novel.upsert({
      create: {
        id: novelAId,
        ownerId: userId,
        seriesId,
        title: "Novel Book One",
        position: 0,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });

    // 5. Create Novel B in same Series
    await db.orm.public.Novel.upsert({
      create: {
        id: novelBId,
        ownerId: userId,
        seriesId,
        title: "Novel Book Two",
        position: 1,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });

    // 6. Create Standalone Novel
    await db.orm.public.Novel.upsert({
      create: {
        id: novelStandaloneId,
        ownerId: userId,
        seriesId: null,
        title: "Standalone Novel",
        position: 0,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });

    // 7. Hierarchy for Novel A -> Scene A1
    await db.orm.public.Act.upsert({
      create: { id: actAId, novelId: novelAId, title: "Act 1", position: 0, updatedAt: now },
      update: { updatedAt: now },
    });
    await db.orm.public.Chapter.upsert({
      create: { id: chapterAId, actId: actAId, title: "Chapter 1", position: 0, updatedAt: now },
      update: { updatedAt: now },
    });
    await db.orm.public.Scene.upsert({
      create: {
        id: sceneA1Id,
        chapterId: chapterAId,
        title: "Scene 1",
        position: 0,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });

    // 8. Hierarchy for Novel B -> Scene B1
    await db.orm.public.Act.upsert({
      create: { id: actBId, novelId: novelBId, title: "Act 1", position: 0, updatedAt: now },
      update: { updatedAt: now },
    });
    await db.orm.public.Chapter.upsert({
      create: { id: chapterBId, actId: actBId, title: "Chapter 1", position: 0, updatedAt: now },
      update: { updatedAt: now },
    });
    await db.orm.public.Scene.upsert({
      create: {
        id: sceneB1Id,
        chapterId: chapterBId,
        title: "Scene 1",
        position: 0,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });
  });

  afterAll(async () => {
    try {
      // Clean up test data cascade
      await db.orm.public.Series.where({ id: seriesId }).delete();
      await db.orm.public.Novel.where({ id: novelStandaloneId }).delete();
      await db.orm.public.User.where({ id: userId }).delete();
      await db.orm.public.User.where({ id: otherUserId }).delete();
    } catch {
      // Cleanup best effort
    }
  });

  describe("Entry Creation & Scoping Rules", () => {
    it("fails when name is blank", async () => {
      await expect(createCodexEntry(userId, { name: "   ", novelId: novelAId })).rejects.toThrow(
        CodexError,
      );
    });

    it("fails when book-scoped entry has no novelId", async () => {
      await expect(createCodexEntry(userId, { name: "Hero", seriesScoped: false })).rejects.toThrow(
        /Book-scoped codex entries require a novelId/,
      );
    });

    it("fails when series-scoped entry has no seriesId", async () => {
      await expect(
        createCodexEntry(userId, { name: "World Lore", seriesScoped: true }),
      ).rejects.toThrow(/Series-scoped codex entries require a seriesId/);
    });

    it("fails when creating entry for another user's novel or series", async () => {
      await expect(
        createCodexEntry(otherUserId, { name: "Intruder", novelId: novelAId }),
      ).rejects.toThrow(/permission/);

      await expect(
        createCodexEntry(otherUserId, { name: "Intruder", seriesScoped: true, seriesId }),
      ).rejects.toThrow(/permission/);
    });

    it("creates a book-scoped entry successfully with aliases and tags", async () => {
      const entry = await createCodexEntry(userId, {
        name: "Eldrin the Mage",
        type: "CHARACTER",
        description: "A scholar from the high tower.",
        trackingMode: "ALWAYS",
        seriesScoped: false,
        novelId: novelAId,
        aliases: ["The Gray Sage", "Eldrin"],
        tags: [{ name: "Protagonist", color: "#3b82f6" }],
        customFields: { magicRank: 5 },
      });

      expect(entry.id).toBeDefined();
      expect(entry.name).toBe("Eldrin the Mage");
      expect(entry.seriesScoped).toBe(false);
      expect(entry.novelId).toBe(novelAId);
      expect(entry.seriesId).toBe(seriesId); // inherited from Novel A
      expect(entry.aliases).toHaveLength(2);
      expect(entry.tags).toHaveLength(1);
      expect(entry.tags[0].name).toBe("Protagonist");
    });

    it("creates a series-scoped entry successfully", async () => {
      const entry = await createCodexEntry(userId, {
        name: "The First Sundering",
        type: "LORE",
        description: "Ancient disaster impacting the entire world.",
        seriesScoped: true,
        seriesId,
      });

      expect(entry.id).toBeDefined();
      expect(entry.name).toBe("The First Sundering");
      expect(entry.seriesScoped).toBe(true);
      expect(entry.seriesId).toBe(seriesId);
      expect(entry.novelId).toBeNull(); // Series-scoped has null novelId
    });
  });

  describe("Querying & Scoping Enforcement", () => {
    it("lists both book-scoped and series-scoped entries for Novel A", async () => {
      const entries = await listCodexEntriesForNovel(userId, novelAId);
      const names = entries.map((e) => e.name);

      expect(names).toContain("Eldrin the Mage"); // book-scoped to Novel A
      expect(names).toContain("The First Sundering"); // series-scoped to series
    });

    it("does NOT leak Novel A book-scoped entries into Novel B, but Novel B sees the series-scoped entry", async () => {
      // Create a book-scoped entry strictly for Novel B
      await createCodexEntry(userId, {
        name: "Boran the Guard",
        type: "CHARACTER",
        seriesScoped: false,
        novelId: novelBId,
      });

      const entriesB = await listCodexEntriesForNovel(userId, novelBId);
      const namesB = entriesB.map((e) => e.name);

      expect(namesB).toContain("Boran the Guard");
      expect(namesB).toContain("The First Sundering"); // Series-scoped is shared
      expect(namesB).not.toContain("Eldrin the Mage"); // Novel A entry must NOT appear in Novel B!
    });

    it("filters entries by type, trackingMode, and search string", async () => {
      const charEntries = await listCodexEntriesForNovel(userId, novelAId, {
        type: "CHARACTER",
      });
      expect(charEntries.every((e) => e.type === "CHARACTER")).toBe(true);

      const searchResult = await listCodexEntriesForNovel(userId, novelAId, {
        search: "Sundering",
      });
      expect(searchResult.some((e) => e.name === "The First Sundering")).toBe(true);
      expect(searchResult.some((e) => e.name === "Eldrin the Mage")).toBe(false);
    });

    it("lists series entries with seriesOnly flag", async () => {
      const seriesOnly = await listCodexEntriesForSeries(userId, seriesId, {
        seriesOnly: true,
      });
      expect(seriesOnly.every((e) => e.seriesScoped === true)).toBe(true);
      expect(seriesOnly.some((e) => e.name === "The First Sundering")).toBe(true);
      expect(seriesOnly.some((e) => e.name === "Eldrin the Mage")).toBe(false);
    });
  });

  describe("Update & Deletion", () => {
    it("updates entry details and prevents unauthorized updates", async () => {
      const created = await createCodexEntry(userId, {
        name: "Temporary Artifact",
        type: "ITEM",
        novelId: novelAId,
      });

      await expect(updateCodexEntry(otherUserId, created.id, { name: "Hacked" })).rejects.toThrow(
        /Unauthorized/,
      );

      const updated = await updateCodexEntry(userId, created.id, {
        name: "Ancient Staff of Power",
        color: "#10b981",
      });

      expect(updated.name).toBe("Ancient Staff of Power");
      expect(updated.color).toBe("#10b981");
    });

    it("soft deletes an entry and verifies it is excluded from novel listings", async () => {
      const created = await createCodexEntry(userId, {
        name: "Vanishing Ghost",
        type: "CHARACTER",
        novelId: novelAId,
      });

      const delResult = await deleteCodexEntry(userId, created.id);
      expect(delResult.success).toBe(true);
      expect(delResult.deleted).toBe("soft");

      // Verify it cannot be retrieved via getCodexEntry
      await expect(getCodexEntry(userId, created.id)).rejects.toThrow(CodexError);

      // Verify it is excluded from listCodexEntriesForNovel
      const novelEntries = await listCodexEntriesForNovel(userId, novelAId);
      expect(novelEntries.some((e) => e.id === created.id)).toBe(false);
    });

    it("hard deletes an entry cleanly", async () => {
      const created = await createCodexEntry(userId, {
        name: "Hard Delete Candidate",
        type: "ITEM",
        novelId: novelAId,
      });

      const hardDel = await deleteCodexEntry(userId, created.id, true);
      expect(hardDel.success).toBe(true);
      expect(hardDel.deleted).toBe("hard");

      const inDb = await db.orm.public.CodexEntry.where({ id: created.id }).first();
      expect(inDb).toBeNull();
    });

    it("updates scoping from book-scoped to series-scoped", async () => {
      const entry = await createCodexEntry(userId, {
        name: "Promoted to Series",
        novelId: novelAId,
        seriesScoped: false,
      });

      const updated = await updateCodexEntry(userId, entry.id, {
        seriesScoped: true,
        seriesId,
      });

      expect(updated.seriesScoped).toBe(true);
      expect(updated.seriesId).toBe(seriesId);
      expect(updated.novelId).toBeNull();
    });
  });

  describe("Aliases & Tags CRUD", () => {
    it("manages aliases lifecycle", async () => {
      const entry = await createCodexEntry(userId, {
        name: "Alias Test Subject",
        novelId: novelAId,
      });

      const alias = await createCodexAlias(userId, {
        entryId: entry.id,
        name: "The Shadow",
      });
      expect(alias.name).toBe("The Shadow");

      const refreshed = await getCodexEntry(userId, entry.id);
      expect(refreshed.aliases.some((a) => a.id === alias.id)).toBe(true);

      const del = await deleteCodexAlias(userId, alias.id);
      expect(del.success).toBe(true);

      const finalCheck = await getCodexEntry(userId, entry.id);
      expect(finalCheck.aliases.some((a) => a.id === alias.id)).toBe(false);
    });

    it("manages tags lifecycle", async () => {
      const entry = await createCodexEntry(userId, {
        name: "Tag Test Subject",
        novelId: novelAId,
      });

      const tag = await createCodexTag(userId, {
        entryId: entry.id,
        name: "Royalty",
        color: "#f59e0b",
      });
      expect(tag.name).toBe("Royalty");

      const refreshed = await getCodexEntry(userId, entry.id);
      expect(refreshed.tags.some((t) => t.id === tag.id)).toBe(true);

      const del = await deleteCodexTag(userId, tag.id);
      expect(del.success).toBe(true);
    });
  });

  describe("Relations Engine CRUD & Scoping", () => {
    it("rejects relation when source and target are the same", async () => {
      const entry = await createCodexEntry(userId, {
        name: "Lonely Soul",
        novelId: novelAId,
      });

      await expect(
        createCodexRelation(userId, {
          sourceEntryId: entry.id,
          targetEntryId: entry.id,
          relationType: "SELF",
        }),
      ).rejects.toThrow(/relation to itself/);
    });

    it("creates, updates, and deletes valid relations", async () => {
      const master = await createCodexEntry(userId, {
        name: "Master Luke",
        novelId: novelAId,
      });
      const apprentice = await createCodexEntry(userId, {
        name: "Apprentice Ben",
        novelId: novelAId,
      });

      const relation = await createCodexRelation(userId, {
        sourceEntryId: master.id,
        targetEntryId: apprentice.id,
        relationType: "MENTOR_TO",
        reverseType: "APPRENTICE_OF",
        description: "Training in the ways of the Force.",
      });

      expect(relation.relationType).toBe("MENTOR_TO");

      const updated = await updateCodexRelation(userId, relation.id, {
        description: "Training completed.",
      });
      expect(updated?.description).toBe("Training completed.");

      const del = await deleteCodexRelation(userId, relation.id);
      expect(del.success).toBe(true);
    });

    it("rejects relation between entries of different novels with no shared series", async () => {
      const bookAEntry = await createCodexEntry(userId, {
        name: "Character in Book A",
        novelId: novelAId,
      });
      const standaloneEntry = await createCodexEntry(userId, {
        name: "Character in Standalone",
        novelId: novelStandaloneId,
      });

      await expect(
        createCodexRelation(userId, {
          sourceEntryId: bookAEntry.id,
          targetEntryId: standaloneEntry.id,
          relationType: "RIVAL",
        }),
      ).rejects.toThrow(/Cannot relate entries from different novels outside a shared series/);
    });
  });

  describe("Temporal Progressions CRUD & Scoping", () => {
    it("creates progression when entry is accessible to the scene's novel", async () => {
      const hero = await createCodexEntry(userId, {
        name: "Hero with Progression",
        novelId: novelAId,
      });

      const prog = await createCodexProgression(userId, {
        entryId: hero.id,
        sceneId: sceneA1Id,
        mode: "ADDITION",
        description: "Discovered magical abilities in Scene 1.",
        position: 0,
      });

      expect(prog.id).toBeDefined();
      expect(prog.description).toBe("Discovered magical abilities in Scene 1.");

      const updated = await updateCodexProgression(userId, prog.id, {
        description: "Discovered greater powers.",
      });
      expect(updated?.description).toBe("Discovered greater powers.");

      const del = await deleteCodexProgression(userId, prog.id);
      expect(del.success).toBe(true);
    });

    it("allows series-scoped entry progression in any scene belonging to that series", async () => {
      const loreEntry = await createCodexEntry(userId, {
        name: "World Religion",
        type: "LORE",
        seriesScoped: true,
        seriesId,
      });

      const prog = await createCodexProgression(userId, {
        entryId: loreEntry.id,
        sceneId: sceneA1Id,
        mode: "ADDITION",
        description: "Temple discovered in Scene A1.",
      });

      expect(prog.id).toBeDefined();

      // Clean up
      await deleteCodexProgression(userId, prog.id);
    });

    it("rejects progression when scene context is invalid or not found", async () => {
      const entry = await createCodexEntry(userId, {
        name: "Lost Wanderer",
        novelId: novelAId,
      });

      await expect(
        createCodexProgression(userId, {
          entryId: entry.id,
          sceneId: "non-existent-scene",
          description: "Cannot link",
        }),
      ).rejects.toThrow(/Scene not found/);
    });

    it("rejects progression when book-scoped entry belongs to a different novel than the scene", async () => {
      const standaloneHero = await createCodexEntry(userId, {
        name: "Standalone Character",
        novelId: novelStandaloneId, // Standalone novel
      });

      // Attempt to link to Scene A1 (which is in Novel A)
      await expect(
        createCodexProgression(userId, {
          entryId: standaloneHero.id,
          sceneId: sceneA1Id,
          description: "Cannot cross books!",
        }),
      ).rejects.toThrow(/Book-scoped entry cannot be linked to a scene in a different novel/);
    });
  });

  describe("Mention Scanning Service Integration", () => {
    it("scans mentions in novel context identifying both book and series entries", async () => {
      // Eldrin the Mage (alias: The Gray Sage) and The First Sundering exist in Novel A context
      const text = "The Gray Sage studied the aftermath of The First Sundering.";
      const result = await scanMentionsInNovel(userId, novelAId, text);

      expect(result.matches.length).toBeGreaterThanOrEqual(2);
      const matchedTexts = result.matches.map((m) => m.matchedText);
      expect(matchedTexts).toContain("The Gray Sage");
      expect(matchedTexts).toContain("The First Sundering");
    });

    it("scans mentions in scene context including scene content and additional text", async () => {
      const result = await scanMentionsInScene(userId, sceneA1Id, "Eldrin was here.");
      expect(result.matchedEntryIds.length).toBeGreaterThan(0);
    });
  });
});
