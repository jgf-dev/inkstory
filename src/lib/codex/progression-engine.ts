/**
 * Pure progressions engine (STO-1153).
 *
 * Applies scene-linked CodexProgression rows onto a base entry description
 * using reading-order temporal filtering and ADDITION / REPLACEMENT modes.
 *
 * Reading order is Act.position -> Chapter.position -> Scene.position.
 * Within the same scene, progressions are ordered by `position`, then `id`
 * for a stable chronological tie-break.
 */

export type ProgressionMode = "ADDITION" | "REPLACEMENT";

/** Hierarchy positions that define a scene's place in novel reading order. */
export interface SceneReadingOrderKey {
  sceneId: string;
  actPosition: number;
  chapterPosition: number;
  scenePosition: number;
}

/** Minimal progression shape the engine needs (DB-agnostic). */
export interface ProgressionCandidate {
  id: string;
  sceneId: string;
  mode: ProgressionMode;
  description: string;
  /** Ordering among progressions attached to the same scene. */
  position: number;
}

export interface ApplyProgressionsResult {
  /** Description after temporal filter + mode application. */
  description: string;
  /** IDs of progressions that were applied, in application order. */
  appliedProgressionIds: string[];
}

export interface ResolveAtSceneInput {
  baseDescription: string;
  currentScene: SceneReadingOrderKey;
  sceneOrderById: ReadonlyMap<string, SceneReadingOrderKey>;
  progressions: readonly ProgressionCandidate[];
}

/**
 * Scene-linked progression engine.
 *
 * Prefer these static methods over ad-hoc helpers so temporal rules stay in
 * one place and remain easy to unit-test without a database.
 */
export class ProgressionEngine {
  /**
   * Compare two scenes in novel reading order.
   * Returns negative if `a` comes before `b`, 0 if equal, positive if after.
   */
  static compareReadingOrder(a: SceneReadingOrderKey, b: SceneReadingOrderKey): number {
    if (a.actPosition !== b.actPosition) {
      return a.actPosition - b.actPosition;
    }
    if (a.chapterPosition !== b.chapterPosition) {
      return a.chapterPosition - b.chapterPosition;
    }
    if (a.scenePosition !== b.scenePosition) {
      return a.scenePosition - b.scenePosition;
    }
    return a.sceneId.localeCompare(b.sceneId);
  }

  /** True when `candidate` is at or before `current` in reading order. */
  static isAtOrBefore(candidate: SceneReadingOrderKey, current: SceneReadingOrderKey): boolean {
    return ProgressionEngine.compareReadingOrder(candidate, current) <= 0;
  }

  /**
   * Filter progressions whose scene is <= the current scene in reading order,
   * then sort them chronologically for application.
   *
   * Progressions whose `sceneId` is missing from `sceneOrderById` are skipped
   * (orphaned / soft-deleted scene context).
   */
  static filterAndSortForScene(
    currentScene: SceneReadingOrderKey,
    sceneOrderById: ReadonlyMap<string, SceneReadingOrderKey>,
    progressions: readonly ProgressionCandidate[],
  ): ProgressionCandidate[] {
    const eligible: Array<{
      progression: ProgressionCandidate;
      sceneOrder: SceneReadingOrderKey;
    }> = [];

    for (const progression of progressions) {
      const sceneOrder = sceneOrderById.get(progression.sceneId);
      if (!sceneOrder) {
        continue;
      }
      if (!ProgressionEngine.isAtOrBefore(sceneOrder, currentScene)) {
        continue;
      }
      eligible.push({ progression, sceneOrder });
    }

    eligible.sort((left, right) => {
      const byScene = ProgressionEngine.compareReadingOrder(left.sceneOrder, right.sceneOrder);
      if (byScene !== 0) {
        return byScene;
      }
      if (left.progression.position !== right.progression.position) {
        return left.progression.position - right.progression.position;
      }
      return left.progression.id.localeCompare(right.progression.id);
    });

    return eligible.map((item) => item.progression);
  }

  /**
   * Apply ordered progressions onto a base description.
   * - ADDITION: appends progression description (newline-separated when base is non-empty)
   * - REPLACEMENT: replaces the entire description with the progression description
   */
  static applyProgressions(
    baseDescription: string,
    progressions: readonly ProgressionCandidate[],
  ): ApplyProgressionsResult {
    let description = baseDescription ?? "";
    const appliedProgressionIds: string[] = [];

    for (const progression of progressions) {
      const fragment = progression.description ?? "";
      if (progression.mode === "REPLACEMENT") {
        description = fragment;
      } else if (!description) {
        description = fragment;
      } else if (fragment) {
        description = `${description}\n${fragment}`;
      }
      appliedProgressionIds.push(progression.id);
    }

    return { description, appliedProgressionIds };
  }

  /**
   * Resolve the effective description for an entry at a given scene:
   * temporal filter -> chronological sort -> mode application.
   */
  static resolveAtScene(input: ResolveAtSceneInput): ApplyProgressionsResult {
    const ordered = ProgressionEngine.filterAndSortForScene(
      input.currentScene,
      input.sceneOrderById,
      input.progressions,
    );
    return ProgressionEngine.applyProgressions(input.baseDescription, ordered);
  }

  /**
   * Build a sceneId -> reading-order key map from flattened hierarchy rows
   * (Act -> Chapter -> Scene positions). Used by the service layer after DB load.
   */
  static buildSceneOrderMap(
    rows: readonly SceneReadingOrderKey[],
  ): Map<string, SceneReadingOrderKey> {
    const map = new Map<string, SceneReadingOrderKey>();
    for (const row of rows) {
      map.set(row.sceneId, row);
    }
    return map;
  }
}
