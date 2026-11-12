/**
 * SillyTavern lorebook (World Info) JSON codec (STO-1262).
 *
 * Pure parse/map/serialize: no DB, auth, provider or network access.
 *
 * Mapping (EL-approved, 2026-11-08):
 * - comment → name (fallback: first primary key, then "Lorebook entry N")
 * - content → description (plain reference text, never instructions)
 * - primary `key` list → aliases (trimmed, deduplicated; regex keys are not aliases)
 * - disable → NEVER; constant → ALWAYS; otherwise DETECTED
 * - secondary keys, regex keys, probability, sticky/cooldown/delay, delayed
 *   recursion and vector matching are preserved only. An entry that relies on
 *   them imports as NEVER until the author explicitly picks a mode.
 * - group, recursion flags, match options, scan depth and automation are
 *   preserved only and do not change activation.
 * Round trips are semantic, not byte-identical.
 */

import type { CodexTrackingMode } from "../types";
import {
  BLOCKING_LOREBOOK_FEATURES,
  LOREBOOK_FORMAT,
  LOREBOOK_LIMITS,
  type InterchangeObject,
  type InterchangeWarning,
  type LorebookActivation,
  type LorebookEntryDraft,
  type LorebookExportSource,
  type LorebookFeature,
  type ParsedLorebook,
  type SerializedLorebook,
} from "./types";
import {
  invalid,
  isPlainObject,
  jsonByteLength,
  parseBoundedJson,
  readInterchangeEnvelope,
} from "./validate";

const REGEX_KEY = /^\/(.+)\/([a-z]*)$/s;

/** SillyTavern defaults used when exporting entries that have no preserved original. */
const DEFAULT_ENTRY: InterchangeObject = {
  keysecondary: [],
  constant: false,
  vectorized: false,
  selective: true,
  selectiveLogic: 0,
  addMemo: true,
  order: 100,
  position: 0,
  disable: false,
  excludeRecursion: false,
  preventRecursion: false,
  delayUntilRecursion: false,
  probability: 100,
  useProbability: true,
  depth: 4,
  group: "",
  groupOverride: false,
  groupWeight: 100,
  scanDepth: null,
  caseSensitive: null,
  matchWholeWords: null,
  useGroupScoring: null,
  automationId: "",
  role: null,
  sticky: 0,
  cooldown: 0,
  delay: 0,
};

function isPositiveNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function readStringList(value: unknown, field: string, sourceKey: string): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value === "string") return [value];
  if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
    throw invalid(`Entry ${sourceKey}: "${field}" must be a list of strings`);
  }
  if (value.length > LOREBOOK_LIMITS.maxKeysPerEntry) {
    throw invalid(
      `Entry ${sourceKey}: "${field}" has more than ${LOREBOOK_LIMITS.maxKeysPerEntry} keys`,
    );
  }
  return value as string[];
}

export interface NormalizedKeys {
  aliases: string[];
  regexKeys: string[];
  dropped: string[];
}

/** Trims, drops blanks, deduplicates case-insensitively and separates regex keys. */
export function normalizePrimaryKeys(keys: readonly string[]): NormalizedKeys {
  const aliases: string[] = [];
  const regexKeys: string[] = [];
  const dropped: string[] = [];
  const seen = new Set<string>();
  for (const raw of keys) {
    const key = raw.trim();
    if (!key) {
      dropped.push(raw);
      continue;
    }
    if (REGEX_KEY.test(key)) {
      regexKeys.push(raw);
      continue;
    }
    if (key.length > LOREBOOK_LIMITS.maxKeyLength) {
      dropped.push(raw);
      continue;
    }
    const folded = key.toLowerCase();
    if (seen.has(folded)) {
      dropped.push(raw);
      continue;
    }
    seen.add(folded);
    aliases.push(key);
  }
  return { aliases, regexKeys, dropped };
}

/** Detects lorebook features inkstory does not implement, in a stable order. */
export function detectLorebookFeatures(
  entry: InterchangeObject,
  regexKeyCount: number,
): LorebookFeature[] {
  const features: LorebookFeature[] = [];
  const secondary = Array.isArray(entry.keysecondary) ? entry.keysecondary : [];
  const hasSecondary = secondary.some((k) => typeof k === "string" && k.trim() !== "");
  if (hasSecondary && entry.selective !== false) features.push("secondaryKeys");
  if (regexKeyCount > 0) features.push("regexKeys");
  if (
    entry.useProbability !== false &&
    typeof entry.probability === "number" &&
    entry.probability < 100
  ) {
    features.push("probability");
  }
  if (isPositiveNumber(entry.sticky)) features.push("sticky");
  if (isPositiveNumber(entry.cooldown)) features.push("cooldown");
  if (isPositiveNumber(entry.delay)) features.push("delay");
  if (entry.delayUntilRecursion) features.push("delayUntilRecursion");
  if (entry.vectorized === true) features.push("vectorized");
  if (entry.excludeRecursion === true || entry.preventRecursion === true) {
    features.push("recursionFlags");
  }
  if (typeof entry.group === "string" && entry.group.trim() !== "") {
    features.push("inclusionGroup");
  }
  if (
    (entry.caseSensitive !== undefined && entry.caseSensitive !== null) ||
    (entry.matchWholeWords !== undefined && entry.matchWholeWords !== null)
  ) {
    features.push("matchOptions");
  }
  if (entry.scanDepth !== undefined && entry.scanDepth !== null) features.push("scanDepth");
  if (typeof entry.automationId === "string" && entry.automationId.trim() !== "") {
    features.push("automation");
  }
  return features;
}

function isDisabled(entry: InterchangeObject): boolean {
  return entry.disable === true || entry.enabled === false;
}

function looksLikeCharacterBook(entries: unknown[]): boolean {
  return entries.some(
    (e) => isPlainObject(e) && Array.isArray(e.keys) && !("key" in e) && !("uid" in e),
  );
}

/** Original uid, or the container key when the entry has none. */
export function lorebookSourceKey(entry: InterchangeObject, fallback: string): string {
  if (typeof entry.uid === "number" && Number.isFinite(entry.uid)) return String(entry.uid);
  if (typeof entry.uid === "string" && entry.uid.trim() !== "") return entry.uid.trim();
  return fallback;
}

/**
 * Parses SillyTavern lorebook JSON into normalized drafts and a preview.
 * Throws 422 VALIDATION_FAILED for anything malformed, oversized or ambiguous,
 * before any database write.
 */
export function parseLorebook(raw: unknown): ParsedLorebook {
  const root = parseBoundedJson(raw, LOREBOOK_LIMITS);
  if (!isPlainObject(root)) {
    throw invalid("Lorebook must be a JSON object with an `entries` field");
  }

  const rawEntries = root.entries;
  let pairs: Array<[string, unknown]>;
  let sourceVersion: string;
  if (Array.isArray(rawEntries)) {
    pairs = rawEntries.map((e, i) => [String(i), e]);
    sourceVersion = "worldinfo-array";
  } else if (isPlainObject(rawEntries)) {
    pairs = Object.entries(rawEntries);
    sourceVersion = "worldinfo";
  } else {
    throw invalid("Lorebook must be a JSON object with an `entries` field");
  }

  if (pairs.length === 0) {
    throw invalid("Lorebook has no entries. Empty lorebooks cannot be imported.");
  }
  if (pairs.length > LOREBOOK_LIMITS.maxEntries) {
    throw invalid(`Lorebook has more than ${LOREBOOK_LIMITS.maxEntries} entries`);
  }
  if (looksLikeCharacterBook(pairs.map(([, e]) => e))) {
    throw invalid(
      "This looks like a Character Card V2 `character_book`, not a SillyTavern lorebook. Import it with the character card.",
    );
  }

  const { entries: _entries, ...bookMetadata } = root;
  if (jsonByteLength(bookMetadata) > LOREBOOK_LIMITS.maxBookMetadataBytes) {
    throw invalid(
      `Lorebook metadata exceeds ${LOREBOOK_LIMITS.maxBookMetadataBytes} bytes; it cannot be preserved`,
    );
  }

  const warnings: InterchangeWarning[] = [];
  const drafts: LorebookEntryDraft[] = [];
  const seenKeys = new Set<string>();

  pairs.forEach(([containerKey, value], sourceOrder) => {
    if (!isPlainObject(value)) {
      throw invalid(`Entry ${containerKey} is not an object`);
    }
    const sourceEntryKey = lorebookSourceKey(value, containerKey);
    if (seenKeys.has(sourceEntryKey)) {
      throw invalid(`Duplicate entry uid "${sourceEntryKey}"`);
    }
    seenKeys.add(sourceEntryKey);

    if (value.content !== undefined && typeof value.content !== "string") {
      throw invalid(`Entry ${sourceEntryKey}: "content" must be text`);
    }
    if (
      value.comment !== undefined &&
      value.comment !== null &&
      typeof value.comment !== "string"
    ) {
      throw invalid(`Entry ${sourceEntryKey}: "comment" must be text`);
    }
    readStringList(value.keysecondary, "keysecondary", sourceEntryKey);
    const keys = normalizePrimaryKeys(readStringList(value.key, "key", sourceEntryKey));

    const { content, ...originalEntry } = value;
    if (jsonByteLength(originalEntry) > LOREBOOK_LIMITS.maxOriginalEntryBytes) {
      throw invalid(
        `Entry ${sourceEntryKey} metadata exceeds ${LOREBOOK_LIMITS.maxOriginalEntryBytes} bytes`,
      );
    }

    const features = detectLorebookFeatures(value, keys.regexKeys.length);
    const blocking = features.filter((f) => BLOCKING_LOREBOOK_FEATURES.has(f));
    const preservedOnly = features.filter((f) => !BLOCKING_LOREBOOK_FEATURES.has(f));
    const disabled = isDisabled(value);
    const constant = value.constant === true;

    let trackingMode: CodexTrackingMode;
    let activation: LorebookActivation;
    if (disabled) {
      trackingMode = "NEVER";
      activation = "disabled";
      if (constant) {
        warnings.push({
          code: "CONTRADICTORY_FLAGS",
          message: "Entry is both constant and disabled; disabled wins (NEVER).",
          sourceEntryKey,
        });
      }
    } else if (blocking.length > 0) {
      trackingMode = "NEVER";
      activation = "unsupported";
      warnings.push({
        code: "UNSUPPORTED_ACTIVATION",
        message: `Activation uses ${blocking.join(", ")}, which inkstory does not support. Imported as NEVER until you choose a mode.`,
        sourceEntryKey,
      });
    } else {
      trackingMode = constant ? "ALWAYS" : "DETECTED";
      activation = "supported";
    }

    if (preservedOnly.length > 0) {
      warnings.push({
        code: "PRESERVED_ONLY_FEATURES",
        message: `Kept for export but not used by inkstory: ${preservedOnly.join(", ")}.`,
        sourceEntryKey,
      });
    }
    if (keys.dropped.length > 0) {
      warnings.push({
        code: "DROPPED_KEYS",
        message: `${keys.dropped.length} blank, duplicate or overlong key(s) were not added as aliases.`,
        sourceEntryKey,
      });
    }
    if (keys.aliases.length === 0 && trackingMode === "DETECTED") {
      warnings.push({
        code: "NO_PRIMARY_KEYS",
        message: "No usable primary keys; detection will match the entry name only.",
        sourceEntryKey,
      });
    }

    let name = typeof value.comment === "string" ? value.comment.trim() : "";
    if (!name) {
      name = keys.aliases[0] ?? `Lorebook entry ${sourceOrder + 1}`;
      warnings.push({
        code: "FALLBACK_NAME",
        message: `Entry has no title; named "${name}".`,
        sourceEntryKey,
      });
    }
    if (name.length > LOREBOOK_LIMITS.maxNameLength) {
      name = name.slice(0, LOREBOOK_LIMITS.maxNameLength).trimEnd();
      warnings.push({
        code: "NAME_TRUNCATED",
        message: `Title was shortened to ${LOREBOOK_LIMITS.maxNameLength} characters.`,
        sourceEntryKey,
      });
    }

    drafts.push({
      sourceEntryKey,
      sourceOrder,
      name,
      description: typeof content === "string" ? content : "",
      aliases: keys.aliases,
      trackingMode,
      activation,
      unsupportedFeatures: features,
      originalEntry,
    });
  });

  const bookName =
    typeof bookMetadata.name === "string" && bookMetadata.name.trim()
      ? bookMetadata.name.trim()
      : null;

  return {
    preview: {
      format: LOREBOOK_FORMAT,
      sourceVersion,
      bookName,
      entryCount: drafts.length,
      entries: drafts.map(({ originalEntry: _original, ...entry }) => entry),
      warnings,
    },
    drafts,
    bookMetadata,
  };
}

export function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((v) => set.has(v));
}

export function activationFlags(mode: CodexTrackingMode): { constant: boolean; disable: boolean } {
  if (mode === "ALWAYS") return { constant: true, disable: false };
  if (mode === "NEVER") return { constant: false, disable: true };
  return { constant: false, disable: false };
}

export function activationSemanticsWarning(
  source: { id?: string; name: string; trackingMode: CodexTrackingMode },
  env: { unsupportedFeatures: readonly string[]; sourceEntryKey?: string },
): InterchangeWarning | null {
  if (source.trackingMode === "NEVER") return null;
  const blocking = env.unsupportedFeatures.filter((f) =>
    BLOCKING_LOREBOOK_FEATURES.has(f as LorebookFeature),
  );
  if (blocking.length === 0) return null;
  return {
    code: "ACTIVATION_SEMANTICS_DIFFER",
    message: `"${source.name}" still carries ${blocking.join(", ")}; SillyTavern will apply them on top of the ${source.trackingMode} mode chosen in inkstory.`,
    entryId: source.id,
    ...(env.sourceEntryKey ? { sourceEntryKey: env.sourceEntryKey } : {}),
  };
}

/**
 * Serializes Codex entries as SillyTavern lorebook JSON. Entries imported from
 * a lorebook start from their preserved original and overlay native edits;
 * other entries use SillyTavern defaults. Callers pass entries in export order.
 */
export function serializeLorebook(
  sources: readonly LorebookExportSource[],
  options: { name?: string | null } = {},
): SerializedLorebook {
  const warnings: InterchangeWarning[] = [];
  const entries: InterchangeObject = {};
  const groups = new Map<string, InterchangeObject>();

  sources.forEach((source, index) => {
    const read = readInterchangeEnvelope(source.customFields);
    let entry: InterchangeObject;

    if (read.status === "ok") {
      const env = read.envelope;
      groups.set(env.groupId, env.bookMetadata);
      const original = env.originalEntry;
      entry = { ...DEFAULT_ENTRY, ...original };

      const originalKeys = Array.isArray(original.key)
        ? original.key.filter((k): k is string => typeof k === "string")
        : typeof original.key === "string"
          ? [original.key]
          : [];
      const normalized = normalizePrimaryKeys(originalKeys);
      entry.key = sameStringSet(normalized.aliases, source.aliases)
        ? originalKeys
        : [...source.aliases, ...normalized.regexKeys];

      const originalTitle = typeof original.comment === "string" ? original.comment.trim() : "";
      if (originalTitle !== source.name) entry.comment = source.name;

      if (source.trackingMode !== env.importedTrackingMode) {
        Object.assign(entry, activationFlags(source.trackingMode));
        const warning = activationSemanticsWarning(source, env);
        if (warning) warnings.push(warning);
      }
    } else {
      if (read.status === "invalid") {
        warnings.push({
          code: "ENVELOPE_INVALID",
          message: `"${source.name}" has unreadable import metadata; exported with default lorebook settings.`,
          entryId: source.id,
        });
      }
      entry = {
        ...DEFAULT_ENTRY,
        key: [...source.aliases],
        comment: source.name,
        ...activationFlags(source.trackingMode),
      };
    }

    entry.uid = index;
    entry.displayIndex = index;
    entry.content = source.description;
    entries[String(index)] = entry;
  });

  let bookMetadata: InterchangeObject = {};
  if (groups.size === 1) {
    bookMetadata = { ...[...groups.values()][0] };
  } else if (groups.size > 1) {
    warnings.push({
      code: "MIXED_GROUPS",
      message:
        "Entries come from more than one imported lorebook; book-level metadata was not exported.",
    });
  }
  const name = options.name?.trim();
  if (name) bookMetadata.name = name;

  return { lorebook: { ...bookMetadata, entries }, warnings };
}
