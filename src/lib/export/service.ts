import { db } from "@/lib/prisma";
import { byPositionThenCreated } from "@/lib/writing/service";
import { renderDocx } from "./docx";
import { renderMarkdown } from "./markdown";
import { selectExportTree } from "./select";
import {
  ExportError,
  type ExportChapter,
  type ExportNovel,
  type ExportOptions,
  type ExportScene,
} from "./types";

/** Loads the non-deleted act → chapter → scene tree for a novel the user owns. */
export async function loadNovelForExport(userId: string, novelId: string): Promise<ExportNovel> {
  const novel = await db.orm.public.Novel.where({ id: novelId }).first();
  // Another user's novel is reported as missing so its existence is not revealed.
  if (!novel || novel.deletedAt !== null || novel.ownerId !== userId) {
    throw new ExportError("Novel not found", "NOT_FOUND", 404);
  }

  const acts = await db.orm.public.Act.where((a) => a.novelId.eq(novelId))
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

  const scenesByChapter = new Map<string, ExportScene[]>();
  for (const scene of scenes) {
    const list = scenesByChapter.get(scene.chapterId) ?? [];
    list.push({
      id: scene.id,
      title: scene.title,
      subtitle: scene.subtitle,
      content: scene.content,
      summary: scene.summary,
    });
    scenesByChapter.set(scene.chapterId, list);
  }

  const chaptersByAct = new Map<string, ExportChapter[]>();
  for (const chapter of chapters) {
    const list = chaptersByAct.get(chapter.actId) ?? [];
    list.push({
      id: chapter.id,
      title: chapter.title,
      scenes: scenesByChapter.get(chapter.id) ?? [],
    });
    chaptersByAct.set(chapter.actId, list);
  }

  return {
    id: novel.id,
    title: novel.title,
    subtitle: novel.subtitle,
    acts: acts.map((act) => ({
      id: act.id,
      title: act.title,
      chapters: chaptersByAct.get(act.id) ?? [],
    })),
  };
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
