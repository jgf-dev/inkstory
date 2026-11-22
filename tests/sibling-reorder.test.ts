import { describe, expect, it } from "vite-plus/test";
import { applySiblingReorder, dropIndexForSibling } from "../src/lib/writing/sibling-reorder";

describe("sibling-reorder helpers", () => {
  it("computes drop indexes for before/after including downward drags", () => {
    // Move index 0 onto index 2 (after) => final index 2
    expect(dropIndexForSibling(0, 2, "after")).toBe(2);
    // Move index 0 onto index 2 (before) => final index 1
    expect(dropIndexForSibling(0, 2, "before")).toBe(1);
    // Move index 2 onto index 0 (before) => final index 0
    expect(dropIndexForSibling(2, 0, "before")).toBe(0);
    // Move index 2 onto index 0 (after) => final index 1
    expect(dropIndexForSibling(2, 0, "after")).toBe(1);
    // No-op: drop after self when already last among two
    expect(dropIndexForSibling(1, 1, "after")).toBe(1);
  });

  it("reorders arrays without mutating the source", () => {
    const src = ["a", "b", "c", "d"];
    expect(applySiblingReorder(src, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(src).toEqual(["a", "b", "c", "d"]);
    expect(applySiblingReorder(src, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(applySiblingReorder(src, 1, 1)).toEqual(["a", "b", "c", "d"]);
    expect(applySiblingReorder(src, -1, 0)).toEqual(["a", "b", "c", "d"]);
  });
});
