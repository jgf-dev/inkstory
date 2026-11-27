import type { NovelOutline, OutlineScene } from "./service";

/** A scene card in the planning grid, numbered in novel reading order. */
export interface PlanningGridScene extends OutlineScene {
  /** 1-based reading-order number across the whole novel. */
  number: number;
  /** 0-based index among its chapter's scenes (for sibling reorder). */
  siblingIndex: number;
}

/** One chapter column of the planning grid. */
export interface PlanningGridChapter {
  id: string;
  title: string;
  siblingIndex: number;
  siblingCount: number;
  wordCount: number;
  scenes: PlanningGridScene[];
}

/** One act band of the planning grid (a row of chapter columns). */
export interface PlanningGridAct {
  id: string;
  title: string;
  wordCount: number;
  sceneCount: number;
  chapters: PlanningGridChapter[];
}

/**
 * Builds the Grid planning view model (STO-1257): acts as bands, chapters as
 * columns, scenes as cards numbered in reading order with word-count rollups.
 * Pure so the layout math can be tested without rendering.
 */
export function buildPlanningGrid(outline: NovelOutline): PlanningGridAct[] {
  let number = 0;
  return outline.acts.map((act) => {
    let actWords = 0;
    let actScenes = 0;
    const chapters = act.chapters.map((chapter, chapterIndex) => {
      let chapterWords = 0;
      const scenes = chapter.scenes.map((scene, sceneIndex) => {
        number += 1;
        chapterWords += scene.wordCount;
        return { ...scene, number, siblingIndex: sceneIndex };
      });
      actWords += chapterWords;
      actScenes += scenes.length;
      return {
        id: chapter.id,
        title: chapter.title,
        siblingIndex: chapterIndex,
        siblingCount: act.chapters.length,
        wordCount: chapterWords,
        scenes,
      };
    });
    return {
      id: act.id,
      title: act.title,
      wordCount: actWords,
      sceneCount: actScenes,
      chapters,
    };
  });
}
