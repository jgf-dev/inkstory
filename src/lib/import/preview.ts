import type { ImportManuscript, ImportPreview } from "./types";

/** Structure and word-count summary shown before the user confirms an import. */
export function previewManuscript(manuscript: ImportManuscript): ImportPreview {
  const totals = { acts: 0, chapters: 0, scenes: 0, words: 0, summaries: 0 };
  const warnings: string[] = [];

  const acts = manuscript.acts.map((act) => {
    totals.acts++;
    const chapters = act.chapters.map((chapter) => {
      totals.chapters++;
      const scenes = chapter.scenes.map((scene) => {
        totals.scenes++;
        totals.words += scene.wordCount;
        if (scene.summary) totals.summaries++;
        if (!scene.content && !scene.summary) {
          warnings.push(`Scene "${scene.title}" in "${chapter.title}" is empty.`);
        }
        return { title: scene.title, wordCount: scene.wordCount, hasSummary: !!scene.summary };
      });
      if (!scenes.length) warnings.push(`Chapter "${chapter.title}" has no scenes.`);
      return {
        title: chapter.title,
        wordCount: scenes.reduce((n, s) => n + s.wordCount, 0),
        scenes,
      };
    });
    if (!chapters.length) warnings.push(`Act "${act.title}" has no chapters.`);
    return { title: act.title, wordCount: chapters.reduce((n, c) => n + c.wordCount, 0), chapters };
  });

  if (!totals.scenes) warnings.push("No content was found to import.");
  return { title: manuscript.title, subtitle: manuscript.subtitle, totals, acts, warnings };
}
