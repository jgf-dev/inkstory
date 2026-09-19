import { describe, expect, it } from "vite-plus/test";
import {
  ProgressionEngine,
  type ProgressionCandidate,
  type SceneReadingOrderKey,
} from "../src/lib/codex/progression-engine";

function scene(
  sceneId: string,
  actPosition: number,
  chapterPosition: number,
  scenePosition: number,
): SceneReadingOrderKey {
  return { sceneId, actPosition, chapterPosition, scenePosition };
}

function progression(
  partial: Partial<ProgressionCandidate> &
    Pick<ProgressionCandidate, "id" | "sceneId" | "mode" | "description">,
): ProgressionCandidate {
  return {
    position: 0,
    ...partial,
  };
}

describe("ProgressionEngine (STO-1153)", () => {
  const s1 = scene("scene-1", 0, 0, 0);
  const s2 = scene("scene-2", 0, 0, 1);
  const s3 = scene("scene-3", 0, 1, 0); // later chapter
  const s4 = scene("scene-4", 1, 0, 0); // later act

  const sceneOrderById = new Map<string, SceneReadingOrderKey>([
    [s1.sceneId, s1],
    [s2.sceneId, s2],
    [s3.sceneId, s3],
    [s4.sceneId, s4],
  ]);

  describe("reading order comparison", () => {
    it("orders by act, then chapter, then scene position", () => {
      expect(ProgressionEngine.compareReadingOrder(s1, s2)).toBeLessThan(0);
      expect(ProgressionEngine.compareReadingOrder(s2, s3)).toBeLessThan(0);
      expect(ProgressionEngine.compareReadingOrder(s3, s4)).toBeLessThan(0);
      expect(ProgressionEngine.compareReadingOrder(s1, s1)).toBe(0);
      expect(ProgressionEngine.isAtOrBefore(s2, s3)).toBe(true);
      expect(ProgressionEngine.isAtOrBefore(s4, s2)).toBe(false);
    });
  });

  describe("temporal filtering for Scene N", () => {
    const progressions: ProgressionCandidate[] = [
      progression({
        id: "p-s1",
        sceneId: "scene-1",
        mode: "ADDITION",
        description: "From scene 1",
      }),
      progression({
        id: "p-s2",
        sceneId: "scene-2",
        mode: "ADDITION",
        description: "From scene 2",
      }),
      progression({
        id: "p-s3",
        sceneId: "scene-3",
        mode: "ADDITION",
        description: "From scene 3",
      }),
      progression({
        id: "p-s4",
        sceneId: "scene-4",
        mode: "REPLACEMENT",
        description: "From scene 4",
      }),
    ];

    it("at scene 1 includes only progressions from scenes <= scene 1", () => {
      const result = ProgressionEngine.resolveAtScene({
        baseDescription: "Base",
        currentScene: s1,
        sceneOrderById,
        progressions,
      });

      expect(result.appliedProgressionIds).toEqual(["p-s1"]);
      expect(result.description).toBe("Base\nFrom scene 1");
    });

    it("at scene 2 includes scenes 1-2 and excludes later scenes", () => {
      const result = ProgressionEngine.resolveAtScene({
        baseDescription: "Base",
        currentScene: s2,
        sceneOrderById,
        progressions,
      });

      expect(result.appliedProgressionIds).toEqual(["p-s1", "p-s2"]);
      expect(result.description).toBe("Base\nFrom scene 1\nFrom scene 2");
      expect(result.appliedProgressionIds).not.toContain("p-s3");
      expect(result.appliedProgressionIds).not.toContain("p-s4");
    });

    it("excludes progressions from later scenes even when listed first", () => {
      const shuffled = [progressions[3], progressions[2], progressions[0], progressions[1]];
      const filtered = ProgressionEngine.filterAndSortForScene(s2, sceneOrderById, shuffled);
      expect(filtered.map((p) => p.id)).toEqual(["p-s1", "p-s2"]);
    });

    it("skips progressions whose scene is missing from the reading-order map", () => {
      const withOrphan = [
        ...progressions,
        progression({
          id: "p-orphan",
          sceneId: "scene-deleted",
          mode: "ADDITION",
          description: "Orphan",
        }),
      ];
      const filtered = ProgressionEngine.filterAndSortForScene(s4, sceneOrderById, withOrphan);
      expect(filtered.map((p) => p.id)).not.toContain("p-orphan");
    });
  });

  describe("addition vs replacement modes", () => {
    it("ADDITION appends to the base description", () => {
      const result = ProgressionEngine.applyProgressions("Base bio", [
        progression({
          id: "a1",
          sceneId: "scene-1",
          mode: "ADDITION",
          description: "Learned swordcraft",
        }),
      ]);
      expect(result.description).toBe("Base bio\nLearned swordcraft");
    });

    it("REPLACEMENT replaces the base description", () => {
      const result = ProgressionEngine.applyProgressions("Base bio", [
        progression({
          id: "r1",
          sceneId: "scene-1",
          mode: "REPLACEMENT",
          description: "Now a wanted fugitive",
        }),
      ]);
      expect(result.description).toBe("Now a wanted fugitive");
    });

    it("replacement after additions discards prior text; later additions append again", () => {
      const result = ProgressionEngine.resolveAtScene({
        baseDescription: "Quiet archivist",
        currentScene: s3,
        sceneOrderById,
        progressions: [
          progression({
            id: "p1",
            sceneId: "scene-1",
            mode: "ADDITION",
            description: "Found the quill",
          }),
          progression({
            id: "p2",
            sceneId: "scene-2",
            mode: "REPLACEMENT",
            description: "Glass Weaver in exile",
          }),
          progression({
            id: "p3",
            sceneId: "scene-3",
            mode: "ADDITION",
            description: "Allied with Corvus",
          }),
        ],
      });

      expect(result.appliedProgressionIds).toEqual(["p1", "p2", "p3"]);
      expect(result.description).toBe("Glass Weaver in exile\nAllied with Corvus");
    });
  });

  describe("multiple progressions chronological order", () => {
    it("applies same-scene progressions by position ascending", () => {
      const result = ProgressionEngine.resolveAtScene({
        baseDescription: "Base",
        currentScene: s1,
        sceneOrderById,
        progressions: [
          progression({
            id: "late",
            sceneId: "scene-1",
            mode: "ADDITION",
            description: "Second",
            position: 2,
          }),
          progression({
            id: "early",
            sceneId: "scene-1",
            mode: "ADDITION",
            description: "First",
            position: 0,
          }),
          progression({
            id: "mid",
            sceneId: "scene-1",
            mode: "ADDITION",
            description: "Middle",
            position: 1,
          }),
        ],
      });

      expect(result.appliedProgressionIds).toEqual(["early", "mid", "late"]);
      expect(result.description).toBe("Base\nFirst\nMiddle\nSecond");
    });

    it("orders across scenes by reading order before position", () => {
      const result = ProgressionEngine.resolveAtScene({
        baseDescription: "",
        currentScene: s3,
        sceneOrderById,
        progressions: [
          progression({
            id: "c",
            sceneId: "scene-3",
            mode: "ADDITION",
            description: "C",
            position: 0,
          }),
          progression({
            id: "a",
            sceneId: "scene-1",
            mode: "ADDITION",
            description: "A",
            position: 99,
          }),
          progression({
            id: "b",
            sceneId: "scene-2",
            mode: "ADDITION",
            description: "B",
            position: 0,
          }),
        ],
      });

      expect(result.appliedProgressionIds).toEqual(["a", "b", "c"]);
      expect(result.description).toBe("A\nB\nC");
    });

    it("uses stable id tie-break when position is equal", () => {
      const filtered = ProgressionEngine.filterAndSortForScene(s1, sceneOrderById, [
        progression({
          id: "z-id",
          sceneId: "scene-1",
          mode: "ADDITION",
          description: "Z",
          position: 0,
        }),
        progression({
          id: "a-id",
          sceneId: "scene-1",
          mode: "ADDITION",
          description: "A",
          position: 0,
        }),
      ]);
      expect(filtered.map((p) => p.id)).toEqual(["a-id", "z-id"]);
    });
  });
  describe("buildSceneOrderMap", () => {
    it("indexes rows by sceneId", () => {
      const map = ProgressionEngine.buildSceneOrderMap([s1, s2, s3]);
      expect(map.size).toBe(3);
      expect(map.get("scene-1")).toEqual(s1);
      expect(map.get("scene-2")).toEqual(s2);
      expect(map.get("missing")).toBeUndefined();
    });
  });

});