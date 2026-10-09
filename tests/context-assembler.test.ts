import { describe, expect, it } from "vite-plus/test";
import {
  assembleContext,
  ContextAssemblyError,
  DEFAULT_MAX_CONTEXT_ENTRIES,
  type ContextAssemblyData,
  type ContextAssemblyRequest,
  type ContextCandidateEntry,
  type ContextProgression,
} from "../src/lib/codex/context-assembler";
import type { SceneReadingOrderKey } from "../src/lib/codex/progression-engine";
import type { RelationEdge } from "../src/lib/codex/relation-engine";

const NOVEL = "novel-1";
const SERIES = "series-1";

function entry(
  partial: Partial<ContextCandidateEntry> & Pick<ContextCandidateEntry, "id" | "name">,
): ContextCandidateEntry {
  return {
    type: "CHARACTER",
    aliases: [],
    description: `${partial.name} base`,
    trackingMode: "DETECTED",
    seriesScoped: false,
    novelId: NOVEL,
    seriesId: null,
    position: 0,
    ...partial,
  };
}

function rel(id: string, sourceEntryId: string, targetEntryId: string): RelationEdge {
  return { id, sourceEntryId, targetEntryId, relationType: "RELATED_TO" };
}

function scene(
  sceneId: string,
  actPosition: number,
  chapterPosition: number,
  scenePosition: number,
): SceneReadingOrderKey {
  return { sceneId, actPosition, chapterPosition, scenePosition };
}

const sceneOrderById = new Map<string, SceneReadingOrderKey>([
  ["s1", scene("s1", 0, 0, 0)],
  ["s2", scene("s2", 0, 0, 1)],
  ["s3", scene("s3", 0, 1, 0)],
  ["s4", scene("s4", 1, 0, 0)],
]);

function data(partial: Partial<ContextAssemblyData> = {}): ContextAssemblyData {
  return {
    entries: [],
    relations: [],
    progressions: [],
    sceneOrderById,
    seriesId: SERIES,
    ...partial,
  };
}

function request(partial: Partial<ContextAssemblyRequest> = {}): ContextAssemblyRequest {
  return { novelId: NOVEL, sceneId: "s2", ...partial };
}

function summary(result: ReturnType<typeof assembleContext>) {
  return result.entries.map((e) =>
    e.relationDepth === undefined
      ? `${e.id}:${e.source}`
      : `${e.id}:${e.source}:${e.relationDepth}`,
  );
}

describe("assembleContext (STO-1170)", () => {
  describe("scene validation", () => {
    it("throws ContextAssemblyError when the scene is not in reading order", () => {
      expect(() => assembleContext(request({ sceneId: "missing" }), data())).toThrow(
        ContextAssemblyError,
      );
      expect(() => assembleContext(request({ sceneId: "missing" }), data())).toThrow(
        /missing not found/,
      );
    });

    it("returns an empty context with meta when nothing qualifies", () => {
      const result = assembleContext(request(), data());
      expect(result).toEqual({
        entries: [],
        meta: { totalCandidates: 0, finalCount: 0, truncated: false, sceneId: "s2" },
      });
    });
  });

  describe("scoping", () => {
    const entries = [
      entry({ id: "book", name: "Book", trackingMode: "ALWAYS" }),
      entry({ id: "other-book", name: "Other", trackingMode: "ALWAYS", novelId: "novel-2" }),
      entry({
        id: "series",
        name: "Series",
        trackingMode: "ALWAYS",
        seriesScoped: true,
        novelId: null,
        seriesId: SERIES,
      }),
      entry({
        id: "other-series",
        name: "Other Series",
        trackingMode: "ALWAYS",
        seriesScoped: true,
        novelId: null,
        seriesId: "series-2",
      }),
    ];

    it("includes book entries and the novel's series entries by default", () => {
      const result = assembleContext(request(), data({ entries }));
      expect(result.entries.map((e) => e.id)).toEqual(["book", "series"]);
    });

    it("excludes series entries when includeSeriesCodex is false", () => {
      const result = assembleContext(
        request({ options: { includeSeriesCodex: false } }),
        data({ entries }),
      );
      expect(result.entries.map((e) => e.id)).toEqual(["book"]);
    });

    it("excludes series entries when the novel has no series", () => {
      expect(
        assembleContext(request(), data({ entries, seriesId: null })).entries.map((e) => e.id),
      ).toEqual(["book"]);
      expect(
        assembleContext(request(), data({ entries, seriesId: undefined })).entries.map((e) => e.id),
      ).toEqual(["book"]);
    });

    it("ignores manual attachments that are unknown or out of scope", () => {
      const result = assembleContext(
        request({ manualAttachmentIds: ["nope", "other-book", "other-series"] }),
        data({ entries }),
      );
      expect(result.entries.map((e) => e.id)).toEqual(["book", "series"]);
    });

    it("keeps the first row when entry ids are duplicated", () => {
      const result = assembleContext(
        request(),
        data({
          entries: [
            entry({ id: "dup", name: "First", trackingMode: "ALWAYS" }),
            entry({ id: "dup", name: "Second", trackingMode: "ALWAYS" }),
          ],
        }),
      );
      expect(result.entries.map((e) => e.name)).toEqual(["First"]);
    });
  });

  describe("seed collection", () => {
    it("orders seeds manual -> always -> mention and keeps the highest source", () => {
      const entries = [
        entry({ id: "a", name: "Aria", trackingMode: "ALWAYS" }),
        entry({ id: "b", name: "Bram" }),
        entry({ id: "c", name: "Cora" }),
        entry({ id: "m", name: "Mira" }),
      ];
      const result = assembleContext(
        request({
          beatText: "Cora meets Aria and Bram.",
          manualAttachmentIds: ["m", "b", "m"],
        }),
        data({ entries }),
      );
      expect(summary(result)).toEqual(["m:manual", "b:manual", "a:always", "c:mention"]);
    });

    it("includes NEVER entries only when manually attached", () => {
      const entries = [entry({ id: "n", name: "Nyx", trackingMode: "NEVER" })];
      expect(
        assembleContext(request({ beatText: "Nyx arrives." }), data({ entries })).entries,
      ).toHaveLength(0);
      const manual = assembleContext(request({ manualAttachmentIds: ["n"] }), data({ entries }));
      expect(summary(manual)).toEqual(["n:manual"]);
      expect(manual.entries[0].trackingMode).toBe("never");
    });

    it("orders always-tracked entries by position, then name, then id", () => {
      const entries = [
        entry({ id: "z", name: "Zed", trackingMode: "ALWAYS", position: 0 }),
        entry({ id: "y2", name: "Same", trackingMode: "ALWAYS", position: 1 }),
        entry({ id: "y1", name: "Same", trackingMode: "ALWAYS", position: 1 }),
        entry({ id: "a", name: "Abe", trackingMode: "ALWAYS", position: 2 }),
        entry({ id: "b", name: "Bea", trackingMode: "ALWAYS" }),
      ];
      const { position: _ignored, ...noPosition } = entries[4];
      const result = assembleContext(
        request(),
        data({ entries: [...entries.slice(0, 4), noPosition] }),
      );
      expect(result.entries.map((e) => e.id)).toEqual(["b", "z", "y1", "y2", "a"]);
    });
  });

  describe("mention detection", () => {
    const entries = [
      entry({ id: "weaver", name: "Glass Weaver" }),
      entry({ id: "the-weaver", name: "Oriel", aliases: ["The Glass Weaver"] }),
      entry({ id: "kai", name: "Kai", aliases: ["Captain"] }),
      entry({ id: "ann", name: "Ann" }),
    ];

    it("matches names and aliases case-insensitively with longer aliases winning", () => {
      const result = assembleContext(
        request({ beatText: "THE GLASS WEAVER bows.", recentProse: "the captain nods." }),
        data({ entries }),
      );
      expect(summary(result)).toEqual(["the-weaver:mention", "kai:mention"]);
    });

    it("prefers whole-word matches", () => {
      const result = assembleContext(request({ beatText: "Annabel waits." }), data({ entries }));
      expect(result.entries).toHaveLength(0);
    });

    it("does not match across the beat / prose boundary", () => {
      const result = assembleContext(
        request({ beatText: "We met Glass", recentProse: "Weaver later." }),
        data({ entries }),
      );
      expect(result.entries).toHaveLength(0);
    });

    it("skips detection for blank text", () => {
      const result = assembleContext(
        request({ beatText: "   ", recentProse: "" }),
        data({ entries }),
      );
      expect(result.entries).toHaveLength(0);
    });

    it("uses recent prose alone when no beat text is given", () => {
      const result = assembleContext(request({ recentProse: "Ann sighs." }), data({ entries }));
      expect(summary(result)).toEqual(["ann:mention"]);
    });
  });

  describe("relation expansion", () => {
    const chain = [
      entry({ id: "a", name: "Aria", trackingMode: "ALWAYS" }),
      entry({ id: "b", name: "Bram" }),
      entry({ id: "c", name: "Cora" }),
      entry({ id: "d", name: "Dax" }),
    ];
    const chainEdges = [rel("r1", "a", "b"), rel("r2", "b", "c"), rel("r3", "c", "d")];

    it("expands up to the default depth of 2", () => {
      const result = assembleContext(request(), data({ entries: chain, relations: chainEdges }));
      expect(summary(result)).toEqual(["a:always", "b:relation:1", "c:relation:2"]);
    });

    it("honors maxRelationDepth and disables expansion at 0", () => {
      expect(
        summary(
          assembleContext(
            request({ options: { maxRelationDepth: 3 } }),
            data({ entries: chain, relations: chainEdges }),
          ),
        ),
      ).toEqual(["a:always", "b:relation:1", "c:relation:2", "d:relation:3"]);
      expect(
        summary(
          assembleContext(
            request({ options: { maxRelationDepth: 0 } }),
            data({ entries: chain, relations: chainEdges }),
          ),
        ),
      ).toEqual(["a:always"]);
    });

    it("treats negative or non-finite limits safely", () => {
      expect(
        summary(
          assembleContext(
            request({ options: { maxRelationDepth: -4 } }),
            data({ entries: chain, relations: chainEdges }),
          ),
        ),
      ).toEqual(["a:always"]);
      expect(
        summary(
          assembleContext(
            request({ options: { maxRelationDepth: Number.NaN, maxEntries: Number.NaN } }),
            data({ entries: chain, relations: chainEdges }),
          ),
        ),
      ).toEqual(["a:always", "b:relation:1", "c:relation:2"]);
    });

    it("handles cycles without duplicating entries", () => {
      const cyclic = [rel("r1", "a", "b"), rel("r2", "b", "c"), rel("r3", "c", "a")];
      const result = assembleContext(
        request({ options: { maxRelationDepth: 10 } }),
        data({ entries: chain.slice(0, 3), relations: cyclic }),
      );
      expect(summary(result)).toEqual(["a:always", "b:relation:1", "c:relation:1"]);
    });

    it("does not re-add seeds and keeps the minimum depth across seeds", () => {
      const result = assembleContext(
        request({ beatText: "Dax waits." }),
        data({ entries: chain, relations: chainEdges }),
      );
      // c is depth 2 from a but depth 1 from d; b is depth 1 from a.
      expect(summary(result)).toEqual(["a:always", "d:mention", "b:relation:1", "c:relation:1"]);
    });

    it("neither adds nor traverses through NEVER entries or out-of-scope entries", () => {
      const entries = [
        entry({ id: "a", name: "Aria", trackingMode: "ALWAYS" }),
        entry({ id: "n", name: "Nyx", trackingMode: "NEVER" }),
        entry({ id: "x", name: "Xan" }),
        entry({ id: "o", name: "Out", novelId: "novel-2" }),
        entry({ id: "y", name: "Yara" }),
      ];
      const relations = [
        rel("r1", "a", "n"),
        rel("r2", "n", "x"),
        rel("r3", "a", "o"),
        rel("r4", "o", "y"),
      ];
      const result = assembleContext(request(), data({ entries, relations }));
      expect(summary(result)).toEqual(["a:always"]);
    });

    it("expands from a manually attached NEVER entry", () => {
      const entries = [
        entry({ id: "n", name: "Nyx", trackingMode: "NEVER" }),
        entry({ id: "x", name: "Xan" }),
      ];
      const result = assembleContext(
        request({ manualAttachmentIds: ["n"] }),
        data({ entries, relations: [rel("r1", "x", "n")] }),
      );
      expect(summary(result)).toEqual(["n:manual", "x:relation:1"]);
    });
  });

  describe("progressions", () => {
    const entries = [
      entry({ id: "a", name: "Aria", trackingMode: "ALWAYS", description: "A girl." }),
    ];
    const progressions: ContextProgression[] = (
      [
        { id: "p-future", entryId: "a", sceneId: "s4", mode: "REPLACEMENT", description: "Queen." },
        {
          id: "p2",
          entryId: "a",
          sceneId: "s2",
          mode: "ADDITION",
          description: "Has a sword.",
          position: 0,
        },
        {
          id: "p1",
          entryId: "a",
          sceneId: "s1",
          mode: "ADDITION",
          description: "Lost her home.",
          position: 0,
        },
        { id: "p-orphan", entryId: "a", sceneId: "gone", mode: "REPLACEMENT", description: "?" },
        { id: "p-other", entryId: "zz", sceneId: "s1", mode: "REPLACEMENT", description: "Other." },
      ] satisfies Array<Omit<ContextProgression, "position"> & { position?: number }>
    ).map((p) => ({ position: 0, ...p }));

    it("applies only progressions at or before the current scene, in reading order", () => {
      const result = assembleContext(request({ sceneId: "s2" }), data({ entries, progressions }));
      expect(result.entries[0].description).toBe("A girl.\nLost her home.\nHas a sword.");
      expect(result.entries[0].appliedProgressionIds).toEqual(["p1", "p2"]);
    });

    it("applies replacements once the scene is reached", () => {
      const result = assembleContext(request({ sceneId: "s4" }), data({ entries, progressions }));
      expect(result.entries[0].description).toBe("Queen.");
      expect(result.entries[0].appliedProgressionIds).toEqual(["p1", "p2", "p-future"]);
    });

    it("leaves the base description when no progressions apply", () => {
      const result = assembleContext(
        request({ sceneId: "s1" }),
        data({ entries, progressions: [] }),
      );
      expect(result.entries[0].description).toBe("A girl.");
      expect(result.entries[0].appliedProgressionIds).toEqual([]);
    });
  });

  describe("ranking and truncation", () => {
    const entries = [
      entry({ id: "always", name: "Always", trackingMode: "ALWAYS" }),
      entry({ id: "mention", name: "Mentioned" }),
      entry({ id: "manual", name: "Manual" }),
      entry({ id: "deep", name: "Deep" }),
      entry({ id: "near", name: "Near" }),
    ];
    const relations = [rel("r1", "always", "near"), rel("r2", "near", "deep")];
    const req = request({ beatText: "Mentioned here.", manualAttachmentIds: ["manual"] });

    it("ranks manual, always, mention, depth 1, depth 2+", () => {
      const result = assembleContext(req, data({ entries, relations }));
      expect(summary(result)).toEqual([
        "manual:manual",
        "always:always",
        "mention:mention",
        "near:relation:1",
        "deep:relation:2",
      ]);
      expect(result.meta).toEqual({
        totalCandidates: 5,
        finalCount: 5,
        truncated: false,
        sceneId: "s2",
      });
    });

    it("truncates lowest-ranked entries past maxEntries", () => {
      const result = assembleContext(
        { ...req, options: { maxEntries: 3 } },
        data({ entries, relations }),
      );
      expect(summary(result)).toEqual(["manual:manual", "always:always", "mention:mention"]);
      expect(result.meta).toEqual({
        totalCandidates: 5,
        finalCount: 3,
        truncated: true,
        sceneId: "s2",
      });
    });

    it("defaults maxEntries to 40", () => {
      expect(DEFAULT_MAX_CONTEXT_ENTRIES).toBe(40);
      const many = Array.from({ length: 45 }, (_, i) =>
        entry({
          id: `e${String(i).padStart(2, "0")}`,
          name: `E${i}`,
          trackingMode: "ALWAYS",
          position: i,
        }),
      );
      const result = assembleContext(request(), data({ entries: many }));
      expect(result.meta.finalCount).toBe(40);
      expect(result.meta.totalCandidates).toBe(45);
      expect(result.entries.at(-1)?.id).toBe("e39");
    });
  });

  describe("output shape and determinism", () => {
    it("maps fields and tracking modes to the AssembledContext shape", () => {
      const entries = [
        entry({
          id: "a",
          name: "Aria",
          trackingMode: "ALWAYS",
          type: "LOCATION",
          aliases: ["Ari"],
        }),
        entry({ id: "b", name: "Bram" }),
      ];
      const result = assembleContext(request({ beatText: "Bram." }), data({ entries }));
      expect(result.entries).toEqual([
        {
          id: "a",
          type: "LOCATION",
          name: "Aria",
          aliases: ["Ari"],
          description: "Aria base",
          trackingMode: "always",
          source: "always",
          appliedProgressionIds: [],
        },
        {
          id: "b",
          type: "CHARACTER",
          name: "Bram",
          aliases: [],
          description: "Bram base",
          trackingMode: "detected",
          source: "mention",
          appliedProgressionIds: [],
        },
      ]);
      expect("relationDepth" in result.entries[0]).toBe(false);
    });

    it("returns identical output regardless of input row order", () => {
      const entries = [
        entry({ id: "a", name: "Aria", trackingMode: "ALWAYS" }),
        entry({ id: "b", name: "Bram", trackingMode: "ALWAYS" }),
        entry({ id: "c", name: "Cora", aliases: ["Twin"] }),
        entry({ id: "d", name: "Dax", aliases: ["Twin"] }),
        entry({ id: "e", name: "Eve" }),
        entry({ id: "f", name: "Fen" }),
      ];
      const relations = [rel("r2", "b", "f"), rel("r1", "a", "e"), rel("r3", "e", "f")];
      const progressions: ContextProgression[] = [
        {
          id: "p2",
          entryId: "e",
          sceneId: "s1",
          mode: "ADDITION",
          description: "two",
          position: 1,
        },
        {
          id: "p1",
          entryId: "e",
          sceneId: "s1",
          mode: "ADDITION",
          description: "one",
          position: 0,
        },
      ];
      const req = request({ beatText: "The Twin waits." });
      const forward = assembleContext(req, data({ entries, relations, progressions }));
      const reversed = assembleContext(
        req,
        data({
          entries: [...entries].reverse(),
          relations: [...relations].reverse(),
          progressions: [...progressions].reverse(),
        }),
      );
      expect(reversed).toEqual(forward);
      expect(assembleContext(req, data({ entries, relations, progressions }))).toEqual(forward);
    });
  });
});
