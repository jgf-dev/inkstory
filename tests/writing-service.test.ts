import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { db } from "../src/lib/prisma";
import {
  createOutlineNode,
  deleteOutlineNode,
  getNovelOutline,
  getSceneContextData,
  getSceneForEditor,
  moveOutlineNode,
  renameOutlineNode,
  setSceneAttachment,
  updateScene,
} from "../src/lib/writing/service";
import { countWords } from "../src/lib/writing/word-count";
import { createCodexEntry } from "../src/lib/codex/service";

describe("Writing Service (outline, scenes, attachments)", { timeout: 30_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();

  const novelId = `ws-novel-${runId}`;
  const otherNovelId = `ws-other-novel-${runId}`;
  let charEntryId = "";
  let alwaysEntryId = "";
  let neverEntryId = "";

  let actId: string;
  let chapterId: string;
  let sceneId: string;

  async function now() {
    return Temporal.Now.plainDateTimeISO();
  }

  beforeAll(async () => {
    const ts = await now();

    await db.orm.public.User.upsert({
      create: { id: userId, email: `ws-owner-${runId}@inkstory.local`, updatedAt: ts },
      update: { updatedAt: ts },
    });
    await db.orm.public.User.upsert({
      create: { id: otherUserId, email: `ws-other-${runId}@inkstory.local`, updatedAt: ts },
      update: { updatedAt: ts },
    });
    await db.orm.public.Novel.upsert({
      create: {
        id: novelId,
        ownerId: userId,
        title: "Workspace Novel",
        position: 0,
        updatedAt: ts,
      },
      update: { updatedAt: ts },
    });
    await db.orm.public.Novel.upsert({
      create: {
        id: otherNovelId,
        ownerId: otherUserId,
        title: "Other Novel",
        position: 0,
        updatedAt: ts,
      },
      update: { updatedAt: ts },
    });

    // Codex entries for context drawer / assembly seed tests.
    await createCodexEntry(userId, {
      name: "Mara Vane",
      type: "CHARACTER",
      description: "Ex-smuggler turned captain.",
      novelId,
      aliases: ["Rook"],
    });
    await createCodexEntry(userId, {
      name: "The Ashfall Charter",
      type: "LORE",
      description: "Founding treaty of the free cities.",
      trackingMode: "ALWAYS",
      novelId,
    });
    await createCodexEntry(userId, {
      name: "Brass Sextant",
      type: "ITEM",
      description: "Mara's enchanted navigational tool.",
      trackingMode: "NEVER",
      novelId,
    });

    const entries = await db.orm.public.CodexEntry.where((e) => e.novelId.eq(novelId)).all();
    for (const entry of entries) {
      if (entry.name === "Mara Vane") charEntryId = entry.id;
      if (entry.name === "The Ashfall Charter") alwaysEntryId = entry.id;
      if (entry.name === "Brass Sextant") neverEntryId = entry.id;
    }
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

  it("creates act → chapter → scene with defaults and positions", async () => {
    const act = await createOutlineNode(userId, novelId, { kind: "act" });
    expect(act.kind).toBe("act");
    expect((act.node as { title: string }).title).toBe("New Act");
    actId = (act.node as { id: string }).id;

    const chapter = await createOutlineNode(userId, novelId, {
      kind: "chapter",
      parentId: actId,
      title: "Chapter One",
    });
    chapterId = (chapter.node as { id: string }).id;
    expect((chapter.node as { title: string }).title).toBe("Chapter One");

    const scene = await createOutlineNode(userId, novelId, { kind: "scene", parentId: chapterId });
    sceneId = (scene.node as { id: string }).id;
    const sceneRow = scene.node as { title: string; pov: string; tense: string; content: string };
    expect(sceneRow.title).toBe("New Scene");
    expect(sceneRow.pov).toBe("THIRD_LIMITED");
    expect(sceneRow.tense).toBe("PAST");
    expect(sceneRow.content).toBe("");
  });

  it("rejects invalid outline creates", async () => {
    await expect(createOutlineNode(userId, novelId, { kind: "chapter" })).rejects.toThrow(
      /Chapters require an act id/,
    );
    await expect(createOutlineNode(otherUserId, novelId, { kind: "act" })).rejects.toThrow(
      /do not have access/,
    );
    await expect(createOutlineNode(userId, "missing-novel", { kind: "act" })).rejects.toThrow(
      /Novel not found/,
    );
  });

  it("returns a nested outline with word-count totals", async () => {
    // Give the scene some content through updateScene (also covers word count).
    const updated = await updateScene(userId, sceneId, {
      content: "Mara climbed the rigging while the storm rolled in.",
    });
    expect(updated.wordCount).toBe(
      countWords("Mara climbed the rigging while the storm rolled in."),
    );

    const outline = await getNovelOutline(userId, novelId);
    expect(outline.novel.id).toBe(novelId);
    expect(outline.totals.scenes).toBe(1);
    expect(outline.totals.words).toBe(updated.wordCount);
    expect(outline.acts[0].chapters[0].scenes[0].wordCount).toBe(updated.wordCount);
  });

  it("renames and moves outline nodes with sibling swaps", async () => {
    await renameOutlineNode(userId, novelId, { kind: "act", id: actId, title: "Act I" });
    const renamed = await createOutlineNode(userId, novelId, { kind: "act", title: "Act II" });
    const secondActId = (renamed.node as { id: string }).id;

    const moved = await moveOutlineNode(userId, novelId, {
      kind: "act",
      id: secondActId,
      direction: "up",
    });
    expect(moved.moved).toBe(true);

    let outline = await getNovelOutline(userId, novelId);
    expect(outline.acts[0].title).toBe("Act II");
    expect(outline.acts[1].title).toBe("Act I");

    // Moving the first act up again is a no-op at the edge.
    const edge = await moveOutlineNode(userId, novelId, {
      kind: "act",
      id: secondActId,
      direction: "up",
    });
    expect(edge.moved).toBe(false);
    outline = await getNovelOutline(userId, novelId);
    expect(outline.acts[0].title).toBe("Act II");

    // Restore original order for later tests.
    await moveOutlineNode(userId, novelId, { kind: "act", id: secondActId, direction: "down" });
  });

  it("rename/move rejects nodes outside the novel", async () => {
    await expect(
      renameOutlineNode(userId, novelId, { kind: "act", id: "nope", title: "X" }),
    ).rejects.toThrow(/not found in this novel/);
    await expect(
      moveOutlineNode(otherUserId, novelId, { kind: "act", id: actId, direction: "up" }),
    ).rejects.toThrow(/do not have access/);
  });

  it("loads the editor scene with breadcrumbs", async () => {
    const editor = await getSceneForEditor(userId, sceneId);
    expect(editor.novelId).toBe(novelId);
    expect(editor.chapterTitle).toBe("Chapter One");
    expect(editor.pov).toBe("THIRD_LIMITED");
    expect(typeof editor.updatedAt).toBe("string");

    await expect(getSceneForEditor(otherUserId, sceneId)).rejects.toThrow(/do not have access/);
  });

  it("updates scene metadata with validation", async () => {
    const updated = await updateScene(userId, sceneId, {
      pov: "FIRST",
      tense: "PRESENT",
      summary: "Mara races the storm to the harbor.",
      title: "Storm Climb",
    });
    expect(updated.pov).toBe("FIRST");
    expect(updated.tense).toBe("PRESENT");
    expect(updated.summary).toBe("Mara races the storm to the harbor.");
    expect(updated.title).toBe("Storm Climb");

    await expect(updateScene(userId, sceneId, { pov: "SIDEWAYS" as never })).rejects.toThrow(
      /Invalid POV/,
    );
    await expect(updateScene(userId, sceneId, { tense: "FUTUREISH" as never })).rejects.toThrow(
      /Invalid tense/,
    );
    await expect(updateScene(userId, sceneId, { title: "   " })).rejects.toThrow(/empty/);
    await expect(updateScene(otherUserId, sceneId, { content: "hijack" })).rejects.toThrow(
      /do not have access/,
    );
  });

  it("pins, re-pins idempotently, and unpins codex entries", async () => {
    const pinned = await setSceneAttachment(userId, sceneId, alwaysEntryId, true);
    expect(pinned.attached).toBe(true);
    expect(pinned.alreadyAttached).toBe(false);

    const again = await setSceneAttachment(userId, sceneId, alwaysEntryId, true);
    expect(again.attached).toBe(true);
    expect(again.alreadyAttached).toBe(true);

    const detached = await setSceneAttachment(userId, sceneId, alwaysEntryId, false);
    expect(detached.attached).toBe(false);

    // Re-attach after detach works (unique pair stays reusable).
    const reattached = await setSceneAttachment(userId, sceneId, alwaysEntryId, true);
    expect(reattached.attached).toBe(true);

    await expect(setSceneAttachment(userId, sceneId, "missing-entry", true)).rejects.toThrow(
      /not available in this novel/,
    );
  });

  it("pinned attachments seed context assembly even for NEVER-tracked entries", async () => {
    const pinned = await setSceneAttachment(userId, sceneId, neverEntryId, true);
    expect(pinned.attached).toBe(true);

    await updateScene(userId, sceneId, {
      content: "Mara Vane checked the brass sextant while Rook signaled from the quay.",
    });

    const context = await getSceneContextData(userId, sceneId);
    const contextEntryIds = context.estimate.selectedEntries;
    expect(contextEntryIds).toBeGreaterThan(0);

    // Drawer data surfaces the pinned row and the ALWAYS entry.
    const pinnedIds = context.attachments.map((a) => a.entryId);
    expect(pinnedIds).toContain(neverEntryId);
    expect(context.alwaysIncluded.map((e) => e.entryId)).toContain(alwaysEntryId);

    // Detected mentions from the saved content.
    expect(context.detected.matchedEntryIds).toContain(charEntryId);
    expect(context.detectedEntries.map((e) => e.entryId)).toContain(charEntryId);

    // Estimate respects the FREE-tier 4,000 token ceiling.
    expect(context.estimate.maxTokens).toBe(4000);
    expect(context.estimate.estimatedTokens).toBeLessThanOrEqual(4000);

    await setSceneAttachment(userId, sceneId, neverEntryId, false);
  });

  it("soft-deletes scenes, cascading chapters and acts", async () => {
    const scene = await createOutlineNode(userId, novelId, { kind: "scene", parentId: chapterId });
    const extraSceneId = (scene.node as { id: string }).id;

    await deleteOutlineNode(userId, novelId, "scene", extraSceneId);
    let outline = await getNovelOutline(userId, novelId);
    expect(
      outline.acts
        .flatMap((a) => a.chapters)
        .flatMap((c) => c.scenes)
        .map((s) => s.id),
    ).not.toContain(extraSceneId);

    await deleteOutlineNode(userId, novelId, "chapter", chapterId);
    outline = await getNovelOutline(userId, novelId);
    expect(outline.acts.find((a) => a.id === actId)?.chapters.length).toBe(0);
  });
});
