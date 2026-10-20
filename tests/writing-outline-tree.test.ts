import { describe, expect, it } from "vite-plus/test";
import { isSceneUnderNode } from "../src/lib/writing/outline-tree";
import type { NovelOutline } from "../src/lib/writing/service";

const scene = (id: string) => ({ id, title: id, label: null, position: 0, wordCount: 0 });
const outline = {
  novel: { id: "n", title: "N", subtitle: null, seriesId: null },
  acts: [
    {
      id: "a1",
      title: "A1",
      position: 0,
      chapters: [
        { id: "c1", title: "C1", position: 0, scenes: [scene("s1")] },
        { id: "c2", title: "C2", position: 1, scenes: [scene("s2")] },
      ],
    },
    { id: "a2", title: "A2", position: 1, chapters: [] },
  ],
  totals: { acts: 2, chapters: 2, scenes: 2, words: 0 },
} as NovelOutline;

describe("isSceneUnderNode", () => {
  it("matches the scene itself", () => {
    expect(isSceneUnderNode(outline, "scene", "s1", "s1")).toBe(true);
    expect(isSceneUnderNode(outline, "scene", "s2", "s1")).toBe(false);
  });
  it("matches scenes under a deleted chapter", () => {
    expect(isSceneUnderNode(outline, "chapter", "c1", "s1")).toBe(true);
    expect(isSceneUnderNode(outline, "chapter", "c2", "s1")).toBe(false);
  });
  it("matches scenes under a deleted act", () => {
    expect(isSceneUnderNode(outline, "act", "a1", "s2")).toBe(true);
    expect(isSceneUnderNode(outline, "act", "a2", "s2")).toBe(false);
  });
  it("returns false for scenes missing from the outline", () => {
    expect(isSceneUnderNode(outline, "act", "a1", "ghost")).toBe(false);
  });
});
