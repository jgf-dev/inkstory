import { describe, expect, it } from "vite-plus/test";
import {
  detectLorebookFeatures,
  normalizePrimaryKeys,
  parseLorebook,
  serializeLorebook,
} from "../src/lib/codex/interchange/lorebook";
import {
  INTERCHANGE_ENVELOPE_KEY,
  LOREBOOK_LIMITS,
  type InterchangeEnvelope,
  type LorebookExportSource,
} from "../src/lib/codex/interchange/types";
import {
  parseBoundedJson,
  protectReservedEnvelope,
  readInterchangeEnvelope,
  stripReservedEnvelope,
} from "../src/lib/codex/interchange/validate";

function stEntry(uid: number, overrides: Record<string, unknown> = {}) {
  return {
    uid,
    key: [`key${uid}`],
    keysecondary: [],
    comment: `Entry ${uid}`,
    content: `Content ${uid}`,
    constant: false,
    selective: true,
    disable: false,
    order: 100,
    probability: 100,
    useProbability: true,
    displayIndex: uid,
    ...overrides,
  };
}

function book(entries: unknown, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ name: "Test Book", ...extra, entries });
}

function envelopeFor(
  parsed: ReturnType<typeof parseLorebook>,
  index: number,
  groupId = "group-1",
): InterchangeEnvelope {
  const draft = parsed.drafts[index];
  return {
    schemaVersion: 1,
    format: "sillytavern.lorebook",
    sourceVersion: parsed.preview.sourceVersion,
    groupId,
    sourceEntryKey: draft.sourceEntryKey,
    sourceOrder: draft.sourceOrder,
    originalEntry: draft.originalEntry,
    bookMetadata: parsed.bookMetadata,
    mappingVersion: 1,
    importedTrackingMode: draft.trackingMode,
    unsupportedFeatures: draft.unsupportedFeatures,
  };
}

function sourceFromDraft(
  parsed: ReturnType<typeof parseLorebook>,
  index: number,
  overrides: Partial<LorebookExportSource> = {},
  groupId?: string,
): LorebookExportSource {
  const draft = parsed.drafts[index];
  return {
    id: `entry-${index}`,
    name: draft.name,
    description: draft.description,
    trackingMode: draft.trackingMode,
    aliases: draft.aliases,
    customFields: { [INTERCHANGE_ENVELOPE_KEY]: envelopeFor(parsed, index, groupId) },
    ...overrides,
  };
}

describe("lorebook codec — parse (STO-1262)", () => {
  it("maps title, content, primary keys and constant/detected activation", () => {
    const parsed = parseLorebook(
      book({
        "0": stEntry(0, { key: ["  Mara ", "mara", "", "Captain"], comment: "Mara Vey" }),
        "1": stEntry(1, { constant: true }),
      }),
    );
    expect(parsed.preview.sourceVersion).toBe("worldinfo");
    expect(parsed.preview.bookName).toBe("Test Book");
    const [mara, constant] = parsed.preview.entries;
    expect(mara).toMatchObject({
      sourceEntryKey: "0",
      name: "Mara Vey",
      description: "Content 0",
      aliases: ["Mara", "Captain"],
      trackingMode: "DETECTED",
      activation: "supported",
    });
    expect(constant.trackingMode).toBe("ALWAYS");
    expect(parsed.preview.warnings.map((w) => w.code)).toContain("DROPPED_KEYS");
    // Content is stored in description, not duplicated in the preserved entry.
    expect(parsed.drafts[0].originalEntry).not.toHaveProperty("content");
    expect(parsed.bookMetadata).toEqual({ name: "Test Book" });
  });

  it("accepts the array entries variant and string keys", () => {
    const parsed = parseLorebook(
      JSON.stringify({ entries: [{ key: "Solo", content: "x" }, { content: "y" }] }),
    );
    expect(parsed.preview.sourceVersion).toBe("worldinfo-array");
    expect(parsed.preview.bookName).toBeNull();
    expect(parsed.preview.entries.map((e) => e.sourceEntryKey)).toEqual(["0", "1"]);
    expect(parsed.preview.entries[0]).toMatchObject({ name: "Solo", aliases: ["Solo"] });
    expect(parsed.preview.entries[1].name).toBe("Lorebook entry 2");
    const codes = parsed.preview.warnings.map((w) => w.code);
    expect(codes).toContain("FALLBACK_NAME");
    expect(codes).toContain("NO_PRIMARY_KEYS");
  });

  it("disabled wins over constant and over unsupported activation", () => {
    const parsed = parseLorebook(
      book({
        "0": stEntry(0, { disable: true, constant: true }),
        "1": stEntry(1, { enabled: false, keysecondary: ["night"] }),
      }),
    );
    expect(parsed.preview.entries.map((e) => [e.trackingMode, e.activation])).toEqual([
      ["NEVER", "disabled"],
      ["NEVER", "disabled"],
    ]);
    expect(parsed.preview.warnings.map((w) => w.code)).toContain("CONTRADICTORY_FLAGS");
  });

  it("imports entries with unsupported activation as NEVER and never turns secondary keys into aliases", () => {
    const parsed = parseLorebook(
      book({
        "0": stEntry(0, { keysecondary: ["moon"], key: ["wolf", "/were(wolf)?/i"] }),
        "1": stEntry(1, { probability: 40 }),
        "2": stEntry(2, { sticky: 2, cooldown: 1, delay: 3, delayUntilRecursion: 1 }),
        "3": stEntry(3, { vectorized: true }),
        "4": stEntry(4, { keysecondary: ["ignored"], selective: false }),
      }),
    );
    const [secondary, probability, timed, vector, nonSelective] = parsed.preview.entries;
    expect(secondary).toMatchObject({ trackingMode: "NEVER", activation: "unsupported" });
    expect(secondary.aliases).toEqual(["wolf"]);
    expect(secondary.unsupportedFeatures).toEqual(["secondaryKeys", "regexKeys"]);
    expect(probability.trackingMode).toBe("NEVER");
    expect(timed.unsupportedFeatures).toEqual([
      "sticky",
      "cooldown",
      "delay",
      "delayUntilRecursion",
    ]);
    expect(vector.unsupportedFeatures).toEqual(["vectorized"]);
    expect(nonSelective).toMatchObject({ trackingMode: "DETECTED", unsupportedFeatures: [] });
    expect(parsed.preview.warnings.filter((w) => w.code === "UNSUPPORTED_ACTIVATION")).toHaveLength(
      4,
    );
  });

  it("reports preserved-only features without changing activation", () => {
    const features = detectLorebookFeatures(
      {
        excludeRecursion: true,
        group: "weather",
        caseSensitive: true,
        scanDepth: 3,
        automationId: "auto-1",
        useProbability: false,
        probability: 10,
      },
      0,
    );
    expect(features).toEqual([
      "recursionFlags",
      "inclusionGroup",
      "matchOptions",
      "scanDepth",
      "automation",
    ]);
    const parsed = parseLorebook(book({ "0": stEntry(0, { group: "g", matchWholeWords: false }) }));
    expect(parsed.preview.entries[0].trackingMode).toBe("DETECTED");
    expect(parsed.preview.warnings.map((w) => w.code)).toContain("PRESERVED_ONLY_FEATURES");
  });

  it("uses string uids and truncates overlong titles", () => {
    const parsed = parseLorebook(
      book({
        a: stEntry(0, { uid: " abc ", comment: "T".repeat(LOREBOOK_LIMITS.maxNameLength + 5) }),
      }),
    );
    expect(parsed.preview.entries[0].sourceEntryKey).toBe("abc");
    expect(parsed.preview.entries[0].name).toHaveLength(LOREBOOK_LIMITS.maxNameLength);
    expect(parsed.preview.warnings.map((w) => w.code)).toContain("NAME_TRUNCATED");
  });

  it("normalizes keys: trims, dedupes case-insensitively, separates regex and overlong keys", () => {
    expect(
      normalizePrimaryKeys([
        "A",
        " a",
        "/x/g",
        " ",
        "B",
        "k".repeat(LOREBOOK_LIMITS.maxKeyLength + 1),
      ]),
    ).toEqual({
      aliases: ["A", "B"],
      regexKeys: ["/x/g"],
      dropped: [" a", " ", "k".repeat(LOREBOOK_LIMITS.maxKeyLength + 1)],
    });
  });

  it.each([
    ["not json", /not valid JSON/],
    ["", /File content is required/],
    ["[]", /JSON object with an `entries` field/],
    [JSON.stringify({ entries: "nope" }), /`entries` field/],
    [JSON.stringify({ entries: {} }), /no entries/],
    [JSON.stringify({ entries: [1] }), /is not an object/],
    [JSON.stringify({ entries: [{ uid: 1 }, { uid: 1 }] }), /Duplicate entry uid/],
    [JSON.stringify({ entries: [{ content: 5 }] }), /"content" must be text/],
    [JSON.stringify({ entries: [{ comment: 5 }] }), /"comment" must be text/],
    [JSON.stringify({ entries: [{ key: [1] }] }), /"key" must be a list of strings/],
    [JSON.stringify({ entries: [{ keysecondary: {} }] }), /"keysecondary" must be a list/],
    [JSON.stringify({ entries: [{ keys: ["a"], content: "x", enabled: true }] }), /character_book/],
    ['{"entries":[{"__proto__":{"polluted":true}}]}', /Forbidden key "__proto__"/],
  ])("rejects malformed input %#", (raw, message) => {
    expect(() => parseLorebook(raw)).toThrow(message);
  });

  it("rejects non-string content, oversized files, deep nesting, long strings and too many entries", () => {
    expect(() => parseLorebook({ entries: [] })).toThrow(/File content is required/);
    const big = "x".repeat(LOREBOOK_LIMITS.maxFileBytes + 1);
    expect(() => parseLorebook(big)).toThrow(/exceeds/);
    let deep: unknown = "leaf";
    for (let i = 0; i < LOREBOOK_LIMITS.maxDepth + 2; i++) deep = [deep];
    expect(() => parseLorebook(JSON.stringify({ entries: [{ extensions: deep }] }))).toThrow(
      /nested too deeply/,
    );
    expect(() =>
      parseLorebook(
        JSON.stringify({ entries: [{ content: "y".repeat(LOREBOOK_LIMITS.maxStringLength + 1) }] }),
      ),
    ).toThrow(/exceeds/);
    const many = Array.from({ length: LOREBOOK_LIMITS.maxEntries + 1 }, () => ({}));
    expect(() => parseLorebook(JSON.stringify({ entries: many }))).toThrow(/more than/);
    const manyKeys = Array.from({ length: LOREBOOK_LIMITS.maxKeysPerEntry + 1 }, (_, i) => `k${i}`);
    expect(() => parseLorebook(JSON.stringify({ entries: [{ key: manyKeys }] }))).toThrow(
      /more than/,
    );
  });

  it("rejects oversized preserved metadata", () => {
    const blob = "z".repeat(20_000);
    expect(() =>
      parseLorebook(JSON.stringify({ description: blob, entries: [{ content: "x" }] })),
    ).toThrow(/Lorebook metadata exceeds/);
    expect(() =>
      parseLorebook(JSON.stringify({ entries: [{ extensions: { a: blob, b: blob } }] })),
    ).toThrow(/metadata exceeds/);
  });
});

describe("lorebook codec — serialize (STO-1262)", () => {
  const raw = book(
    {
      "7": stEntry(7, {
        key: ["Wolf", "/were(wolf)?/i"],
        keysecondary: ["moon"],
        extensions: { custom: { keep: true } },
        depth: 2,
      }),
      "9": stEntry(9, { constant: true, group: "weather" }),
    },
    { description: "A book", extensions: { tool: "x" } },
  );

  it("round-trips unedited entries semantically", () => {
    const parsed = parseLorebook(raw);
    const { lorebook, warnings } = serializeLorebook([
      sourceFromDraft(parsed, 0),
      sourceFromDraft(parsed, 1),
    ]);
    expect(warnings).toEqual([]);
    expect(lorebook).toMatchObject({
      name: "Test Book",
      description: "A book",
      extensions: { tool: "x" },
    });
    const entries = lorebook.entries as Record<string, Record<string, unknown>>;
    expect(Object.keys(entries)).toEqual(["0", "1"]);
    expect(entries["0"]).toMatchObject({
      uid: 0,
      key: ["Wolf", "/were(wolf)?/i"],
      keysecondary: ["moon"],
      comment: "Entry 7",
      content: "Content 7",
      constant: false,
      disable: false,
      depth: 2,
      extensions: { custom: { keep: true } },
    });
    expect(entries["1"]).toMatchObject({ constant: true, group: "weather", key: ["key9"] });

    // Re-importing the export yields the same normalized entries.
    const again = parseLorebook(JSON.stringify(lorebook));
    expect(again.preview.entries.map(({ sourceEntryKey: _k, ...e }) => e)).toEqual(
      parsed.preview.entries.map(({ sourceEntryKey: _k, ...e }) => e),
    );
  });

  it("overlays native edits without clobbering preserved fields", () => {
    const parsed = parseLorebook(raw);
    const { lorebook, warnings } = serializeLorebook([
      sourceFromDraft(parsed, 0, {
        name: "Werewolf",
        description: "Edited",
        aliases: ["Wolf", "Lycan"],
        trackingMode: "DETECTED",
      }),
    ]);
    const entry = (lorebook.entries as Record<string, Record<string, unknown>>)["0"];
    expect(entry).toMatchObject({
      comment: "Werewolf",
      content: "Edited",
      key: ["Wolf", "Lycan", "/were(wolf)?/i"],
      keysecondary: ["moon"],
      constant: false,
      disable: false,
      extensions: { custom: { keep: true } },
    });
    expect(warnings.map((w) => w.code)).toEqual(["ACTIVATION_SEMANTICS_DIFFER"]);
  });

  it("maps explicit activation edits to SillyTavern flags", () => {
    const parsed = parseLorebook(raw);
    const { lorebook } = serializeLorebook([
      sourceFromDraft(parsed, 1, { trackingMode: "NEVER" }),
      sourceFromDraft(parsed, 1, { id: "b", trackingMode: "DETECTED" }),
    ]);
    const entries = lorebook.entries as Record<string, Record<string, unknown>>;
    expect(entries["0"]).toMatchObject({ disable: true, constant: false });
    expect(entries["1"]).toMatchObject({ disable: false, constant: false });
  });

  it("exports native entries with defaults and flags invalid envelopes and mixed groups", () => {
    const parsed = parseLorebook(raw);
    const { lorebook, warnings } = serializeLorebook(
      [
        {
          id: "native",
          name: "Harbor",
          description: "A port",
          trackingMode: "ALWAYS",
          aliases: ["Port"],
          customFields: { mood: "grey" },
        },
        {
          id: "broken",
          name: "Broken",
          description: "",
          trackingMode: "NEVER",
          aliases: [],
          customFields: { [INTERCHANGE_ENVELOPE_KEY]: { schemaVersion: 99 } },
        },
        sourceFromDraft(parsed, 0, {}, "group-a"),
        sourceFromDraft(parsed, 1, {}, "group-b"),
      ],
      { name: "  Export name " },
    );
    const entries = lorebook.entries as Record<string, Record<string, unknown>>;
    expect(entries["0"]).toMatchObject({
      key: ["Port"],
      comment: "Harbor",
      content: "A port",
      constant: true,
      disable: false,
      probability: 100,
      selective: true,
    });
    expect(entries["1"]).toMatchObject({ disable: true });
    expect(lorebook.name).toBe("Export name");
    expect(lorebook).not.toHaveProperty("description");
    expect(warnings.map((w) => w.code)).toEqual(["ENVELOPE_INVALID", "MIXED_GROUPS"]);
  });

  it("handles string original keys and entries without a title", () => {
    const parsed = parseLorebook(JSON.stringify({ entries: [{ key: "Solo", content: "x" }] }));
    const { lorebook } = serializeLorebook([sourceFromDraft(parsed, 0)]);
    const entry = (lorebook.entries as Record<string, Record<string, unknown>>)["0"];
    expect(entry).toMatchObject({ key: ["Solo"], comment: "Solo" });
    const noKey = parseLorebook(JSON.stringify({ entries: [{ content: "x" }] }));
    const out = serializeLorebook([sourceFromDraft(noKey, 0)]);
    expect((out.lorebook.entries as Record<string, Record<string, unknown>>)["0"].key).toEqual([]);
  });
});

describe("interchange envelope validation (STO-1262)", () => {
  const envelope = {
    schemaVersion: 1,
    format: "sillytavern.lorebook",
    sourceVersion: "worldinfo",
    groupId: "g",
    sourceEntryKey: "1",
    sourceOrder: 0,
    originalEntry: {},
    bookMetadata: {},
    mappingVersion: 1,
    importedTrackingMode: "DETECTED",
    unsupportedFeatures: [],
  };

  it("reads valid envelopes and rejects malformed ones", () => {
    expect(readInterchangeEnvelope(null)).toEqual({ status: "absent" });
    expect(readInterchangeEnvelope({ other: 1 })).toEqual({ status: "absent" });
    expect(readInterchangeEnvelope({ [INTERCHANGE_ENVELOPE_KEY]: envelope }).status).toBe("ok");
    for (const bad of [
      "x",
      { ...envelope, format: "other" },
      { ...envelope, importedTrackingMode: "SOMETIMES" },
      { ...envelope, unsupportedFeatures: [1] },
      { ...envelope, originalEntry: [] },
    ]) {
      expect(readInterchangeEnvelope({ [INTERCHANGE_ENVELOPE_KEY]: bad }).status).toBe("invalid");
    }
  });

  it("strips client envelopes and carries over the stored one", () => {
    expect(stripReservedEnvelope(undefined)).toBeUndefined();
    expect(stripReservedEnvelope({ a: 1 })).toEqual({ a: 1 });
    expect(stripReservedEnvelope({ a: 1, [INTERCHANGE_ENVELOPE_KEY]: {} })).toEqual({ a: 1 });
    expect(
      protectReservedEnvelope({ a: 1, [INTERCHANGE_ENVELOPE_KEY]: { forged: true } }, null),
    ).toEqual({ a: 1 });
    expect(protectReservedEnvelope(null, { [INTERCHANGE_ENVELOPE_KEY]: envelope, b: 2 })).toEqual({
      [INTERCHANGE_ENVELOPE_KEY]: envelope,
    });
    expect(
      protectReservedEnvelope(
        { a: 1, [INTERCHANGE_ENVELOPE_KEY]: { forged: true } },
        { [INTERCHANGE_ENVELOPE_KEY]: envelope },
      ),
    ).toEqual({ a: 1, [INTERCHANGE_ENVELOPE_KEY]: envelope });
  });

  it("parseBoundedJson rejects constructor/prototype keys", () => {
    const limits = { maxFileBytes: 1000, maxDepth: 5, maxStringLength: 100 };
    expect(() => parseBoundedJson('{"constructor":{}}', limits)).toThrow(/Forbidden key/);
    expect(() => parseBoundedJson('{"a":{"prototype":1}}', limits)).toThrow(/Forbidden key/);
    expect(parseBoundedJson('{"a":[1,"b",null]}', limits)).toEqual({ a: [1, "b", null] });
  });
});
