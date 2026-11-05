import { describe, expect, it } from "vite-plus/test";
import {
  applyStructureOverride,
  ImportError,
  MAX_OVERRIDE_TITLE_LENGTH,
  parseStructureOverride,
  previewManuscript,
  structureOverrideFromPreview,
  type ImportManuscript,
} from "../src/lib/import";

const scene = (title: string, content: string, summary: string | null = null) => ({
  title,
  subtitle: null,
  summary,
  content,
  wordCount: content.split(" ").length,
});

const manuscript: ImportManuscript = {
  title: "Book",
  subtitle: null,
  acts: [
    {
      title: "Act 1",
      chapters: [
        {
          title: "Chapter 1",
          scenes: [scene("Scene 1", "one two", "s1"), scene("Scene 2", "three")],
        },
        { title: "Empty", scenes: [] },
      ],
    },
    { title: "Act 2", chapters: [{ title: "Chapter 1", scenes: [scene("Scene 1", "four")] }] },
  ],
};

function shape(m: ImportManuscript) {
  return m.acts.map((a) => ({
    title: a.title,
    chapters: a.chapters.map((c) => ({ title: c.title, scenes: c.scenes.map((s) => s.title) })),
  }));
}

function expectInvalid(fn: () => unknown, message: RegExp) {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ImportError);
    expect((err as ImportError).status).toBe(400);
    expect((err as ImportError).code).toBe("VALIDATION_FAILED");
    expect((err as Error).message).toMatch(message);
    return;
  }
  throw new Error("expected an ImportError");
}

describe("structure override (STO-1211)", () => {
  it("round-trips a preview's structure, dropping scene-less chapters", () => {
    const override = structureOverrideFromPreview(previewManuscript(manuscript));
    expect(override.scenes).toEqual([
      { title: "Scene 1", act: "Act 1", chapter: "Chapter 1" },
      { title: "Scene 2", act: null, chapter: null },
      { title: "Scene 1", act: "Act 2", chapter: "Chapter 1" },
    ]);
    const applied = applyStructureOverride(manuscript, override);
    expect(shape(applied)).toEqual([
      { title: "Act 1", chapters: [{ title: "Chapter 1", scenes: ["Scene 1", "Scene 2"] }] },
      { title: "Act 2", chapters: [{ title: "Chapter 1", scenes: ["Scene 1"] }] },
    ]);
  });

  it("regroups and renames scenes while keeping their text and order", () => {
    const applied = applyStructureOverride(manuscript, {
      scenes: [
        { title: "Harbor", act: "Part One", chapter: "Arrival" },
        { title: "Inn", act: null, chapter: "Night" },
        { title: "Storm", act: null, chapter: null },
      ],
    });
    expect(applied.title).toBe("Book");
    expect(shape(applied)).toEqual([
      {
        title: "Part One",
        chapters: [
          { title: "Arrival", scenes: ["Harbor"] },
          { title: "Night", scenes: ["Inn", "Storm"] },
        ],
      },
    ]);
    const [harbor] = applied.acts[0].chapters[0].scenes;
    expect(harbor).toMatchObject({ content: "one two", summary: "s1", wordCount: 2 });
    expect(applied.acts[0].chapters[1].scenes[1].content).toBe("four");
    // The source manuscript is left untouched.
    expect(manuscript.acts[0].chapters[0].scenes[0].title).toBe("Scene 1");
  });

  it("names missing act and chapter titles when applied without parsing", () => {
    const applied = applyStructureOverride(manuscript, {
      scenes: [
        { title: "a", act: null, chapter: null },
        { title: "b", act: null, chapter: null },
        { title: "c", act: null, chapter: null },
      ],
    });
    expect(shape(applied)).toEqual([
      { title: "Act 1", chapters: [{ title: "Chapter 1", scenes: ["a", "b", "c"] }] },
    ]);
  });

  it("rejects an override built for a different parse", () => {
    expectInvalid(
      () =>
        applyStructureOverride(manuscript, {
          scenes: [{ title: "a", act: "A", chapter: "C" }],
        }),
      /lists 1 scenes but the file has 3/,
    );
  });

  it("parses and trims a valid override; blank means none", () => {
    expect(parseStructureOverride(null)).toBeNull();
    expect(parseStructureOverride("  ")).toBeNull();
    expect(
      parseStructureOverride(
        JSON.stringify({
          scenes: [
            { title: " One ", act: " A ", chapter: " C " },
            { title: "Two", chapter: "D" },
            { title: "Three", act: null, chapter: null },
          ],
        }),
      ),
    ).toEqual({
      scenes: [
        { title: "One", act: "A", chapter: "C" },
        { title: "Two", act: null, chapter: "D" },
        { title: "Three", act: null, chapter: null },
      ],
    });
  });

  it.each([
    ["{", /valid JSON/],
    ["null", /non-empty scenes list/],
    [JSON.stringify({ scenes: [] }), /non-empty scenes list/],
    [JSON.stringify({ scenes: ["x"] }), /scene 1 must be an object/],
    [JSON.stringify({ scenes: [{ act: "A", chapter: "C" }] }), /scene 1 title is required/],
    [JSON.stringify({ scenes: [{ title: 3, act: "A", chapter: "C" }] }), /must be a string/],
    [JSON.stringify({ scenes: [{ title: " ", act: "A", chapter: "C" }] }), /cannot be empty/],
    [
      JSON.stringify({
        scenes: [{ title: "x".repeat(MAX_OVERRIDE_TITLE_LENGTH + 1), act: "A", chapter: "C" }],
      }),
      /longer than/,
    ],
    [JSON.stringify({ scenes: [{ title: "x", act: "A" }] }), /starts an act but not a chapter/],
    [JSON.stringify({ scenes: [{ title: "x", chapter: "C" }] }), /first scene must start/],
  ])("rejects %s", (raw, message) => {
    expectInvalid(() => parseStructureOverride(raw), message);
  });
});
