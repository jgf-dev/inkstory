/**
 * Codex interchange types (STO-1261 / STO-1262).
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
    | "NOT_PORTABLE";
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
