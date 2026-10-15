import { db } from "@/lib/prisma";
import { renderDocx } from "./docx";
import { renderMarkdown } from "./markdown";
import { selectExportTree } from "./select";
import { ExportError, type ExportNovel, type ExportOptions } from "./types";

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

/** Loads the non-deleted act → chapter → scene tree for a novel the user owns. */
export async function loadNovelForExport(userId: string, novelId: string): Promise<ExportNovel> {
  const novel = await db.orm.public.Novel.where({ id: novelId }).first();
  if (!novel || novel.deletedAt !== null) {
    throw new ExportError("Novel not found", "NOT_FOUND", 404);
  }
  if (novel.ownerId !== userId) {
    throw new ExportError("You do not have permission to export this novel", "FORBIDDEN", 403);
  }

  const acts = await db.orm.public.Act.where((a) => a.novelId.eq(novelId))
    .where((a) => a.deletedAt.isNull())
    .all();

  const result: ExportNovel = {
    id: novel.id,
    title: novel.title,
    subtitle: novel.subtitle,
    acts: [],
  };

  for (const act of [...acts].sort(byPosition)) {
    const chapters = await db.orm.public.Chapter.where((c) => c.actId.eq(act.id))
      .where((c) => c.deletedAt.isNull())
      .all();
    const exportAct: ExportNovel["acts"][number] = { id: act.id, title: act.title, chapters: [] };
    for (const chapter of [...chapters].sort(byPosition)) {
      const scenes = await db.orm.public.Scene.where((s) => s.chapterId.eq(chapter.id))
        .where((s) => s.deletedAt.isNull())
        .all();
      exportAct.chapters.push({
        id: chapter.id,
        title: chapter.title,
        scenes: [...scenes].sort(byPosition).map((s) => ({
          id: s.id,
          title: s.title,
          subtitle: s.subtitle,
          content: s.content,
          summary: s.summary,
        })),
      });
    }
    result.acts.push(exportAct);
  }
  return result;
}

export interface ExportFile {
  filename: string;
  contentType: string;
  body: string | Buffer;
}

export function exportFilename(title: string, format: ExportOptions["format"]): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .toLowerCase();
  return `${slug || "manuscript"}.${format}`;
}

/** Selects and renders a novel already loaded into memory. */
export async function renderExport(
  novel: ExportNovel,
  options: ExportOptions,
): Promise<ExportFile> {
  const selected = selectExportTree(novel, options);
  const filename = exportFilename(novel.title, options.format);
  if (options.format === "docx") {
    return {
      filename,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      body: await renderDocx(selected, options),
    };
  }
  return {
    filename,
    contentType: "text/markdown; charset=utf-8",
    body: renderMarkdown(selected, options),
  };
}

/** Ownership-checked export of a novel. */
export async function exportNovel(
  userId: string,
  novelId: string,
  options: ExportOptions,
): Promise<ExportFile> {
  return renderExport(await loadNovelForExport(userId, novelId), options);
}
