/**
 * Codex interchange types (STO-1261 / STO-1262 / STO-1263).
 *
 * Third-party metadata is preserved in a reserved, versioned namespace of the
 * existing `CodexEntry.customFields` JSON (`_inkstoryInterchange`). No new
 * tables or columns (EL approval, 2026-11-08).
 */

import type { CodexTrackingMode, CodexType, JsonValue } from "../types";

export const INTERCHANGE_ENVELOPE_KEY = "_inkstoryInterchange";
export const INTERCHANGE_SCHEMA_VERSION = 1;

export const LOREBOOK_FORMAT = "sillytavern.lorebook";
export const LOREBOOK_MAPPING_VERSION = 1;

/** Hard caps applied before anything touches the database. */
export const LOREBOOK_LIMITS = {
  /** Raw file size (UTF-8 bytes). */
  maxFileBytes: 2 * 1024 * 1024,
  maxEntries: 1000,
  /** Maximum JSON nesting depth anywhere in the file. */
  maxDepth: 32,
  /** Maximum length of any single string value (entry content included). */
  maxStringLength: 100_000,
  maxKeysPerEntry: 100,
  maxKeyLength: 200,
  maxNameLength: 200,
  /** Serialized size of one preserved entry (content excluded). */
  maxOriginalEntryBytes: 32 * 1024,
  /** Serialized size of the preserved book-level metadata snapshot. */
  maxBookMetadataBytes: 16 * 1024,
} as const;

export type InterchangeObject = { [key: string]: JsonValue };

/** Lorebook features that inkstory cannot honor at generation time. */
export type LorebookFeature =
  // Blocking: the entry's activation depends on them, so it imports as NEVER.
  | "secondaryKeys"
  | "regexKeys"
  | "probability"
  | "sticky"
  | "cooldown"
  | "delay"
  | "delayUntilRecursion"
  | "vectorized"
  // Preserved-only: kept for export, no effect in inkstory.
  | "recursionFlags"
  | "inclusionGroup"
  | "matchOptions"
  | "scanDepth"
  | "automation";

export const BLOCKING_LOREBOOK_FEATURES: ReadonlySet<LorebookFeature> = new Set([
  "secondaryKeys",
  "regexKeys",
  "probability",
  "sticky",
  "cooldown",
  "delay",
  "delayUntilRecursion",
  "vectorized",
]);

/** Stored under `customFields._inkstoryInterchange` on each imported entry. */
export interface InterchangeEnvelope {
  schemaVersion: typeof INTERCHANGE_SCHEMA_VERSION;
  format: typeof LOREBOOK_FORMAT;
  sourceVersion: string;
  /** Server-generated id shared by every entry of one import. */
  groupId: string;
  /** Original uid/key from the file. Never used as a database id. */
  sourceEntryKey: string;
  sourceOrder: number;
  /** The original entry minus `content` (which lives in `description`). */
  originalEntry: InterchangeObject;
  /** Book-level fields (everything except `entries`), bounded. */
  bookMetadata: InterchangeObject;
  mappingVersion: number;
  /** Tracking mode assigned at import; export keeps original flags while unchanged. */
  importedTrackingMode: CodexTrackingMode;
  unsupportedFeatures: LorebookFeature[];
}

export interface InterchangeWarning {
  code:
    | "UNSUPPORTED_ACTIVATION"
    | "PRESERVED_ONLY_FEATURES"
    | "CONTRADICTORY_FLAGS"
    | "FALLBACK_NAME"
    | "NAME_TRUNCATED"
    | "NO_PRIMARY_KEYS"
    | "DROPPED_KEYS"
    | "OVERRIDE_IGNORED"
    | "ENVELOPE_INVALID"
    | "MIXED_GROUPS"
    | "ACTIVATION_SEMANTICS_DIFFER"
    | "NOT_PORTABLE"
    // Character cards (STO-1263)
    | "LEGACY_V1_CARD"
    | "V3_PARTIAL_SUPPORT"
    | "V3_FIELDS_NOT_EXPORTED"
    | "SPEC_VERSION_UNKNOWN"
    | "EMBEDDED_BOOK_INVALID"
    | "EMBEDDED_BOOK_NOT_IMPORTED"
    | "EMBEDDED_BOOK_FROM_IMPORT"
    | "NOT_A_CHARACTER";
  message: string;
  sourceEntryKey?: string;
  entryId?: string;
}

export type LorebookActivation = "supported" | "unsupported" | "disabled";

/** One normalized entry as shown in the import preview. */
export interface LorebookPreviewEntry {
  sourceEntryKey: string;
  sourceOrder: number;
  name: string;
  description: string;
  aliases: string[];
  trackingMode: CodexTrackingMode;
  activation: LorebookActivation;
  unsupportedFeatures: LorebookFeature[];
}

export interface LorebookPreview {
  format: typeof LOREBOOK_FORMAT;
  sourceVersion: string;
  bookName: string | null;
  entryCount: number;
  entries: LorebookPreviewEntry[];
  warnings: InterchangeWarning[];
}

/** A parsed entry ready to be committed (preview data plus preserved payload). */
export interface LorebookEntryDraft extends LorebookPreviewEntry {
  originalEntry: InterchangeObject;
}

export interface ParsedLorebook {
  preview: LorebookPreview;
  drafts: LorebookEntryDraft[];
  bookMetadata: InterchangeObject;
}

export interface LorebookImportOptions {
  novelId?: string | null;
  seriesId?: string | null;
  seriesScoped?: boolean;
  /** Codex type for every imported entry (default LORE). */
  type?: CodexType;
  /**
   * Author-chosen tracking modes keyed by sourceEntryKey. This is how an entry
   * with unsupported activation is explicitly opted in to DETECTED/ALWAYS.
   * Disabled entries stay NEVER.
   */
  activationOverrides?: Record<string, CodexTrackingMode>;
}

/** Native data the lorebook serializer needs for one Codex entry. */
export interface LorebookExportSource {
  id: string;
  name: string;
  description: string;
  trackingMode: CodexTrackingMode;
  aliases: string[];
  customFields: unknown;
}

export interface SerializedLorebook {
  lorebook: InterchangeObject;
  warnings: InterchangeWarning[];
}

// ─── Character cards (STO-1263) ─────────────────────────────────────────────

export const CARD_FORMAT = "character_card";
export const CARD_MAPPING_VERSION = 1;

/** Card variants inkstory recognizes. Only V2 is written on export. */
export type CardSourceVersion = "v1" | "v2" | "v3";
export type CardEncoding = "json" | "yaml" | "png";

export const CARD_LIMITS = {
  /** Raw JSON/YAML card text (UTF-8 bytes). */
  maxFileBytes: 2 * 1024 * 1024,
  /** Raw PNG bytes (card import and author-supplied export portrait). */
  maxPngBytes: 8 * 1024 * 1024,
  maxPngChunks: 4096,
  maxPngDimension: 8192,
  maxPngPixels: 8192 * 4096,
  /** Base64 text inside one `chara` / `ccv3` tEXt chunk. */
  maxCardTextBytes: 3 * 1024 * 1024,
  maxDepth: 32,
  maxStringLength: 200_000,
  /** Serialized size of the preserved card (description excluded). */
  maxOriginalCardBytes: 512 * 1024,
  maxNameLength: 200,
} as const;

/** Stored under `customFields._inkstoryInterchange` on an imported character entry. */
export interface CardEnvelope {
  schemaVersion: typeof INTERCHANGE_SCHEMA_VERSION;
  format: typeof CARD_FORMAT;
  sourceVersion: CardSourceVersion;
  sourceEncoding: CardEncoding;
  /** Server-generated id; embedded-book entries imported with the card share it. */
  groupId: string;
  /** The original card minus the description (which lives in `description`). */
  originalCard: InterchangeObject;
  mappingVersion: number;
  /** True when the embedded character_book was imported as separate entries. */
  embeddedBookImported: boolean;
}

export interface CardEmbeddedBookPreview {
  name: string | null;
  entryCount: number;
  entries: LorebookPreviewEntry[];
  warnings: InterchangeWarning[];
}

export interface CardPreview {
  format: typeof CARD_FORMAT;
  sourceVersion: CardSourceVersion;
  sourceEncoding: CardEncoding;
  name: string;
  description: string;
  /** Card fields that become native Codex data and can reach generation. */
  mappedFields: string[];
  /** Card fields kept only as interchange metadata (never generation input). */
  preservedFields: string[];
  embeddedBook: CardEmbeddedBookPreview | null;
  warnings: InterchangeWarning[];
}

export interface ParsedCard {
  preview: CardPreview;
  originalCard: InterchangeObject;
  /** Parsed embedded character_book, ready for the lorebook import path. */
  embeddedBook: ParsedLorebook | null;
}

export type CardInput =
  | { encoding: "json" | "yaml"; content: string }
  | { encoding: "png"; bytes: Uint8Array };

export interface CardImportOptions {
  novelId?: string | null;
  seriesId?: string | null;
  seriesScoped?: boolean;
  /** Opt-in: also create LORE entries from the embedded character_book. */
  importEmbeddedBook?: boolean;
  /** Tracking-mode overrides for embedded-book entries, keyed by sourceEntryKey. */
  bookActivationOverrides?: Record<string, CodexTrackingMode>;
}

export interface CardExportSource {
  id: string;
  name: string;
  description: string;
  type: CodexType;
  aliases: string[];
  tags: string[];
  customFields: unknown;
}

export interface SerializedCard {
  card: InterchangeObject;
  warnings: InterchangeWarning[];
}
