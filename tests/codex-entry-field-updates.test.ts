import { describe, expect, it } from "vite-plus/test";
import { buildCodexEntryFieldUpdates, CodexError } from "../src/lib/codex/service";

describe("buildCodexEntryFieldUpdates (STO-1219)", () => {
  it("returns an empty object when nothing is provided", () => {
    expect(buildCodexEntryFieldUpdates({})).toEqual({});
  });

  it("trims the name", () => {
    expect(buildCodexEntryFieldUpdates({ name: "  Aria  " })).toEqual({ name: "Aria" });
  });

  it("rejects a blank name", () => {
    expect(() => buildCodexEntryFieldUpdates({ name: "   " })).toThrow(CodexError);
    expect(() => buildCodexEntryFieldUpdates({ name: "   " })).toThrow(
      "Entry name cannot be empty",
    );
  });

  it("copies every provided passthrough field, including falsy values", () => {
    const updates = buildCodexEntryFieldUpdates({
      type: "LOCATION",
      description: "",
      notes: null,
      trackingMode: "NEVER",
      customFields: { eyes: "green" },
      color: "#ff0000",
      thumbnailUrl: null,
      position: 0,
    });

    expect(updates).toEqual({
      type: "LOCATION",
      description: "",
      notes: null,
      trackingMode: "NEVER",
      customFields: { eyes: "green" },
      color: "#ff0000",
      thumbnailUrl: null,
      position: 0,
    });
  });

  it("ignores scoping fields, which are resolved separately", () => {
    expect(
      buildCodexEntryFieldUpdates({ seriesScoped: true, novelId: "n1", seriesId: "s1" }),
    ).toEqual({});
  });
});
