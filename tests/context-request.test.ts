import { describe, expect, it } from "vite-plus/test";
import { parseAssembleContextBody } from "../src/lib/codex/context-request";

describe("parseAssembleContextBody (STO-1171)", () => {
  it("accepts a minimal body", () => {
    expect(parseAssembleContextBody({ sceneId: "scene-1" })).toEqual({
      ok: true,
      input: {
        sceneId: "scene-1",
        novelId: undefined,
        beatText: undefined,
        recentProse: undefined,
        manualAttachmentIds: undefined,
        options: undefined,
      },
    });
  });

  it("passes through every supported field", () => {
    const body = {
      sceneId: "scene-1",
      novelId: "novel-1",
      beatText: "Beat",
      recentProse: "Prose",
      manualAttachmentIds: ["a", "b"],
      options: { maxEntries: 5, maxRelationDepth: 0, includeSeriesCodex: false },
    };
    expect(parseAssembleContextBody(body)).toEqual({ ok: true, input: body });
  });

  it.each([
    ["a non-object body", null, /JSON object/],
    ["an array body", [], /JSON object/],
    ["a missing sceneId", {}, /sceneId/],
    ["a blank sceneId", { sceneId: "  " }, /sceneId/],
    ["a non-string novelId", { sceneId: "s", novelId: 1 }, /novelId/],
    ["a non-string beatText", { sceneId: "s", beatText: 1 }, /beatText/],
    ["a non-string recentProse", { sceneId: "s", recentProse: false }, /recentProse/],
    ["non-array attachments", { sceneId: "s", manualAttachmentIds: "a" }, /manualAttachmentIds/],
    [
      "non-string attachment ids",
      { sceneId: "s", manualAttachmentIds: [1] },
      /manualAttachmentIds/,
    ],
    ["non-object options", { sceneId: "s", options: 3 }, /options/],
    ["a negative maxEntries", { sceneId: "s", options: { maxEntries: -1 } }, /maxEntries/],
    [
      "a non-finite maxRelationDepth",
      { sceneId: "s", options: { maxRelationDepth: "2" } },
      /maxRelationDepth/,
    ],
    [
      "a non-boolean includeSeriesCodex",
      { sceneId: "s", options: { includeSeriesCodex: "yes" } },
      /includeSeriesCodex/,
    ],
  ])("rejects %s", (_label, body, message) => {
    const result = parseAssembleContextBody(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(message);
    }
  });
});
