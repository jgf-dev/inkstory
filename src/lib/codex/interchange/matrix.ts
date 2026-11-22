/**
 * Agreed V1 Codex interchange variant matrix and policy (STO-1261).
 *
 * Codecs and routes live in STO-1262 (lorebook) and STO-1263 (character cards).
 * This module is the coordination contract those implementations, the future
 * import/export dialog, and the acceptance tests all share. It records the
 * Engineering Lead approval of 2026-11-08; it does not invent new variants.
 */
export type InterchangeSupport = "supported" | "partial" | "unsupported";

export interface InterchangeVariant {
  id: string;
  label: string;
  /** How the variant is recognized. */
  detect: string;
  import: InterchangeSupport;
  export: InterchangeSupport;
  notes: string;
}

const VARIANT_DEFINITIONS: readonly (readonly [
  id: string,
  label: string,
  detect: string,
  imp: InterchangeSupport,
  exp: InterchangeSupport,
  notes: string,
])[] = [
  [
    "sillytavern.lorebook",
    "SillyTavern lorebook JSON",
    "JSON object with `entries` as an object or an array (World Info).",
    "supported",
    "supported",
    "Semantic round trip, not byte-identical. Primary keys become aliases. Unsupported activation (secondary keys, regex, probability, sticky/cooldown/delay, delayed recursion, vectorized) imports as NEVER until the author picks DETECTED or ALWAYS. Disabled entries stay NEVER. ST inclusion groups are not mapped to tags.",
  ],
  [
    "character_card.v2.json",
    "Character Card V2 JSON",
    '`spec` is "chara_card_v2" (or equivalent V2 `spec_version`).',
    "supported",
    "supported",
    "Name and description map natively. All other data fields, extensions and the embedded character_book are preserved in the interchange envelope. Export writes V2 JSON.",
  ],
  [
    "character_card.v2.png",
    "Character Card V2 PNG",
    "PNG with a `chara` tEXt chunk holding base64 V2 JSON.",
    "supported",
    "supported",
    "Same mapping as V2 JSON. Export embeds the card in a PNG the author uploads. The original portrait is not stored (no object storage in this slice). Browser-provided portrait URLs are never fetched. Compressed `zTXt`/`iTXt` card chunks are rejected.",
  ],
  [
    "character_card.yaml",
    "Character card YAML",
    "YAML document of a known V1/V2/V3 card shape.",
    "supported",
    "unsupported",
    "Import only. Data-only parse: core schema, one document, unique keys, no custom tags, no anchors or aliases. Export is always V2 JSON or PNG.",
  ],
  [
    "character_card.v1",
    "Legacy Character Card V1",
    "Flat name/description/personality fields without a V2/V3 `spec`.",
    "supported",
    "partial",
    "Mapped when every known field is unambiguous text; otherwise rejected with a clear error (never silently relabeled as V2 on import). Export writes Character Card V2 and adds a LEGACY_V1_CARD warning.",
  ],
  [
    "character_card.v3",
    "Character Card V3",
    '`spec` is "chara_card_v3", or a PNG `ccv3` tEXt chunk (takes priority over `chara`).',
    "partial",
    "partial",
    "Name, description and the embedded book are mapped; every other field is preserved (V3_PARTIAL_SUPPORT). Export writes V2 and lists V3-only fields that are left out (V3_FIELDS_NOT_EXPORTED). This is not a claim of full V3 support.",
  ],
  [
    "other.janitor-tavern",
    "Other Janitor / Tavern variants",
    "Any other card or lorebook shape, or a `data` object with no recognized `spec`.",
    "unsupported",
    "unsupported",
    "Rejected with a clear 422. There is no universal Janitor or Tavern compatibility promise in v1.",
  ],
];

/**
 * V1 variant matrix. "partial" means we detect, map what is approved, and
 * preserve or warn about the rest — not a claim of full compatibility.
 */
export const V1_INTERCHANGE_MATRIX: readonly InterchangeVariant[] = VARIANT_DEFINITIONS.map(
  ([id, label, detect, imp, exp, notes]) => ({
    id,
    label,
    detect,
    import: imp,
    export: exp,
    notes,
  }),
);

/** Cross-cutting v1 policy that applies to every supported variant. */
export const V1_INTERCHANGE_POLICY = {
  schemaVersion: 1,
  persistence: "existing CodexEntry rows; reserved customFields._inkstoryInterchange envelope",
  newTables: false,
  importMode: "create-copy",
  fuzzyNameOverwrite: false,
  selectedEntryUpdate: false,
  transactionalBatch: true,
  roundTrip: "semantic",
  durableEmptyBookArchival: false,
  portraits: "author-supplied-at-export",
  portraitObjectStorage: false,
  fetchPortraitUrls: false,
  unsupportedActivationImportsAs: "NEVER",
  disabledEntriesStay: "NEVER",
  secondaryKeysBecomeAliases: false,
  systemPromptsBecomeInstructions: false,
  embeddedBookImport: "opt-in",
  embeddedBookRuntimeEdges: false,
  /**
   * When the author opted in to importing the embedded book, card export
   * overlays current Codex name, description, aliases and activation onto the
   * preserved character_book. Unimported books are exported as preserved.
   */
  embeddedBookEditsOverlaidOnExport: true,
  assemblerConsumes: ["name", "description", "aliases"],
} as const;

export interface InterchangeMatrixDocument {
  schemaVersion: 1;
  matrix: readonly InterchangeVariant[];
  policy: typeof V1_INTERCHANGE_POLICY;
}

export function getInterchangeMatrix(): InterchangeMatrixDocument {
  return {
    schemaVersion: 1,
    matrix: V1_INTERCHANGE_MATRIX,
    policy: V1_INTERCHANGE_POLICY,
  };
}
