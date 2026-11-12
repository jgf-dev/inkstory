import { describe, expect, it } from "vite-plus/test";
import {
  overlayCharacterBook,
  parseCharacterCard,
  serializeCharacterCard,
} from "../src/lib/codex/interchange/character-card";
import {
  getInterchangeMatrix,
  V1_INTERCHANGE_MATRIX,
  V1_INTERCHANGE_POLICY,
} from "../src/lib/codex/interchange/matrix";
import {
  INTERCHANGE_ENVELOPE_KEY,
  type CardExportSource,
  type InterchangeObject,
  type LorebookExportSource,
} from "../src/lib/codex/interchange/types";

const cardJson = JSON.stringify({
  spec: "chara_card_v2",
  spec_version: "2.0",
  data: {
    name: "Kaelen Voss",
    description: "Sentry warden.",
    personality: "Watchful",
    character_book: {
      name: "Outpost",
      entries: [
        {
          keys: ["Bastion"],
          content: "Ancient rampart",
          enabled: true,
          insertion_order: 1,
          id: 21,
        },
        {
          keys: ["Wildfire"],
          secondary_keys: ["embers"],
          selective: true,
          content: "Sudden blaze",
          enabled: true,
          insertion_order: 2,
          comment: "Blaze",
          id: 22,
          extensions: { probability: 40, sticky: 3 },
        },
      ],
    },
  },
});

function loreSource(
  sourceEntryKey: string,
  overrides: Partial<LorebookExportSource> & {
    importedTrackingMode?: LorebookExportSource["trackingMode"];
    unsupportedFeatures?: string[];
  } = {},
): LorebookExportSource {
  const {
    importedTrackingMode = "DETECTED",
    unsupportedFeatures = [],
    customFields: _ignored,
    ...rest
  } = overrides;
  return {
    id: `book-${sourceEntryKey}`,
    name: "Bastion",
    description: "Ancient rampart",
    trackingMode: "DETECTED",
    aliases: ["Bastion"],
    customFields: {
      [INTERCHANGE_ENVELOPE_KEY]: {
        schemaVersion: 1,
        format: "sillytavern.lorebook",
        sourceVersion: "character_book",
        groupId: "g1",
        sourceEntryKey,
        sourceOrder: Number(sourceEntryKey) || 0,
        originalEntry: { key: ["Bastion"], comment: "Bastion" },
        bookMetadata: { name: "Outpost" },
        mappingVersion: 1,
        importedTrackingMode,
        unsupportedFeatures,
      },
    },
    ...rest,
  };
}

function cardSource(extra: object, overrides: Partial<CardExportSource> = {}): CardExportSource {
  const parsed = parseCharacterCard({ encoding: "json", content: cardJson });
  return {
    id: "card-1",
    name: "Kaelen Voss",
    description: "Sentry warden.",
    type: "CHARACTER",
    aliases: [],
    tags: [],
    customFields: {
      [INTERCHANGE_ENVELOPE_KEY]: {
        schemaVersion: 1,
        format: "character_card",
        sourceVersion: "v2",
        sourceEncoding: "json",
        groupId: "g1",
        originalCard: parsed.originalCard,
        mappingVersion: 1,
        embeddedBookImported: true,
        ...extra,
      },
    },
    ...overrides,
  };
}

describe("STO-1261 interchange variant matrix", () => {
  it("exposes the EL-approved v1 support and deferral contract", () => {
    const document = getInterchangeMatrix();
    expect(document.schemaVersion).toBe(1);
    expect(document.policy).toEqual(V1_INTERCHANGE_POLICY);
    expect(document.matrix).toEqual(V1_INTERCHANGE_MATRIX);

    const byId = Object.fromEntries(document.matrix.map((row) => [row.id, row]));
    expect(byId["sillytavern.lorebook"]).toMatchObject({
      import: "supported",
      export: "supported",
    });
    expect(byId["character_card.v2.json"]).toMatchObject({
      import: "supported",
      export: "supported",
    });
    expect(byId["character_card.v2.png"]).toMatchObject({
      import: "supported",
      export: "supported",
    });
    expect(byId["character_card.yaml"]).toMatchObject({
      import: "supported",
      export: "unsupported",
    });
    expect(byId["character_card.v1"]).toMatchObject({ import: "supported", export: "partial" });
    expect(byId["character_card.v3"]).toMatchObject({ import: "partial", export: "partial" });
    expect(byId["other.janitor-tavern"]).toMatchObject({
      import: "unsupported",
      export: "unsupported",
    });

    expect(document.policy).toMatchObject({
      newTables: false,
      importMode: "create-copy",
      fuzzyNameOverwrite: false,
      roundTrip: "semantic",
      portraits: "author-supplied-at-export",
      portraitObjectStorage: false,
      fetchPortraitUrls: false,
      unsupportedActivationImportsAs: "NEVER",
      disabledEntriesStay: "NEVER",
      secondaryKeysBecomeAliases: false,
      systemPromptsBecomeInstructions: false,
      embeddedBookImport: "opt-in",
      embeddedBookRuntimeEdges: false,
      embeddedBookEditsOverlaidOnExport: true,
      durableEmptyBookArchival: false,
    });
  });

  it("does not claim an overlay when no embedded book entry is still live", () => {
    const parsed = parseCharacterCard({ encoding: "json", content: cardJson });
    const book = (parsed.originalCard.data as InterchangeObject)
      .character_book as InterchangeObject;
    const { warnings } = overlayCharacterBook(book, []);

    const codes = warnings.map((w) => w.code);
    expect(codes).not.toContain("EMBEDDED_BOOK_OVERLAID");
    expect(codes.every((code) => code === "EMBEDDED_BOOK_ENTRY_MISSING")).toBe(true);
  });

  it("overlays Codex edits onto a preserved character_book and keeps missing entries", () => {
    const parsed = parseCharacterCard({ encoding: "json", content: cardJson });
    const book = (parsed.originalCard.data as InterchangeObject)
      .character_book as InterchangeObject;
    const { book: overlaid, warnings } = overlayCharacterBook(book, [
      loreSource("21", {
        name: "North Bastion",
        description: "Reinforced rampart",
        aliases: ["Bastion", "Redoubt"],
        trackingMode: "ALWAYS",
      }),
    ]);

    expect(warnings.map((w) => w.code)).toEqual([
      "EMBEDDED_BOOK_OVERLAID",
      "EMBEDDED_BOOK_ENTRY_MISSING",
    ]);
    const entries = overlaid.entries as InterchangeObject[];
    expect(entries[0]).toMatchObject({
      comment: "North Bastion",
      content: "Reinforced rampart",
      keys: ["Bastion", "Redoubt"],
      constant: true,
      enabled: true,
      id: 21,
    });
    expect(entries[1]).toMatchObject({
      comment: "Blaze",
      content: "Sudden blaze",
      keys: ["Wildfire"],
      id: 22,
    });
  });

  it("serializeCharacterCard overlays supplied book entries and warns when they are omitted", () => {
    const withoutSources = serializeCharacterCard(cardSource({}));
    expect(withoutSources.warnings.map((w) => w.code)).toEqual(["EMBEDDED_BOOK_FROM_IMPORT"]);
    expect(
      ((withoutSources.card.data as InterchangeObject).character_book as InterchangeObject)
        .entries as InterchangeObject[],
    ).toMatchObject([{ content: "Ancient rampart" }, { content: "Sudden blaze" }]);

    const blaze = loreSource("22", {
      name: "Inferno",
      description: "Intense blaze",
      aliases: ["Wildfire"],
      trackingMode: "DETECTED",
      importedTrackingMode: "NEVER",
      unsupportedFeatures: ["secondaryKeys", "probability", "sticky"],
    });
    const withSources = serializeCharacterCard(
      cardSource(
        {},
        {
          embeddedBookEntries: [
            loreSource("21", {
              name: "North Bastion",
              description: "Reinforced rampart",
              aliases: ["Bastion"],
              trackingMode: "ALWAYS",
            }),
            blaze,
          ],
        },
      ),
    );
    expect(withSources.warnings.map((w) => w.code)).toEqual([
      "EMBEDDED_BOOK_OVERLAID",
      "ACTIVATION_SEMANTICS_DIFFER",
    ]);
    const entries = (
      (withSources.card.data as InterchangeObject).character_book as InterchangeObject
    ).entries as InterchangeObject[];
    expect(entries[0]).toMatchObject({
      comment: "North Bastion",
      content: "Reinforced rampart",
      constant: true,
    });
    expect(entries[1]).toMatchObject({
      comment: "Inferno",
      content: "Intense blaze",
      enabled: true,
      keys: ["Wildfire"],
    });
  });
});
