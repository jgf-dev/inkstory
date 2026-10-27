import type { ExportNovel, ExportOptions } from "./types";

/**
 * Applies the act/chapter/scene selection. An empty selection keeps
 * everything. Acts and chapters left with no scenes are dropped.
 */
export function selectExportTree(
  novel: ExportNovel,
  options: Pick<ExportOptions, "actIds" | "chapterIds" | "sceneIds">,
): ExportNovel {
  const acts = new Set(options.actIds);
  const chapters = new Set(options.chapterIds);
  const scenes = new Set(options.sceneIds);
  if (acts.size === 0 && chapters.size === 0 && scenes.size === 0) return novel;

  return {
    ...novel,
    acts: novel.acts
      .map((act) => ({
        ...act,
        chapters: act.chapters
          .map((chapter) => ({
            ...chapter,
            scenes: chapter.scenes.filter(
              (s) => acts.has(act.id) || chapters.has(chapter.id) || scenes.has(s.id),
            ),
          }))
          .filter((c) => c.scenes.length > 0),
      }))
      .filter((a) => a.chapters.length > 0),
  };
}
