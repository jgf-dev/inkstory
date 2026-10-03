import { describe, expect, it } from "vite-plus/test";
import { RelationEngine, type RelationEdge } from "../src/lib/codex/relation-engine";

function edge(
  partial: Partial<RelationEdge> &
    Pick<RelationEdge, "id" | "sourceEntryId" | "targetEntryId" | "relationType">,
): RelationEdge {
  return {
    reverseType: null,
    description: null,
    ...partial,
  };
}

describe("RelationEngine (STO-1154)", () => {
  describe("buildAdjacency", () => {
    const edges: RelationEdge[] = [
      edge({
        id: "r1",
        sourceEntryId: "a",
        targetEntryId: "b",
        relationType: "ALLY_OF",
      }),
      edge({
        id: "r2",
        sourceEntryId: "b",
        targetEntryId: "c",
        relationType: "LOCATED_IN",
      }),
    ];

    it("maps outgoing neighbors only", () => {
      const adj = RelationEngine.buildAdjacency(edges, "outgoing");
      expect(adj.get("a")?.map((h) => h.neighborId)).toEqual(["b"]);
      expect(adj.get("b")?.map((h) => h.neighborId)).toEqual(["c"]);
      expect(adj.get("c")).toBeUndefined();
    });

    it("maps incoming neighbors only", () => {
      const adj = RelationEngine.buildAdjacency(edges, "incoming");
      expect(adj.get("b")?.map((h) => h.neighborId)).toEqual(["a"]);
      expect(adj.get("c")?.map((h) => h.neighborId)).toEqual(["b"]);
      expect(adj.get("a")).toBeUndefined();
    });

    it("maps both directions and skips self-edges", () => {
      const withSelf = [
        ...edges,
        edge({
          id: "self",
          sourceEntryId: "a",
          targetEntryId: "a",
          relationType: "SELF",
        }),
      ];
      const adj = RelationEngine.buildAdjacency(withSelf, "both");
      expect(adj.get("a")?.map((h) => h.neighborId)).toEqual(["b"]);
      expect(
        adj
          .get("b")
          ?.map((h) => h.neighborId)
          .sort(),
      ).toEqual(["a", "c"]);
    });
  });

  describe("expandFromSeed – seed and depth", () => {
    // a -r1-> b -r2-> c -r3-> d -r4-> e
    const chain: RelationEdge[] = [
      edge({ id: "r1", sourceEntryId: "a", targetEntryId: "b", relationType: "TO" }),
      edge({ id: "r2", sourceEntryId: "b", targetEntryId: "c", relationType: "TO" }),
      edge({ id: "r3", sourceEntryId: "c", targetEntryId: "d", relationType: "TO" }),
      edge({ id: "r4", sourceEntryId: "d", targetEntryId: "e", relationType: "TO" }),
    ];

    it("always includes the seed at depth 0", () => {
      const result = RelationEngine.expandFromSeed({
        seedEntryId: "a",
        edges: chain,
        maxDepth: 0,
        direction: "outgoing",
      });
      expect(result.entryIds).toEqual(["a"]);
      expect(result.entries[0]).toMatchObject({
        entryId: "a",
        depth: 0,
        viaRelationId: null,
        fromEntryId: null,
        traversedAs: "seed",
      });
      expect(result.truncatedByDepth).toBe(true);
    });

    it("defaults maxDepth to 2", () => {
      expect(RelationEngine.DEFAULT_MAX_DEPTH).toBe(2);
      const result = RelationEngine.expandFromSeed({
        seedEntryId: "a",
        edges: chain,
        direction: "outgoing",
      });
      expect(result.maxDepth).toBe(2);
      expect(result.entryIds).toEqual(["a", "b", "c"]);
      expect(result.entries.map((e) => e.depth)).toEqual([0, 1, 2]);
      expect(result.truncatedByDepth).toBe(true);
      expect(result.entryIds).not.toContain("d");
      expect(result.entryIds).not.toContain("e");
    });

    it("respects an explicit deeper maxDepth", () => {
      const result = RelationEngine.expandFromSeed({
        seedEntryId: "a",
        edges: chain,
        maxDepth: 3,
        direction: "outgoing",
      });
      expect(result.entryIds).toEqual(["a", "b", "c", "d"]);
      expect(result.truncatedByDepth).toBe(true);
    });

    it("expands the full chain when depth is sufficient", () => {
      const result = RelationEngine.expandFromSeed({
        seedEntryId: "a",
        edges: chain,
        maxDepth: 10,
        direction: "outgoing",
      });
      expect(result.entryIds).toEqual(["a", "b", "c", "d", "e"]);
      expect(result.truncatedByDepth).toBe(false);
      expect(result.includedRelationIds).toEqual(["r1", "r2", "r3", "r4"]);
    });

    it("returns only the seed when there are no edges", () => {
      const result = RelationEngine.expandFromSeed({
        seedEntryId: "solo",
        edges: [],
        maxDepth: 2,
      });
      expect(result.entryIds).toEqual(["solo"]);
      expect(result.skippedCycles).toEqual([]);
      expect(result.truncatedByDepth).toBe(false);
    });

    it("returns empty result for empty seed id", () => {
      const result = RelationEngine.expandFromSeed({
        seedEntryId: "",
        edges: chain,
      });
      expect(result.entryIds).toEqual([]);
    });
  });

  describe("expandFromSeed – no duplicates", () => {
    it("does not duplicate entries reached via multiple paths (diamond)", () => {
      //     a
      //    / \
      //   b   c
      //    \ /
      //     d
      const diamond: RelationEdge[] = [
        edge({ id: "ab", sourceEntryId: "a", targetEntryId: "b", relationType: "TO" }),
        edge({ id: "ac", sourceEntryId: "a", targetEntryId: "c", relationType: "TO" }),
        edge({ id: "bd", sourceEntryId: "b", targetEntryId: "d", relationType: "TO" }),
        edge({ id: "cd", sourceEntryId: "c", targetEntryId: "d", relationType: "TO" }),
      ];

      const result = RelationEngine.expandFromSeed({
        seedEntryId: "a",
        edges: diamond,
        maxDepth: 5,
        direction: "outgoing",
      });

      expect(result.entryIds).toEqual(["a", "b", "c", "d"]);
      expect(new Set(result.entryIds).size).toBe(result.entryIds.length);
      // First discovery of d wins; the other path is recorded as a skip.
      expect(result.skippedCycles.some((s) => s.toEntryId === "d")).toBe(true);
    });

    it("relatedEntryIds excludes the seed and stays unique", () => {
      const edges: RelationEdge[] = [
        edge({ id: "1", sourceEntryId: "seed", targetEntryId: "x", relationType: "KNOWS" }),
        edge({ id: "2", sourceEntryId: "seed", targetEntryId: "y", relationType: "KNOWS" }),
        edge({ id: "3", sourceEntryId: "x", targetEntryId: "y", relationType: "KNOWS" }),
      ];
      const ids = RelationEngine.relatedEntryIds({
        seedEntryId: "seed",
        edges,
        maxDepth: 2,
        direction: "outgoing",
      });
      expect(ids).toEqual(["x", "y"]);
      expect(ids).not.toContain("seed");
    });
  });

  describe("expandFromSeed – cycle detection", () => {
    it("does not infinite-loop on a two-node cycle", () => {
      const cycle: RelationEdge[] = [
        edge({ id: "ab", sourceEntryId: "a", targetEntryId: "b", relationType: "RIVAL" }),
        edge({ id: "ba", sourceEntryId: "b", targetEntryId: "a", relationType: "RIVAL" }),
      ];

      const result = RelationEngine.expandFromSeed({
        seedEntryId: "a",
        edges: cycle,
        maxDepth: 10,
        direction: "outgoing",
      });

      expect(result.entryIds).toEqual(["a", "b"]);
      expect(result.skippedCycles.length).toBeGreaterThan(0);
      expect(result.skippedCycles.some((s) => s.toEntryId === "a")).toBe(true);
      expect(RelationEngine.hasCycleFromSeed("a", cycle, "outgoing")).toBe(true);
    });

    it("handles a three-node circular graph without duplicates", () => {
      const triangle: RelationEdge[] = [
        edge({ id: "ab", sourceEntryId: "a", targetEntryId: "b", relationType: "TO" }),
        edge({ id: "bc", sourceEntryId: "b", targetEntryId: "c", relationType: "TO" }),
        edge({ id: "ca", sourceEntryId: "c", targetEntryId: "a", relationType: "TO" }),
      ];

      const result = RelationEngine.expandFromSeed({
        seedEntryId: "a",
        edges: triangle,
        maxDepth: 20,
        direction: "outgoing",
      });

      expect(result.entryIds).toEqual(["a", "b", "c"]);
      expect(new Set(result.entryIds).size).toBe(3);
      expect(result.skippedCycles.some((s) => s.relationId === "ca")).toBe(true);
      expect(RelationEngine.hasCycleFromSeed("a", triangle, "outgoing")).toBe(true);
    });

    it("detects cycles when walking both directions on a single directed edge", () => {
      // a -> b walked as both outgoing and incoming creates an immediate 2-cycle in the walk graph
      const single: RelationEdge[] = [
        edge({ id: "ab", sourceEntryId: "a", targetEntryId: "b", relationType: "OWNS" }),
      ];
      expect(RelationEngine.hasCycleFromSeed("a", single, "both")).toBe(true);

      const result = RelationEngine.expandFromSeed({
        seedEntryId: "a",
        edges: single,
        maxDepth: 5,
        direction: "both",
      });
      expect(result.entryIds).toEqual(["a", "b"]);
      // Returning from b to a via the reverse walk is skipped as already-visited.
      expect(result.skippedCycles.some((s) => s.toEntryId === "a")).toBe(true);
    });

    it("reports no cycle for a pure DAG under outgoing traversal", () => {
      const dag: RelationEdge[] = [
        edge({ id: "ab", sourceEntryId: "a", targetEntryId: "b", relationType: "TO" }),
        edge({ id: "bc", sourceEntryId: "b", targetEntryId: "c", relationType: "TO" }),
      ];
      expect(RelationEngine.hasCycleFromSeed("a", dag, "outgoing")).toBe(false);
    });
  });

  describe("expandFromSeed – deep graphs and truncation", () => {
    it("truncates a deep linear graph at the depth limit", () => {
      const deep: RelationEdge[] = [];
      for (let i = 0; i < 20; i += 1) {
        deep.push(
          edge({
            id: `e${i}`,
            sourceEntryId: `n${i}`,
            targetEntryId: `n${i + 1}`,
            relationType: "NEXT",
          }),
        );
      }

      const result = RelationEngine.expandFromSeed({
        seedEntryId: "n0",
        edges: deep,
        maxDepth: 3,
        direction: "outgoing",
      });

      expect(result.entryIds).toEqual(["n0", "n1", "n2", "n3"]);
      expect(result.entryIds).not.toContain("n4");
      expect(result.truncatedByDepth).toBe(true);
      expect(result.entries.every((e) => e.depth <= 3)).toBe(true);
    });

    it("does not mark truncation when the frontier has no further neighbors", () => {
      const short: RelationEdge[] = [
        edge({ id: "ab", sourceEntryId: "a", targetEntryId: "b", relationType: "TO" }),
      ];
      const result = RelationEngine.expandFromSeed({
        seedEntryId: "a",
        edges: short,
        maxDepth: 2,
        direction: "outgoing",
      });
      expect(result.entryIds).toEqual(["a", "b"]);
      expect(result.truncatedByDepth).toBe(false);
    });
  });

  describe("expandFromSeed – both-direction context pull", () => {
    it("pulls related entries that point at the seed (incoming)", () => {
      const edges: RelationEdge[] = [
        edge({
          id: "mentor",
          sourceEntryId: "corvus",
          targetEntryId: "mara",
          relationType: "MENTOR_OF",
          reverseType: "APPRENTICE_OF",
        }),
        edge({
          id: "owns",
          sourceEntryId: "mara",
          targetEntryId: "quill",
          relationType: "OWNS",
        }),
      ];

      const result = RelationEngine.expandFromSeed({
        seedEntryId: "mara",
        edges,
        maxDepth: 1,
        direction: "both",
      });

      expect(result.entryIds).toContain("mara");
      expect(result.entryIds).toContain("corvus");
      expect(result.entryIds).toContain("quill");
      expect(result.entryIds).toHaveLength(3);
    });
  });

  describe("edge cases for full branch coverage", () => {
    it("sorts same-relation both-direction hops by traversedAs", () => {
      const edges = [
        edge({ id: "same", sourceEntryId: "a", targetEntryId: "b", relationType: "LINK" }),
      ];
      const adj = RelationEngine.buildAdjacency(edges, "both");
      const hops = adj.get("a") ?? [];
      // From a: only outgoing to b (incoming would be on b)
      expect(hops.map((h) => h.traversedAs)).toEqual(["outgoing"]);
      const fromB = adj.get("b") ?? [];
      expect(fromB.map((h) => h.traversedAs)).toEqual(["incoming"]);
    });

    it("returns empty when maxDepth is negative", () => {
      const result = RelationEngine.expandFromSeed({
        seedEntryId: "a",
        edges: [edge({ id: "ab", sourceEntryId: "a", targetEntryId: "b", relationType: "TO" })],
        maxDepth: -1,
      });
      expect(result.entryIds).toEqual([]);
      expect(result.maxDepth).toBe(-1);
    });

    it("hasCycleFromSeed returns false for empty seed and for already-finished DAG nodes", () => {
      expect(RelationEngine.hasCycleFromSeed("", [])).toBe(false);
      const dag = [
        edge({ id: "ab", sourceEntryId: "a", targetEntryId: "b", relationType: "TO" }),
        edge({ id: "ac", sourceEntryId: "a", targetEntryId: "c", relationType: "TO" }),
        edge({ id: "bc", sourceEntryId: "b", targetEntryId: "c", relationType: "TO" }),
      ];
      // Diamond DAG: dfs finishes c via one path then revisits via done-set
      expect(RelationEngine.hasCycleFromSeed("a", dag, "outgoing")).toBe(false);
    });

    it("stable-sorts adjacency when two edges share an id (defensive)", () => {
      // Force the traversedAs localeCompare tie-break by building manually-equivalent ids
      // through both directions appearing under the same from-node is not possible for one
      // directed edge; use two edges with identical ids targeting different neighbors... wait,
      // buildAdjacency sorts by relation.id then traversedAs. Covering traversedAs compare:
      const edges = [
        edge({ id: "z", sourceEntryId: "a", targetEntryId: "b", relationType: "TO" }),
        edge({ id: "z", sourceEntryId: "c", targetEntryId: "a", relationType: "TO" }),
      ];
      // From a: outgoing to b (id z) and incoming from c (id z) — same id, different traversedAs
      const adj = RelationEngine.buildAdjacency(edges, "both");
      const hops = adj.get("a") ?? [];
      expect(hops).toHaveLength(2);
      expect(hops.map((h) => h.traversedAs)).toEqual(["incoming", "outgoing"]);
    });
  });
});
