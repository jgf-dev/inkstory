import type { NovelOutline, OutlineKind } from "./service";

/**
 * True when `sceneId` is the deleted node itself or sits under the deleted
 * act/chapter, so deleting that node must close the open editor.
 */
export function isSceneUnderNode(
  outline: NovelOutline,
  kind: OutlineKind,
  nodeId: string,
  sceneId: string,
): boolean {
  if (kind === "scene") return nodeId === sceneId;
  for (const act of outline.acts) {
    for (const chapter of act.chapters) {
      if (!chapter.scenes.some((s) => s.id === sceneId)) continue;
      return kind === "act" ? act.id === nodeId : chapter.id === nodeId;
    }
  }
  return false;
}
