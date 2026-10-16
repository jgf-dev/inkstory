import { Temporal } from "temporal-polyfill";
import { db } from "@/lib/prisma";
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
}

/**
 * Writes an already-parsed manuscript into a novel the user owns. Imported
 * acts are appended after the novel's existing acts. If a write fails, the
 * acts created so far are removed (chapters and scenes cascade).
 */
export async function importManuscript(
  userId: string,
  novelId: string,
  manuscript: ImportManuscript,
): Promise<ImportResult> {
  await assertNovelOwner(userId, novelId);
  const preview = previewManuscript(manuscript);
  if (!preview.totals.scenes) {
    throw new ImportError("No content was found to import", "VALIDATION_FAILED", 400);
  }

  const existing = await db.orm.public.Act.where((a) => a.novelId.eq(novelId))
    .where((a) => a.deletedAt.isNull())
    .all();
  const start = existing.reduce((max, a) => Math.max(max, a.position + 1), 0);
  const now = nowTimestamp();
  const actIds: string[] = [];

  try {
    for (const [ai, act] of manuscript.acts.entries()) {
      const actId = crypto.randomUUID();
      await db.orm.public.Act.create({
        id: actId,
        novelId,
        title: act.title,
        position: start + ai,
        createdAt: now,
        updatedAt: now,
      });
      actIds.push(actId);
      for (const [ci, chapter] of act.chapters.entries()) {
        const chapterId = crypto.randomUUID();
        await db.orm.public.Chapter.create({
          id: chapterId,
          actId,
          title: chapter.title,
          position: ci,
          createdAt: now,
          updatedAt: now,
        });
        for (const [si, scene] of chapter.scenes.entries()) {
          await db.orm.public.Scene.create({
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
  } catch (err) {
    for (const id of actIds) {
      await db.orm.public.Act.where({ id }).delete();
    }
    throw err;
  }
  return { preview, actIds };
}
