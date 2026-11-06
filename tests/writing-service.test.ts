import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { db } from "../src/lib/prisma";
import {
  createOutlineNode,
  deleteOutlineNode,
  getNovelOutline,
  getSceneForEditor,
  getSceneRevision,
  listSceneRevisions,
  moveOutlineNode,
  renameOutlineNode,
  restoreSceneRevision,
  updateScene,
} from "../src/lib/writing/service";
import { plainTextFromDoc } from "../src/lib/writing/tiptap";
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

  it("moves an outline node to an absolute sibling index in one step", async () => {
    const third = await createOutlineNode(userId, novelId, { kind: "act", title: "Act III" });
    const thirdId = (third.node as { id: string }).id;

    let outline = await getNovelOutline(userId, novelId);
    expect(outline.acts.map((a) => a.title)).toEqual(["Act I", "Act II", "Act III"]);

    const moved = await moveOutlineNode(userId, novelId, {
      kind: "act",
      id: thirdId,
      toIndex: 0,
    });
    expect(moved.moved).toBe(true);
    outline = await getNovelOutline(userId, novelId);
    expect(outline.acts.map((a) => a.title)).toEqual(["Act III", "Act I", "Act II"]);
    expect(outline.acts.map((a) => a.position)).toEqual([0, 1, 2]);

    const noop = await moveOutlineNode(userId, novelId, {
      kind: "act",
      id: thirdId,
      toIndex: 0,
    });
    expect(noop.moved).toBe(false);

    await expect(moveOutlineNode(userId, novelId, { kind: "act", id: thirdId })).rejects.toThrow(
      /exactly one of direction or toIndex/,
    );

    await expect(
      moveOutlineNode(userId, novelId, { kind: "act", id: thirdId, toIndex: -1 }),
    ).rejects.toThrow(/toIndex must be a non-negative integer/);

    // Clamping to end: toIndex 999 moves Act III back to index 2
    const clamped = await moveOutlineNode(userId, novelId, {
      kind: "act",
      id: thirdId,
      toIndex: 999,
    });
    expect(clamped.moved).toBe(true);
    outline = await getNovelOutline(userId, novelId);
    expect(outline.acts.map((a) => a.title)).toEqual(["Act I", "Act II", "Act III"]);

    // Clean up the extra act so later tests see the original two.
    await deleteOutlineNode(userId, novelId, "act", thirdId);
    // Restore Act I first if needed
    outline = await getNovelOutline(userId, novelId);
    if (outline.acts[0].title !== "Act I") {
      const actI = outline.acts.find((a) => a.title === "Act I");
      if (actI) {
        await moveOutlineNode(userId, novelId, { kind: "act", id: actI.id, toIndex: 0 });
      }
    }
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
    expect(editor.contentFormat).toBe("PLAIN");
    expect(editor.contentDoc).toBeNull();

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

  it("dual-writes contentDoc and creates revision snapshots", async () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Rich prose for the quay.", marks: [{ type: "bold" }] }],
        },
      ],
    };
    const updated = await updateScene(userId, sceneId, {
      contentDoc: doc,
      revisionReason: "MANUAL",
    });
    expect(updated.contentFormat).toBe("TIPTAP_JSON");
    expect(updated.content).toBe("Rich prose for the quay.");
    expect(updated.wordCount).toBe(countWords("Rich prose for the quay."));
    expect(updated.contentDoc).toEqual(doc);

    const revisions = await listSceneRevisions(userId, sceneId);
    expect(revisions.length).toBeGreaterThanOrEqual(1);
    expect(revisions[0].reason).toBe("MANUAL");
    expect(revisions[0].title).toBe("Storm Climb");

    // Mismatched content + contentDoc is rejected.
    await expect(
      updateScene(userId, sceneId, {
        contentDoc: doc,
        content: "totally different",
      }),
    ).rejects.toThrow(/does not match/);

    // Plain-only patch after TIPTAP_JSON wraps into a doc.
    const plain = await updateScene(userId, sceneId, {
      content: "Plain overwrite after rich.",
      revisionReason: "MANUAL",
    });
    expect(plain.contentFormat).toBe("TIPTAP_JSON");
    expect(plain.content).toBe("Plain overwrite after rich.");
    expect(plainTextFromDoc(plain.contentDoc)).toBe("Plain overwrite after rich.");
  });

  it("loads a single revision detail", async () => {
    const revisions = await listSceneRevisions(userId, sceneId, 5);
    expect(revisions.length).toBeGreaterThan(0);
    const detail = await getSceneRevision(userId, sceneId, revisions[0].id);
    expect(detail.id).toBe(revisions[0].id);
    expect(typeof detail.content).toBe("string");
    await expect(getSceneRevision(userId, sceneId, "no-such")).rejects.toThrow(/not found/);
  });

  it("restores a revision after snapshotting the live scene", async () => {
    // Ensure at least one content revision exists to restore.
    const before = await updateScene(userId, sceneId, {
      content: "Version A alpha",
      revisionReason: "MANUAL",
    });
    expect(before.content).toBe("Version A alpha");

    const mid = await updateScene(userId, sceneId, {
      content: "Version B beta",
      revisionReason: "MANUAL",
    });
    expect(mid.content).toBe("Version B beta");

    const revisions = await listSceneRevisions(userId, sceneId, 10);
    // Newest snapshot is the pre-B state (Version A) created when saving B.
    const target = revisions.find((r) => r.contentPreview.includes("Version A"));
    expect(target).toBeTruthy();

    const restored = await restoreSceneRevision(userId, sceneId, target!.id);
    expect(restored.content).toBe("Version A alpha");

    const after = await listSceneRevisions(userId, sceneId, 10);
    expect(after.some((r) => r.reason === "RESTORE")).toBe(true);

    await expect(listSceneRevisions(otherUserId, sceneId)).rejects.toThrow(/do not have access/);
    await expect(restoreSceneRevision(userId, sceneId, "missing-rev")).rejects.toThrow(/not found/);
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
