import { Temporal } from "temporal-polyfill";
import { db } from "@/lib/prisma";
import { lockNovelStructure } from "@/lib/writing/novel-lock";
import { previewManuscript } from "./preview";
import { ImportError, type ImportManuscript, type ImportPreview } from "./types";

const nowTimestamp = () => Temporal.Now.plainDateTimeISO();

/** Throws 404 unless the user owns the (non-deleted) novel. */
export async function assertNovelOwner(userId: string, novelId: string): Promise<void> {
  const novel = await db.orm.public.Novel.where({ id: novelId }).first();
  // Another user's novel is reported as missing so its existence is not revealed.
  if (!novel || novel.deletedAt !== null || novel.ownerId !== userId) {
    throw new ImportError("Novel not found", "NOT_FOUND", 404);
  }
}

export interface ImportResult {
  preview: ImportPreview;
  actIds: string[];
  /** Whether the detected title/subtitle were written to the book (STO-1213). */
  titleApplied: boolean;
}

export interface ImportWriteOptions {
  /**
   * Apply the manuscript's detected title and subtitle to the book. Only
   * detected (non-empty) values are written; the rest of the book is kept.
   */
  applyTitle?: boolean;
}

/** Book fields to update from the manuscript, or null when nothing applies. */
export function detectedTitleUpdate(
  manuscript: Pick<ImportManuscript, "title" | "subtitle">,
): { title?: string; subtitle?: string } | null {
  const title = manuscript.title?.trim();
  const subtitle = manuscript.subtitle?.trim();
  if (!title && !subtitle) return null;
  return { ...(title ? { title } : {}), ...(subtitle ? { subtitle } : {}) };
}

/**
 * Writes an already-parsed manuscript into a novel the user owns. Imported
 * acts are appended after the novel's existing acts, all inside one
 * transaction. With `applyTitle`, the detected title and subtitle are written
 * to the book in the same transaction.
 */
export async function importManuscript(
  userId: string,
  novelId: string,
  manuscript: ImportManuscript,
  options: ImportWriteOptions = {},
): Promise<ImportResult> {
  await assertNovelOwner(userId, novelId);
  const preview = previewManuscript(manuscript);
  if (!preview.totals.scenes) {
    throw new ImportError("No content was found to import", "VALIDATION_FAILED", 400);
  }

  const now = nowTimestamp();
  const titleUpdate = options.applyTitle ? detectedTitleUpdate(manuscript) : null;

  // One transaction: a failure part-way leaves nothing behind.
  const actIds = await db.transaction(async (tx) => {
    // Serialise imports and manual outline edits into the same novel: the
    // lock is held until the transaction ends, so the next act position is
    // read only after any concurrent writer has committed. Must stay the
    // first statement.
    await lockNovelStructure(tx, novelId);
    const existing = await tx.orm.public.Act.where((a) => a.novelId.eq(novelId))
      .where((a) => a.deletedAt.isNull())
      .all();
    const start = existing.reduce((max, a) => Math.max(max, a.position + 1), 0);
    const ids: string[] = [];
    for (const [ai, act] of manuscript.acts.entries()) {
      const actId = crypto.randomUUID();
      await tx.orm.public.Act.create({
        id: actId,
        novelId,
        title: act.title,
        position: start + ai,
        createdAt: now,
        updatedAt: now,
      });
      ids.push(actId);
      for (const [ci, chapter] of act.chapters.entries()) {
        const chapterId = crypto.randomUUID();
        await tx.orm.public.Chapter.create({
          id: chapterId,
          actId,
          title: chapter.title,
          position: ci,
          createdAt: now,
          updatedAt: now,
        });
        for (const [si, scene] of chapter.scenes.entries()) {
          await tx.orm.public.Scene.create({
            id: crypto.randomUUID(),
            chapterId,
            title: scene.title,
            subtitle: scene.subtitle,
            summary: scene.summary,
            content: scene.content,
            wordCount: scene.wordCount,
            position: si,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }
    if (titleUpdate) {
      await tx.orm.public.Novel.where({ id: novelId }).update({ ...titleUpdate, updatedAt: now });
    }
    return ids;
  });
  return { preview, actIds, titleApplied: titleUpdate !== null };
}
