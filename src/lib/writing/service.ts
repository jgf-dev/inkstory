import { Temporal } from "temporal-polyfill";
import { db } from "@/lib/prisma";
import { CodexError } from "@/lib/codex/errors";
import { isPovValue, isTenseValue, type PovValue, type TenseValue } from "./meta";
import { toEpochMs, toIsoString } from "./dates";
import { countWords } from "./word-count";
import { lockNovelStructure, type DbTransaction } from "./novel-lock";

function nowTimestamp(): Temporal.PlainDateTime {
  return Temporal.Now.plainDateTimeISO();
}

// ─── Ownership resolution ────────────────────────────────────────────────────

async function loadNovel(userId: string, novelId: string) {
  const novel = await db.orm.public.Novel.where({ id: novelId }).first();
  if (!novel || novel.deletedAt !== null) {
    throw new CodexError("Novel not found", "NOT_FOUND", 404);
  }
  if (novel.ownerId !== userId) {
    throw new CodexError("You do not have access to this novel", "FORBIDDEN", 403);
  }
  return novel;
}

/**
 * Resolves the novel owning a scene through the Chapter → Act chain,
 * enforcing soft-delete and ownership checks at every hop.
 */
async function resolveSceneOwnership(sceneId: string) {
  const scene = await db.orm.public.Scene.where({ id: sceneId }).first();
  if (!scene || scene.deletedAt !== null) {
    throw new CodexError("Scene not found", "NOT_FOUND", 404);
  }
  const chapter = await db.orm.public.Chapter.where({ id: scene.chapterId }).first();
  if (!chapter || chapter.deletedAt !== null) {
    throw new CodexError("Chapter not found for scene", "NOT_FOUND", 404);
  }
  const act = await db.orm.public.Act.where({ id: chapter.actId }).first();
  if (!act || act.deletedAt !== null) {
    throw new CodexError("Act not found for scene", "NOT_FOUND", 404);
  }
  const novel = await db.orm.public.Novel.where({ id: act.novelId }).first();
  if (!novel || novel.deletedAt !== null) {
    throw new CodexError("Novel not found for scene", "NOT_FOUND", 404);
  }
  return { scene, chapter, act, novel };
}

async function assertSceneAccess(userId: string, sceneId: string) {
  const { scene, chapter, act, novel } = await resolveSceneOwnership(sceneId);
  if (novel.ownerId !== userId) {
    throw new CodexError("You do not have access to this scene", "FORBIDDEN", 403);
  }
  return { scene, chapter, act, novel };
}

// ─── Outline tree ────────────────────────────────────────────────────────────

export interface OutlineScene {
  id: string;
  title: string;
  label: string | null;
  position: number;
  wordCount: number;
}

export interface OutlineChapter {
  id: string;
  title: string;
  position: number;
  scenes: OutlineScene[];
}

export interface OutlineAct {
  id: string;
  title: string;
  position: number;
  chapters: OutlineChapter[];
}

export interface NovelOutline {
  novel: {
    id: string;
    title: string;
    subtitle: string | null;
    seriesId: string | null;
  };
  acts: OutlineAct[];
  totals: { acts: number; chapters: number; scenes: number; words: number };
}

/**
 * The single sibling ordering used everywhere (outline reads and moves):
 * position first, then creation time, then id as the final tie-break.
 */
export function byPositionThenCreated(
  a: { position: number; createdAt: unknown; id: string },
  b: { position: number; createdAt: unknown; id: string },
): number {
  return (
    a.position - b.position ||
    toEpochMs(a.createdAt) - toEpochMs(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

/**
 * Loads the full Act → Chapter → Scene outline of a novel with word-count
 * rollups. All rows are soft-delete filtered and ownership-checked.
 */
export async function getNovelOutline(userId: string, novelId: string): Promise<NovelOutline> {
  const novel = await loadNovel(userId, novelId);

  const acts = await db.orm.public.Act.where((a) => a.novelId.eq(novel.id))
    .where((a) => a.deletedAt.isNull())
    .all();
  acts.sort(byPositionThenCreated);
  const actIds = acts.map((a) => a.id);

  const chapters = actIds.length
    ? await db.orm.public.Chapter.where((c) => c.actId.in(actIds))
        .where((c) => c.deletedAt.isNull())
        .all()
    : [];
  chapters.sort(byPositionThenCreated);
  const chapterIds = chapters.map((c) => c.id);

  const scenes = chapterIds.length
    ? await db.orm.public.Scene.where((s) => s.chapterId.in(chapterIds))
        .where((s) => s.deletedAt.isNull())
        .all()
    : [];
  scenes.sort(byPositionThenCreated);

  const scenesByChapter = new Map<string, OutlineScene[]>();
  for (const scene of scenes) {
    const list = scenesByChapter.get(scene.chapterId) ?? [];
    list.push({
      id: scene.id,
      title: scene.title,
      label: scene.label,
      position: scene.position,
      wordCount: scene.wordCount,
    });
    scenesByChapter.set(scene.chapterId, list);
  }

  const chaptersByAct = new Map<string, OutlineChapter[]>();
  for (const chapter of chapters) {
    const list = chaptersByAct.get(chapter.actId) ?? [];
    list.push({
      id: chapter.id,
      title: chapter.title,
      position: chapter.position,
      scenes: scenesByChapter.get(chapter.id) ?? [],
    });
    chaptersByAct.set(chapter.actId, list);
  }

  const outlineActs: OutlineAct[] = acts.map((act) => ({
    id: act.id,
    title: act.title,
    position: act.position,
    chapters: chaptersByAct.get(act.id) ?? [],
  }));

  const totals = {
    acts: outlineActs.length,
    chapters: chapters.length,
    scenes: scenes.length,
    words: scenes.reduce((sum, s) => sum + s.wordCount, 0),
  };

  return {
    novel: {
      id: novel.id,
      title: novel.title,
      subtitle: novel.subtitle,
      seriesId: novel.seriesId,
    },
    acts: outlineActs,
    totals,
  };
}

// ─── Outline mutations ───────────────────────────────────────────────────────

export type OutlineKind = "act" | "chapter" | "scene";

export interface CreateOutlineNodeInput {
  kind: OutlineKind;
  title?: string;
  /** Parent id: required for chapters (act id) and scenes (chapter id). */
  parentId?: string;
  position?: number;
}

export interface MoveOutlineNodeInput {
  kind: OutlineKind;
  id: string;
  direction: "up" | "down";
}

export interface RenameOutlineNodeInput {
  kind: OutlineKind;
  id: string;
  title: string;
}

const DEFAULT_TITLES: Record<OutlineKind, string> = {
  act: "New Act",
  chapter: "New Chapter",
  scene: "New Scene",
};

/**
 * Live (non-deleted) siblings under a parent, read inside the caller's
 * transaction. For acts the parent is the novel, so `parentId` is the novel
 * id; for chapters/scenes it is the act or chapter id.
 */
async function loadSiblings(
  tx: DbTransaction,
  kind: OutlineKind,
  parentId: string,
): Promise<Array<{ id: string; position: number; createdAt: unknown }>> {
  if (kind === "act") {
    return tx.orm.public.Act.where((a) => a.novelId.eq(parentId))
      .where((a) => a.deletedAt.isNull())
      .all();
  }
  if (kind === "chapter") {
    return tx.orm.public.Chapter.where((c) => c.actId.eq(parentId))
      .where((c) => c.deletedAt.isNull())
      .all();
  }
  return tx.orm.public.Scene.where((s) => s.chapterId.eq(parentId))
    .where((s) => s.deletedAt.isNull())
    .all();
}

/** Next free position among a node's siblings. */
async function computeNextPosition(
  tx: DbTransaction,
  kind: OutlineKind,
  parentId: string,
): Promise<number> {
  const siblings = await loadSiblings(tx, kind, parentId);
  return siblings.reduce((max, s) => Math.max(max, s.position), -1) + 1;
}

/**
 * Runs a position write for a novel inside one transaction that first takes
 * the novel's structure lock (shared with import confirm), so positions are
 * read only after any concurrent import or reorder has committed.
 */
function withNovelStructureLock<T>(
  novelId: string,
  work: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await lockNovelStructure(tx, novelId);
    return work(tx);
  });
}

/**
 * Creates an act, chapter, or scene at the end of its sibling list.
 * Parent ownership is enforced through the novel.
 */
export async function createOutlineNode(
  userId: string,
  novelId: string,
  input: CreateOutlineNodeInput,
) {
  const novel = await loadNovel(userId, novelId);
  const now = nowTimestamp();
  const title = input.title?.trim() || DEFAULT_TITLES[input.kind];
  const kind = input.kind;

  if (kind === "act") {
    const act = await withNovelStructureLock(novel.id, async (tx) =>
      tx.orm.public.Act.create({
        id: crypto.randomUUID(),
        novelId: novel.id,
        title,
        position: input.position ?? (await computeNextPosition(tx, "act", novel.id)),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
    return { kind, node: act };
  }

  if (kind === "chapter") {
    if (!input.parentId) {
      throw new CodexError("Chapters require an act id", "VALIDATION_FAILED", 422);
    }
    const act = await db.orm.public.Act.where({ id: input.parentId }).first();
    if (!act || act.deletedAt !== null || act.novelId !== novel.id) {
      throw new CodexError("Act not found in this novel", "NOT_FOUND", 404);
    }
    const chapter = await withNovelStructureLock(novel.id, async (tx) =>
      tx.orm.public.Chapter.create({
        id: crypto.randomUUID(),
        actId: act.id,
        title,
        position: input.position ?? (await computeNextPosition(tx, "chapter", act.id)),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
    return { kind, node: chapter };
  }

  if (!input.parentId) {
    throw new CodexError("Scenes require a chapter id", "VALIDATION_FAILED", 422);
  }
  const chapter = await db.orm.public.Chapter.where({ id: input.parentId }).first();
  if (!chapter || chapter.deletedAt !== null) {
    throw new CodexError("Chapter not found", "NOT_FOUND", 404);
  }
  const act = await db.orm.public.Act.where({ id: chapter.actId }).first();
  if (!act || act.deletedAt !== null || act.novelId !== novel.id) {
    throw new CodexError("Chapter not found in this novel", "NOT_FOUND", 404);
  }
  const scene = await withNovelStructureLock(novel.id, async (tx) =>
    tx.orm.public.Scene.create({
      id: crypto.randomUUID(),
      chapterId: chapter.id,
      title,
      content: "",
      pov: "THIRD_LIMITED",
      tense: "PAST",
      position: input.position ?? (await computeNextPosition(tx, "scene", chapter.id)),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }),
  );
  return { kind, node: scene };
}

async function loadOutlineNode(
  userId: string,
  novelId: string,
  kind: OutlineKind,
  nodeId: string,
): Promise<{ id: string; title: string; position: number; parentId: string }> {
  const novel = await loadNovel(userId, novelId);

  if (kind === "act") {
    const act = await db.orm.public.Act.where({ id: nodeId }).first();
    if (!act || act.deletedAt !== null || act.novelId !== novel.id) {
      throw new CodexError("Act not found in this novel", "NOT_FOUND", 404);
    }
    return { id: act.id, title: act.title, position: act.position, parentId: act.novelId };
  }

  if (kind === "scene") {
    const scene = await db.orm.public.Scene.where({ id: nodeId }).first();
    if (!scene || scene.deletedAt !== null) {
      throw new CodexError("Scene not found", "NOT_FOUND", 404);
    }
    const chapter = await db.orm.public.Chapter.where({ id: scene.chapterId }).first();
    if (!chapter || chapter.deletedAt !== null) {
      throw new CodexError("Chapter not found for scene", "NOT_FOUND", 404);
    }
    const act = await db.orm.public.Act.where({ id: chapter.actId }).first();
    if (!act || act.deletedAt !== null || act.novelId !== novel.id) {
      throw new CodexError("Scene not found in this novel", "NOT_FOUND", 404);
    }
    return { id: scene.id, title: scene.title, position: scene.position, parentId: chapter.id };
  }

  const chapter = await db.orm.public.Chapter.where({ id: nodeId }).first();
  if (!chapter || chapter.deletedAt !== null) {
    throw new CodexError("Chapter not found", "NOT_FOUND", 404);
  }
  const act = await db.orm.public.Act.where({ id: chapter.actId }).first();
  if (!act || act.deletedAt !== null || act.novelId !== novel.id) {
    throw new CodexError("Chapter not found in this novel", "NOT_FOUND", 404);
  }
  return { id: chapter.id, title: chapter.title, position: chapter.position, parentId: act.id };
}

/** Updates a title/position row without union-typing the three tables. */
async function updateOutlineNodeRow(
  kind: OutlineKind,
  nodeId: string,
  data: Record<string, unknown>,
  orm: DbTransaction["orm"] = db.orm,
) {
  const now = nowTimestamp();
  const payload = { ...data, updatedAt: now };
  if (kind === "act") {
    await orm.public.Act.where({ id: nodeId }).update(payload);
  } else if (kind === "chapter") {
    await orm.public.Chapter.where({ id: nodeId }).update(payload);
  } else {
    await orm.public.Scene.where({ id: nodeId }).update(payload);
  }
}

/** Renames an outline node (title) after verifying it belongs to the novel. */
export async function renameOutlineNode(
  userId: string,
  novelId: string,
  input: RenameOutlineNodeInput,
) {
  const node = await loadOutlineNode(userId, novelId, input.kind, input.id);
  const title = input.title.trim();
  if (!title) {
    throw new CodexError("Title cannot be empty", "VALIDATION_FAILED", 422);
  }
  await updateOutlineNodeRow(input.kind, node.id, { title });
  return { id: node.id, kind: input.kind, title };
}

/** Swaps an outline node's position with its adjacent sibling. */
export async function moveOutlineNode(
  userId: string,
  novelId: string,
  input: MoveOutlineNodeInput,
) {
  const node = await loadOutlineNode(userId, novelId, input.kind, input.id);

  // Positions are read only after the lock, so a concurrent import or
  // reorder into the same novel has committed before we look.
  const moved = await withNovelStructureLock(novelId, async (tx) => {
    const siblings = await loadSiblings(tx, input.kind, node.parentId);
    siblings.sort(byPositionThenCreated);

    const index = siblings.findIndex((s) => s.id === node.id);
    if (index === -1) {
      throw new CodexError("Outline node not found", "NOT_FOUND", 404);
    }
    const targetIndex = input.direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= siblings.length) {
      return false;
    }

    const current = siblings[index];
    const neighbor = siblings[targetIndex];
    if (current.position !== neighbor.position) {
      await updateOutlineNodeRow(input.kind, current.id, { position: neighbor.position }, tx.orm);
      await updateOutlineNodeRow(input.kind, neighbor.id, { position: current.position }, tx.orm);
    } else {
      siblings[index] = neighbor;
      siblings[targetIndex] = current;
      for (let i = 0; i < siblings.length; i++) {
        await updateOutlineNodeRow(input.kind, siblings[i].id, { position: i }, tx.orm);
      }
    }
    return true;
  });
  return moved
    ? { id: node.id, kind: input.kind, moved: true as const }
    : { id: node.id, kind: input.kind, moved: false as const };
}

/** Soft-deletes an outline node and, for acts/chapters, its descendants. */
export async function deleteOutlineNode(
  userId: string,
  novelId: string,
  kind: OutlineKind,
  nodeId: string,
) {
  const node = await loadOutlineNode(userId, novelId, kind, nodeId);
  const now = nowTimestamp();

  if (kind === "scene") {
    await db.orm.public.Scene.where({ id: node.id }).update({ deletedAt: now, updatedAt: now });
    return { id: node.id, kind, deleted: true as const };
  }

  if (kind === "chapter") {
    const scenes = await db.orm.public.Scene.where((s) => s.chapterId.eq(node.id))
      .where((s) => s.deletedAt.isNull())
      .all();
    for (const scene of scenes) {
      await db.orm.public.Scene.where({ id: scene.id }).update({
        deletedAt: now,
        updatedAt: now,
      });
    }
    await db.orm.public.Chapter.where({ id: node.id }).update({
      deletedAt: now,
      updatedAt: now,
    });
    return { id: node.id, kind, deleted: true as const };
  }

  // Act: cascade soft-delete to chapters and their scenes.
  const chapters = await db.orm.public.Chapter.where((c) => c.actId.eq(node.id))
    .where((c) => c.deletedAt.isNull())
    .all();
  for (const chapter of chapters) {
    const scenes = await db.orm.public.Scene.where((s) => s.chapterId.eq(chapter.id))
      .where((s) => s.deletedAt.isNull())
      .all();
    for (const scene of scenes) {
      await db.orm.public.Scene.where({ id: scene.id }).update({
        deletedAt: now,
        updatedAt: now,
      });
    }
    await db.orm.public.Chapter.where({ id: chapter.id }).update({
      deletedAt: now,
      updatedAt: now,
    });
  }
  await db.orm.public.Act.where({ id: node.id }).update({ deletedAt: now, updatedAt: now });
  return { id: node.id, kind, deleted: true as const };
}

// ─── Scene editor ────────────────────────────────────────────────────────────

export interface EditorScene {
  id: string;
  title: string;
  content: string;
  summary: string | null;
  label: string | null;
  pov: PovValue;
  tense: TenseValue;
  excludeFromAi: boolean;
  wordCount: number;
  updatedAt: string;
  chapterId: string;
  chapterTitle: string;
  actTitle: string;
  novelId: string;
  novelTitle: string;
}

/** Loads a scene with breadcrumb context for the editor surface. */
export async function getSceneForEditor(userId: string, sceneId: string): Promise<EditorScene> {
  const { scene, chapter, act, novel } = await assertSceneAccess(userId, sceneId);
  return {
    id: scene.id,
    title: scene.title,
    content: scene.content,
    summary: scene.summary,
    label: scene.label,
    pov: scene.pov,
    tense: scene.tense,
    excludeFromAi: scene.excludeFromAi,
    wordCount: scene.wordCount,
    updatedAt: toIsoString(scene.updatedAt),
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    actTitle: act.title,
    novelId: novel.id,
    novelTitle: novel.title,
  };
}

export interface UpdateSceneInput {
  title?: string;
  summary?: string | null;
  content?: string;
  pov?: PovValue;
  tense?: TenseValue;
  excludeFromAi?: boolean;
  label?: string | null;
}

/**
 * Updates scene content/metadata. `word_count` is recomputed server-side
 * whenever content changes so the outliner rollups stay authoritative.
 */
export async function updateScene(userId: string, sceneId: string, input: UpdateSceneInput) {
  const { scene } = await assertSceneAccess(userId, sceneId);

  const updateData: Record<string, unknown> = { updatedAt: nowTimestamp() };

  if (input.title !== undefined) {
    const title = input.title.trim();
    if (!title) {
      throw new CodexError("Scene title cannot be empty", "VALIDATION_FAILED", 422);
    }
    updateData.title = title;
  }
  if (input.summary !== undefined) updateData.summary = input.summary;
  if (input.label !== undefined) updateData.label = input.label;
  if (input.content !== undefined) {
    if (typeof input.content !== "string") {
      throw new CodexError("Scene content must be a string", "VALIDATION_FAILED", 422);
    }
    updateData.content = input.content;
    updateData.wordCount = countWords(input.content);
  }
  if (input.pov !== undefined) {
    if (!isPovValue(input.pov)) {
      throw new CodexError("Invalid POV value", "VALIDATION_FAILED", 422);
    }
    updateData.pov = input.pov;
  }
  if (input.tense !== undefined) {
    if (!isTenseValue(input.tense)) {
      throw new CodexError("Invalid tense value", "VALIDATION_FAILED", 422);
    }
    updateData.tense = input.tense;
  }
  if (input.excludeFromAi !== undefined) updateData.excludeFromAi = input.excludeFromAi;

  await db.orm.public.Scene.where({ id: scene.id }).update(updateData);
  return getSceneForEditor(userId, sceneId);
}
