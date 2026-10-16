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
 * acts are appended after the novel's existing acts, all inside one
 * transaction.
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

  const now = nowTimestamp();

  // One transaction: a failure part-way leaves nothing behind.
  const actIds = await db.transaction(async (tx) => {
    // Serialise imports into the same novel: the lock is held until the
    // transaction ends, so the next act position is read only after any
    // concurrent import has committed. Must stay the first statement.
    await tx.execute(
      db.raw.sql`SELECT pg_advisory_xact_lock(hashtext(${`novel-import:${novelId}`}))`
        .affectedCount()
        .build(),
    );
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
    return ids;
  });
  return { preview, actIds };
}
