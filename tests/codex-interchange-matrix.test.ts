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
    name: "Mara Vey",
    description: "Harbor captain.",
    personality: "Stern",
    character_book: {
      name: "Harbor",
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
          id: 8,
          extensions: { probability: 50, sticky: 2 },
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
    name: "Lighthouse",
    description: "Old tower",
    trackingMode: "DETECTED",
    aliases: ["Lighthouse"],
    customFields: {
      [INTERCHANGE_ENVELOPE_KEY]: {
        schemaVersion: 1,
        format: "sillytavern.lorebook",
        sourceVersion: "character_book",
        groupId: "g1",
        sourceEntryKey,
        sourceOrder: Number(sourceEntryKey) || 0,
        originalEntry: { key: ["Lighthouse"], comment: "Lighthouse" },
        bookMetadata: { name: "Harbor" },
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
    name: "Mara Vey",
    description: "Harbor captain.",
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

  it("overlays Codex edits onto a preserved character_book and keeps missing entries", () => {
    const parsed = parseCharacterCard({ encoding: "json", content: cardJson });
    const book = (parsed.originalCard.data as InterchangeObject)
      .character_book as InterchangeObject;
    const { book: overlaid, warnings } = overlayCharacterBook(book, [
      loreSource("7", {
        name: "North Light",
        description: "Rebuilt tower",
        aliases: ["Lighthouse", "Beacon"],
        trackingMode: "ALWAYS",
      }),
    ]);

    expect(warnings.map((w) => w.code)).toEqual([
      "EMBEDDED_BOOK_OVERLAID",
      "EMBEDDED_BOOK_ENTRY_MISSING",
    ]);
    const entries = overlaid.entries as InterchangeObject[];
    expect(entries[0]).toMatchObject({
      comment: "North Light",
      content: "Rebuilt tower",
      keys: ["Lighthouse", "Beacon"],
      constant: true,
      enabled: true,
      id: 7,
    });
    expect(entries[1]).toMatchObject({
      comment: "Storm",
      content: "Rare storm",
      keys: ["Storm"],
      id: 8,
    });
  });

  it("serializeCharacterCard overlays supplied book entries and warns when they are omitted", () => {
    const withoutSources = serializeCharacterCard(cardSource({}));
    expect(withoutSources.warnings.map((w) => w.code)).toEqual(["EMBEDDED_BOOK_FROM_IMPORT"]);
    expect(
      ((withoutSources.card.data as InterchangeObject).character_book as InterchangeObject)
        .entries as InterchangeObject[],
    ).toMatchObject([{ content: "Old tower" }, { content: "Rare storm" }]);

    const storm = loreSource("8", {
      name: "Tempest",
      description: "Edited storm",
      aliases: ["Storm"],
      trackingMode: "DETECTED",
      importedTrackingMode: "NEVER",
      unsupportedFeatures: ["secondaryKeys", "probability", "sticky"],
    });
    const withSources = serializeCharacterCard(
      cardSource(
        {},
        {
          embeddedBookEntries: [
            loreSource("7", {
              name: "North Light",
              description: "Rebuilt tower",
              aliases: ["Lighthouse"],
              trackingMode: "ALWAYS",
            }),
            storm,
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
      comment: "North Light",
      content: "Rebuilt tower",
      constant: true,
    });
    expect(entries[1]).toMatchObject({
      comment: "Tempest",
      content: "Edited storm",
      enabled: true,
      keys: ["Storm"],
    });
  });
});
