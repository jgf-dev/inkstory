import type { NovelOutline } from "./service";

/** A scene's coordinate in novel reading order (Act → Chapter → Scene). */
export interface SceneCoordinate {
  sceneId: string;
  /** Flat reading-order index across the whole novel (0-based). */
  index: number;
  actTitle: string;
  chapterTitle: string;
  sceneTitle: string;
  /** "Act I → Chapter One → The Quay" */
  label: string;
}

/**
 * Flattens a novel outline into scene coordinates in reading order. Used by
 * the Progression Timeline Drawer to anchor progression cards at plot
 * coordinates (JGF-128 scope item 4).
 */
export function flattenScenesInReadingOrder(outline: NovelOutline): SceneCoordinate[] {
  const coordinates: SceneCoordinate[] = [];
  for (const act of outline.acts) {
    for (const chapter of act.chapters) {
      for (const scene of chapter.scenes) {
        coordinates.push({
          sceneId: scene.id,
          index: coordinates.length,
          actTitle: act.title,
          chapterTitle: chapter.title,
          sceneTitle: scene.title,
          label: `${act.title} → ${chapter.title} → ${scene.title}`,
        });
      }
    }
  }
  return coordinates;
}
