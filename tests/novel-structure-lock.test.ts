import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { db } from "../src/lib/prisma";
import { importManuscript } from "../src/lib/import/service";
import type { ImportManuscript } from "../src/lib/import/types";
import { lockNovelStructure, novelStructureLockKey } from "../src/lib/writing/novel-lock";
import { createOutlineNode, moveOutlineNode } from "../src/lib/writing/service";

describe("novelStructureLockKey", () => {
  it("uses the key import confirm has always taken", () => {
    expect(novelStructureLockKey("abc")).toBe("novel-import:abc");
  });
});

describe("novel structure lock (database)", { timeout: 60_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const novelIds: string[] = [];

  const scene = { subtitle: null, summary: null, content: "x", wordCount: 1 };
  const manuscript = (tag: string): ImportManuscript => ({
    title: null,
    subtitle: null,
    acts: [1, 2, 3].map((n) => ({
      title: `${tag}-${n}`,
      chapters: [{ title: `${tag}-c${n}`, scenes: [{ ...scene, title: `${tag}-s${n}` }] }],
    })),
  });

  async function createNovel(label: string): Promise<string> {
    const id = `test-lock-${label}-${runId}`;
    await db.orm.public.Novel.create({
      id,
      ownerId: userId,
      title: label,
      updatedAt: Temporal.Now.plainDateTimeISO(),
    });
    novelIds.push(id);
    return id;
  }

  async function actPositions(novelId: string): Promise<number[]> {
    const acts = await db.orm.public.Act.where((a) => a.novelId.eq(novelId))
      .where((a) => a.deletedAt.isNull())
      .all();
    return acts.map((a) => a.position).sort((a, b) => a - b);
  }

  const contiguous = (n: number) => Array.from({ length: n }, (_, i) => i);

  beforeAll(async () => {
    const now = Temporal.Now.plainDateTimeISO();
    await db.orm.public.User.upsert({
      create: { id: userId, email: `lock-${userId}@inkstory.local`, updatedAt: now },
      update: { updatedAt: now },
    });
  });

  afterAll(async () => {
    for (const id of novelIds) await db.orm.public.Novel.where({ id }).delete();
    await db.orm.public.User.where({ id: userId }).delete();
  });

  it("keeps act positions unique and contiguous when reorder, create and import confirm race", async () => {
    const novelId = await createNovel("race");
    const first = await createOutlineNode(userId, novelId, { kind: "act", title: "First" });
    await createOutlineNode(userId, novelId, { kind: "act", title: "Second" });

    for (let round = 0; round < 3; round++) {
      await Promise.all([
        importManuscript(userId, novelId, manuscript(`R${round}`)),
        moveOutlineNode(userId, novelId, { kind: "act", id: first.node.id, direction: "down" }),
        createOutlineNode(userId, novelId, { kind: "act", title: `Manual-${round}` }),
        importManuscript(userId, novelId, manuscript(`S${round}`)),
        moveOutlineNode(userId, novelId, { kind: "act", id: first.node.id, direction: "up" }),
      ]);
    }

    // 2 seeded + 3 rounds × (2 imports × 3 acts + 1 manual act).
    expect(await actPositions(novelId)).toEqual(contiguous(2 + 3 * 7));
  });

  it("makes a manual create wait for a transaction holding the lock, then read positions", async () => {
    const novelId = await createNovel("wait");
    await createOutlineNode(userId, novelId, { kind: "act", title: "A" });

    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));

    const holder = db.transaction(async (tx) => {
      await lockNovelStructure(tx, novelId);
      signalLocked();
      await released;
      const now = Temporal.Now.plainDateTimeISO();
      await tx.orm.public.Act.create({
        id: crypto.randomUUID(),
        novelId,
        title: "Held",
        position: 1,
        createdAt: now,
        updatedAt: now,
      });
    });
    await locked;

    let settled = false;
    const create = createOutlineNode(userId, novelId, { kind: "act", title: "B" }).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);

    release();
    await holder;
    const created = await create;
    // Read after the holder committed, so it lands after "Held".
    expect(created.node.position).toBe(2);
    expect(await actPositions(novelId)).toEqual([0, 1, 2]);
  });

  it("makes a reorder wait for the lock and swap against committed positions", async () => {
    const novelId = await createNovel("move");
    const a = await createOutlineNode(userId, novelId, { kind: "act", title: "A" });
    const b = await createOutlineNode(userId, novelId, { kind: "act", title: "B" });

    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));

    // The holder shifts both acts up by 10 before releasing; the reorder must
    // see those committed positions, not the ones it could have read earlier.
    const holder = db.transaction(async (tx) => {
      await lockNovelStructure(tx, novelId);
      signalLocked();
      await released;
      await tx.orm.public.Act.where({ id: a.node.id }).update({ position: 10 });
      await tx.orm.public.Act.where({ id: b.node.id }).update({ position: 11 });
    });
    await locked;

    let settled = false;
    const move = moveOutlineNode(userId, novelId, {
      kind: "act",
      id: a.node.id,
      direction: "down",
    }).then((r) => {
      settled = true;
      return r;
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);

    release();
    await holder;
    expect(await move).toMatchObject({ moved: true });
    const after = await db.orm.public.Act.where((x) => x.novelId.eq(novelId)).all();
    const byId = new Map(after.map((x) => [x.id, x.position]));
    expect(byId.get(a.node.id)).toBe(11);
    expect(byId.get(b.node.id)).toBe(10);
  });

  it("serialises chapter and scene creates under the same lock", async () => {
    const novelId = await createNovel("children");
    const act = await createOutlineNode(userId, novelId, { kind: "act" });
    const chapters = await Promise.all(
      [0, 1, 2, 3].map(() =>
        createOutlineNode(userId, novelId, { kind: "chapter", parentId: act.node.id }),
      ),
    );
    expect(chapters.map((c) => c.node.position).sort((x, y) => x - y)).toEqual([0, 1, 2, 3]);

    const scenes = await Promise.all(
      [0, 1, 2].map(() =>
        createOutlineNode(userId, novelId, { kind: "scene", parentId: chapters[0].node.id }),
      ),
    );
    expect(scenes.map((s) => s.node.position).sort((x, y) => x - y)).toEqual([0, 1, 2]);
  });
  it("reorders chapters and scenes inside the lock", async () => {
    const novelId = await createNovel("move-children");
    const act = await createOutlineNode(userId, novelId, { kind: "act" });
    const c0 = await createOutlineNode(userId, novelId, { kind: "chapter", parentId: act.node.id });
    const c1 = await createOutlineNode(userId, novelId, { kind: "chapter", parentId: act.node.id });
    const s0 = await createOutlineNode(userId, novelId, { kind: "scene", parentId: c0.node.id });
    const s1 = await createOutlineNode(userId, novelId, { kind: "scene", parentId: c0.node.id });

    await Promise.all([
      moveOutlineNode(userId, novelId, { kind: "chapter", id: c0.node.id, direction: "down" }),
      moveOutlineNode(userId, novelId, { kind: "scene", id: s1.node.id, direction: "up" }),
    ]);

    const chapters = await db.orm.public.Chapter.where((c) => c.actId.eq(act.node.id)).all();
    const chapterPos = new Map(chapters.map((c) => [c.id, c.position]));
    expect([chapterPos.get(c1.node.id), chapterPos.get(c0.node.id)]).toEqual([0, 1]);
    const scenes = await db.orm.public.Scene.where((x) => x.chapterId.eq(c0.node.id)).all();
    const scenePos = new Map(scenes.map((x) => [x.id, x.position]));
    expect([scenePos.get(s1.node.id), scenePos.get(s0.node.id)]).toEqual([0, 1]);
  });

  it("reports 404 when the node is deleted while the reorder waits for the lock", async () => {
    const novelId = await createNovel("move-deleted");
    const a = await createOutlineNode(userId, novelId, { kind: "act", title: "A" });
    await createOutlineNode(userId, novelId, { kind: "act", title: "B" });

    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => (signalLocked = resolve));

    const holder = db.transaction(async (tx) => {
      await lockNovelStructure(tx, novelId);
      signalLocked();
      await released;
      await tx.orm.public.Act.where({ id: a.node.id }).update({
        deletedAt: Temporal.Now.plainDateTimeISO(),
      });
    });
    await locked;

    const move = moveOutlineNode(userId, novelId, {
      kind: "act",
      id: a.node.id,
      direction: "down",
    });
    const outcome = move.then(
      () => null,
      (err: unknown) => err,
    );
    release();
    await holder;
    expect(await outcome).toMatchObject({ status: 404 });
  });
});
