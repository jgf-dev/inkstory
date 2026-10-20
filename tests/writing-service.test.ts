import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { db } from "../src/lib/prisma";
import {
  createOutlineNode,
  deleteOutlineNode,
  getNovelOutline,
  getSceneForEditor,
  moveOutlineNode,
  renameOutlineNode,
  updateScene,
} from "../src/lib/writing/service";
import { countWords } from "../src/lib/writing/word-count";

describe("Writing Service (outline, scenes, attachments)", { timeout: 30_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const otherUserId = crypto.randomUUID();

  const novelId = `ws-novel-${runId}`;
  const otherNovelId = `ws-other-novel-${runId}`;

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

  it("computes act positions per novel, not across novels", async () => {
    const ts = await now();
    const novelA = `ws-pos-a-${runId}`;
    const novelB = `ws-pos-b-${runId}`;
    for (const id of [novelA, novelB]) {
      await db.orm.public.Novel.create({
        id,
        ownerId: userId,
        title: id,
        position: 0,
        createdAt: ts,
        updatedAt: ts,
        deletedAt: null,
      });
    }
    const a0 = await createOutlineNode(userId, novelA, { kind: "act" });
    const a1 = await createOutlineNode(userId, novelA, { kind: "act" });
    const a2 = await createOutlineNode(userId, novelA, { kind: "act" });
    const b0 = await createOutlineNode(userId, novelB, { kind: "act" });
    expect([a0, a1, a2].map((r) => (r.node as { position: number }).position)).toEqual([0, 1, 2]);
    expect((b0.node as { position: number }).position).toBe(0);
  });

  it("orders equal-position siblings by createdAt then id in reads and moves", async () => {
    const tieNovel = `ws-tie-${runId}`;
    const base = await now();
    await db.orm.public.Novel.create({
      id: tieNovel,
      ownerId: userId,
      title: "Tie",
      position: 0,
      createdAt: base,
      updatedAt: base,
      deletedAt: null,
    });
    // ids sort opposite to creation time, so an id-only tie-break would differ.
    const rows = [
      { id: `z-${runId}`, title: "First", createdAt: base.subtract({ minutes: 2 }) },
      { id: `m-${runId}`, title: "Second", createdAt: base.subtract({ minutes: 1 }) },
      { id: `a-${runId}`, title: "Third", createdAt: base.subtract({ minutes: 1 }) },
    ];
    for (const r of rows) {
      await db.orm.public.Act.create({
        id: r.id,
        novelId: tieNovel,
        title: r.title,
        position: 0,
        createdAt: r.createdAt,
        updatedAt: base,
        deletedAt: null,
      });
    }
    let outline = await getNovelOutline(userId, tieNovel);
    expect(outline.acts.map((a) => a.title)).toEqual(["First", "Third", "Second"]);

    await moveOutlineNode(userId, tieNovel, { kind: "act", id: `z-${runId}`, direction: "down" });
    outline = await getNovelOutline(userId, tieNovel);
    expect(outline.acts.map((a) => a.title)).toEqual(["Third", "First", "Second"]);
    expect(outline.acts.map((a) => a.position)).toEqual([0, 1, 2]);
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
