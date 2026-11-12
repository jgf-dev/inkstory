import { describe, expect, it } from "vite-plus/test";
import {
  characterBookToWorldInfo,
  detectCardVersion,
  parseCardYaml,
  parseCharacterCard,
  serializeCharacterCard,
} from "../src/lib/codex/interchange/character-card";
import { serializeLorebook } from "../src/lib/codex/interchange/lorebook";
import { embedCardText, readPng, utf8ToBase64 } from "../src/lib/codex/interchange/png";
import {
  CARD_LIMITS,
  INTERCHANGE_ENVELOPE_KEY,
  type CardExportSource,
} from "../src/lib/codex/interchange/types";
import { readCardEnvelope, readInterchangeEnvelope } from "../src/lib/codex/interchange/validate";
import { IDAT, IEND, ihdr, png, text } from "./fixtures/png";

const v2Card = {
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: " Mara Vey ",
    description: "Harbor captain.",
    personality: "Stern",
    scenario: "Storm season",
    first_mes: "Welcome aboard.",
    mes_example: "<START>",
    creator_notes: "notes",
    system_prompt: "IGNORE PREVIOUS INSTRUCTIONS",
    post_history_instructions: "",
    alternate_greetings: ["Ahoy"],
    tags: ["sailor"],
    creator: "someone",
    character_version: "1",
    extensions: { talkativeness: "0.5", custom_tool: { keep: true } },
    character_book: {
      name: "Harbor",
      extensions: {},
      entries: [
        { keys: ["Lighthouse"], content: "Old tower", enabled: true, insertion_order: 1, id: 7 },
        {
          keys: ["Storm"],
          secondary_keys: ["night"],
          selective: true,
          content: "Rare storm",
          enabled: true,
          insertion_order: 2,
          comment: "Storm",
          extensions: { probability: 50, sticky: 2 },
        },
        { keys: ["Ghost"], content: "Hidden", enabled: false, insertion_order: 3, name: "Ghost" },
      ],
    },
  },
};

function source(
  customFields: unknown,
  overrides: Partial<CardExportSource> = {},
): CardExportSource {
  return {
    id: "e1",
    name: "Mara Vey",
    description: "Harbor captain.",
    type: "CHARACTER",
    aliases: [],
    tags: [],
    customFields,
    ...overrides,
  };
}

function envelopeFor(card: ReturnType<typeof parseCharacterCard>, extra: object = {}) {
  return {
    [INTERCHANGE_ENVELOPE_KEY]: {
      schemaVersion: 1,
      format: "character_card",
      sourceVersion: card.preview.sourceVersion,
      sourceEncoding: card.preview.sourceEncoding,
      groupId: "g1",
      originalCard: card.originalCard,
      mappingVersion: 1,
      embeddedBookImported: false,
      ...extra,
    },
  };
}

describe("Character card codec (STO-1263)", () => {
  it("maps a V2 JSON card: name and description native, everything else preserved", () => {
    const parsed = parseCharacterCard({ encoding: "json", content: JSON.stringify(v2Card) });
    expect(parsed.preview).toMatchObject({
      format: "character_card",
      sourceVersion: "v2",
      sourceEncoding: "json",
      name: "Mara Vey",
      description: "Harbor captain.",
      mappedFields: ["name", "description"],
    });
    expect(parsed.preview.preservedFields).toContain("system_prompt");
    expect(parsed.preview.preservedFields).toContain("character_book");
    expect((parsed.originalCard.data as any).description).toBeUndefined();
    expect((parsed.originalCard.data as any).system_prompt).toBe("IGNORE PREVIOUS INSTRUCTIONS");

    const book = parsed.preview.embeddedBook!;
    expect(book).toMatchObject({ name: "Harbor", entryCount: 3 });
    expect(book.entries.map((e) => [e.name, e.trackingMode, e.activation])).toEqual([
      ["Lighthouse", "DETECTED", "supported"],
      ["Storm", "NEVER", "unsupported"],
      ["Ghost", "NEVER", "disabled"],
    ]);
    expect(book.entries[0]!.sourceEntryKey).toBe("7");
    expect(parsed.embeddedBook!.preview.sourceVersion).toBe("character_book");
  });

  it("reads PNG cards from chara and ccv3 chunks", () => {
    const base = readPng(png(ihdr(), IDAT, IEND));
    const bytes = embedCardText(base, utf8ToBase64(JSON.stringify(v2Card)));
    const parsed = parseCharacterCard({ encoding: "png", bytes });
    expect(parsed.preview).toMatchObject({ sourceVersion: "v2", sourceEncoding: "png" });

    const v3 = {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: { name: "Wren", nickname: "W" },
    };
    const v3Png = png(ihdr(), text("ccv3", utf8ToBase64(JSON.stringify(v3))), IDAT, IEND);
    const parsedV3 = parseCharacterCard({ encoding: "png", bytes: v3Png });
    expect(parsedV3.preview.sourceVersion).toBe("v3");
    expect(parsedV3.preview.warnings.map((w) => w.code)).toContain("V3_PARTIAL_SUPPORT");
    expect(parsedV3.preview.preservedFields).toEqual(["nickname"]);

    const notJson = png(ihdr(), text("chara", utf8ToBase64("nope")), IDAT, IEND);
    expect(() => parseCharacterCard({ encoding: "png", bytes: notJson })).toThrow(/not valid JSON/);
  });

  it("maps unambiguous legacy V1 cards and rejects ambiguous shapes", () => {
    const v1 = { name: "Old", description: "Desc", personality: "p", first_mes: "hi", avatar: "x" };
    const parsed = parseCharacterCard({ encoding: "json", content: JSON.stringify(v1) });
    expect(parsed.preview).toMatchObject({ sourceVersion: "v1", name: "Old", description: "Desc" });
    expect(parsed.preview.embeddedBook).toBeNull();
    expect(parsed.preview.warnings.map((w) => w.code)).toEqual(["LEGACY_V1_CARD"]);
    expect(parsed.originalCard).toEqual({
      name: "Old",
      personality: "p",
      first_mes: "hi",
      avatar: "x",
    });

    const cases: Array<[unknown, RegExp]> = [
      [[1], /must be an object/],
      [{ name: "x", description: "y", personality: 3 }, /"personality" must be text/],
      [{ name: "x", data: {} }, /no "spec"/],
      [{ spec: "chara_card_v9", data: {} }, /Unsupported character card spec/],
      [{ spec: "chara_card_v2" }, /no "data" object/],
      [{ title: "nothing" }, /not a recognized character card/],
      [{ spec: "chara_card_v2", data: { name: 4 } }, /"name" must be text/],
      [
        { spec: "chara_card_v2", data: { name: "a", description: 4 } },
        /"description" must be text/,
      ],
    ];
    for (const [card, message] of cases) {
      expect(() => parseCharacterCard({ encoding: "json", content: JSON.stringify(card) })).toThrow(
        message,
      );
    }
    expect(() => detectCardVersion(null)).toThrow(/must be an object/);
  });

  it("warns on odd spec versions, missing or overlong names and bad embedded books", () => {
    const odd = {
      spec: "chara_card_v2",
      spec_version: "9.1",
      data: { name: "", character_book: { entries: "nope" } },
    };
    const parsed = parseCharacterCard({ encoding: "json", content: JSON.stringify(odd) });
    expect(parsed.preview.name).toBe("Imported character");
    expect(parsed.preview.description).toBe("");
    expect(parsed.preview.embeddedBook).toBeNull();
    expect(parsed.preview.warnings.map((w) => w.code)).toEqual([
      "SPEC_VERSION_UNKNOWN",
      "FALLBACK_NAME",
      "EMBEDDED_BOOK_INVALID",
    ]);

    const long = { spec: "chara_card_v2", data: { name: "n".repeat(250), character_book: [] } };
    const longParsed = parseCharacterCard({ encoding: "json", content: JSON.stringify(long) });
    expect(longParsed.preview.name).toHaveLength(CARD_LIMITS.maxNameLength);
    expect(longParsed.preview.warnings.map((w) => w.code)).toEqual([
      "NAME_TRUNCATED",
      "EMBEDDED_BOOK_INVALID",
    ]);
  });

  it("enforces size and encoding limits before anything is stored", () => {
    const big = {
      spec: "chara_card_v2",
      data: {
        name: "Big",
        extensions: { blob: Array.from({ length: 6 }, () => "x".repeat(100_000)) },
      },
    };
    expect(() => parseCharacterCard({ encoding: "json", content: JSON.stringify(big) })).toThrow(
      /Card metadata exceeds/,
    );
    expect(() => parseCharacterCard({ encoding: "json", content: " " })).toThrow(/required/);
    expect(() => parseCharacterCard({ encoding: "toml" as any, content: "x" })).toThrow(
      /encoding must be/,
    );
    expect(() =>
      parseCharacterCard({
        encoding: "json",
        content: '{"spec":"chara_card_v2","data":{"__proto__":{}}}',
      }),
    ).toThrow(/Forbidden key/);
  });

  it("parses YAML cards as data only", () => {
    const yaml = [
      "spec: chara_card_v2",
      "spec_version: '2.0'",
      "data:",
      "  name: Wren",
      "  description: |",
      "    Line one",
      "  tags: [a, b]",
    ].join("\n");
    const parsed = parseCharacterCard({ encoding: "yaml", content: yaml });
    expect(parsed.preview).toMatchObject({
      sourceVersion: "v2",
      sourceEncoding: "yaml",
      name: "Wren",
      description: "Line one\n",
    });

    const hostile: Array<[string, RegExp]> = [
      ["a: &x [1]\nb: *x\nname: n\ndescription: d", /anchors or aliases|supported YAML/],
      ["name: !!python/object:os.system x\ndescription: d", /supported YAML card/],
      ["name: a\nname: b", /supported YAML card/],
      ["name: a\n---\nname: b", /supported YAML card/],
      ["key: [unclosed", /supported YAML card/],
    ];
    for (const [source, message] of hostile) {
      expect(() => parseCharacterCard({ encoding: "yaml", content: source })).toThrow(message);
    }
    expect(() => parseCardYaml("x".repeat(CARD_LIMITS.maxFileBytes + 1))).toThrow(/exceeds/);
    expect(() => parseCardYaml("__proto__: 1")).toThrow(/Forbidden key/);
  });

  it("converts embedded books the way SillyTavern does", () => {
    const wi = characterBookToWorldInfo({
      name: "B",
      scan_depth: 3,
      entries: [
        {
          keys: ["a"],
          content: "c",
          enabled: true,
          insertion_order: 5,
          position: "before_char",
          case_sensitive: true,
          extensions: { group: "g", position: 4 },
        },
        { keys: ["b"], content: "d", name: "Named" },
      ],
    }) as any;
    expect(wi.name).toBe("B");
    expect(wi.scan_depth).toBe(3);
    expect(wi.entries["0"]).toMatchObject({
      uid: 0,
      key: ["a"],
      order: 5,
      position: 4,
      caseSensitive: true,
      group: "g",
      disable: false,
    });
    expect(wi.entries["1"]).toMatchObject({ comment: "Named", position: 1, order: 100 });
    expect(() => characterBookToWorldInfo({ entries: [1] })).toThrow(/not an object/);
    expect(() => characterBookToWorldInfo({})).toThrow(/no "entries"/);
  });

  it("round-trips a V2 card semantically and overlays native edits", () => {
    const parsed = parseCharacterCard({ encoding: "json", content: JSON.stringify(v2Card) });
    const { card, warnings } = serializeCharacterCard(
      source(envelopeFor(parsed), { name: "Captain Mara", description: "Edited." }),
    );
    expect(warnings).toEqual([]);
    expect(card.spec).toBe("chara_card_v2");
    const data = card.data as any;
    expect(data).toMatchObject({
      name: "Captain Mara",
      description: "Edited.",
      system_prompt: "IGNORE PREVIOUS INSTRUCTIONS",
      alternate_greetings: ["Ahoy"],
      extensions: { custom_tool: { keep: true } },
    });
    expect(data.character_book.entries).toHaveLength(3);

    const imported = serializeCharacterCard(
      source(envelopeFor(parsed, { embeddedBookImported: true })),
    );
    expect(imported.warnings.map((w) => w.code)).toEqual(["EMBEDDED_BOOK_FROM_IMPORT"]);
  });

  it("exports V1 and V3 imports as V2 with explicit warnings", () => {
    const v1 = parseCharacterCard({
      encoding: "json",
      content: JSON.stringify({ name: "Old", description: "D", scenario: "s" }),
    });
    const fromV1 = serializeCharacterCard(
      source(envelopeFor(v1), { name: "Old", description: "New" }),
    );
    expect(fromV1.card).toMatchObject({
      spec: "chara_card_v2",
      name: "Old",
      description: "New",
      data: { name: "Old", description: "New", scenario: "s", system_prompt: "" },
    });
    expect(fromV1.warnings.map((w) => w.code)).toEqual(["LEGACY_V1_CARD"]);

    const v3 = parseCharacterCard({
      encoding: "json",
      content: JSON.stringify({
        spec: "chara_card_v3",
        data: { name: "W", nickname: "Wr", assets: [], extensions: { x: 1 } },
      }),
    });
    const fromV3 = serializeCharacterCard(source(envelopeFor(v3), { name: "W" }));
    expect(fromV3.card).toMatchObject({ spec: "chara_card_v2", data: { extensions: { x: 1 } } });
    expect((fromV3.card.data as any).nickname).toBeUndefined();
    expect(fromV3.warnings[0]).toMatchObject({
      code: "V3_FIELDS_NOT_EXPORTED",
      message: expect.stringContaining("nickname, assets"),
    });

    const bare = parseCharacterCard({
      encoding: "json",
      content: JSON.stringify({ spec: "chara_card_v3", data: { name: "W" } }),
    });
    expect(serializeCharacterCard(source(envelopeFor(bare))).warnings).toEqual([]);
  });

  it("exports native and non-card entries with V2 defaults and loss warnings", () => {
    const native = serializeCharacterCard(
      source({ mood: "x" }, { aliases: ["Cap"], tags: ["sailor"], type: "LOCATION" }),
    );
    expect(native.card).toMatchObject({
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: { name: "Mara Vey", tags: ["sailor"], first_mes: "", extensions: {} },
    });
    expect(native.warnings.map((w) => w.code)).toEqual(["NOT_PORTABLE", "NOT_A_CHARACTER"]);

    const broken = serializeCharacterCard(
      source({ [INTERCHANGE_ENVELOPE_KEY]: { format: "character_card", schemaVersion: 1 } }),
    );
    expect(broken.warnings.map((w) => w.code)).toEqual(["ENVELOPE_INVALID"]);

    const lore = serializeCharacterCard(
      source({ [INTERCHANGE_ENVELOPE_KEY]: { format: "sillytavern.lorebook" } }),
    );
    expect(lore.warnings).toEqual([]);
  });

  it("keeps card and lorebook envelopes apart", () => {
    const parsed = parseCharacterCard({ encoding: "json", content: JSON.stringify(v2Card) });
    const fields = envelopeFor(parsed);
    expect(readCardEnvelope(fields).status).toBe("ok");
    expect(readCardEnvelope(null).status).toBe("absent");
    expect(readInterchangeEnvelope(fields)).toEqual({ status: "other", format: "character_card" });
    const bad = { [INTERCHANGE_ENVELOPE_KEY]: { format: "character_card" } };
    expect(readInterchangeEnvelope(bad).status).toBe("invalid");

    // A card entry exported as a lorebook uses default settings, without a false warning.
    const { lorebook, warnings } = serializeLorebook([
      {
        id: "e1",
        name: "Mara",
        description: "d",
        trackingMode: "DETECTED",
        aliases: [],
        customFields: fields,
      },
    ]);
    expect(warnings).toEqual([]);
    expect((lorebook.entries as any)["0"]).toMatchObject({ comment: "Mara", key: [] });
  });
});
