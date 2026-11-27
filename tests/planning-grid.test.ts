import { describe, expect, it } from "vite-plus/test";
import { buildPlanningGrid } from "../src/lib/writing/planning-grid";
import type { NovelOutline } from "../src/lib/writing/service";

function outline(): NovelOutline {
  return {
    novel: { id: "n", title: "N", subtitle: null, seriesId: null },
    acts: [
      {
        id: "a1",
        title: "Act I",
        position: 0,
        chapters: [
          {
            id: "c1",
            title: "One",
            position: 0,
            scenes: [
              { id: "s1", title: "A", label: null, position: 0, wordCount: 100 },
              { id: "s2", title: "B", label: "Draft", position: 1, wordCount: 50 },
            ],
          },
          { id: "c2", title: "Two", position: 1, scenes: [] },
        ],
      },
      {
        id: "a2",
        title: "Act II",
        position: 1,
        chapters: [
          {
            id: "c3",
            title: "Three",
            position: 0,
            scenes: [{ id: "s3", title: "C", label: null, position: 0, wordCount: 7 }],
          },
        ],
      },
      { id: "a3", title: "Act III", position: 2, chapters: [] },
    ],
    totals: { acts: 3, chapters: 3, scenes: 3, words: 157 },
  };
}

describe("buildPlanningGrid (STO-1257)", () => {
  it("numbers scenes in reading order across acts and rolls up word counts", () => {
    const grid = buildPlanningGrid(outline());
    expect(grid.map((a) => [a.id, a.sceneCount, a.wordCount])).toEqual([
      ["a1", 2, 150],
      ["a2", 1, 7],
      ["a3", 0, 0],
    ]);
    const [c1, c2] = grid[0].chapters;
    expect(c1).toMatchObject({ id: "c1", siblingIndex: 0, siblingCount: 2, wordCount: 150 });
    expect(c2).toMatchObject({ id: "c2", siblingIndex: 1, siblingCount: 2, wordCount: 0 });
    expect(c1.scenes.map((s) => [s.id, s.number, s.siblingIndex, s.label])).toEqual([
      ["s1", 1, 0, null],
      ["s2", 2, 1, "Draft"],
    ]);
    expect(grid[1].chapters[0].scenes[0]).toMatchObject({ id: "s3", number: 3, siblingIndex: 0 });
    expect(grid[2].chapters).toEqual([]);
  });

  it("returns an empty grid for a novel with no acts", () => {
    expect(buildPlanningGrid({ ...outline(), acts: [] })).toEqual([]);
  });

  it("stays linear for a realistic 60-scene novel", () => {
    const big = outline();
    big.acts = [
      {
        id: "act",
        title: "Act",
        position: 0,
        chapters: Array.from({ length: 12 }, (_, c) => ({
          id: `ch${c}`,
          title: `Chapter ${c + 1}`,
          position: c,
          scenes: Array.from({ length: 5 }, (_, s) => ({
            id: `sc${c}-${s}`,
            title: `Scene ${s}`,
            label: null,
            position: s,
            wordCount: 10,
          })),
        })),
      },
    ];
    const grid = buildPlanningGrid(big);
    expect(grid[0].sceneCount).toBe(60);
    expect(grid[0].wordCount).toBe(600);
    expect(grid[0].chapters.at(-1)?.scenes.at(-1)?.number).toBe(60);
  });
});
