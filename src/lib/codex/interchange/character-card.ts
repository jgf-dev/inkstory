/**
 * Character card codec (STO-1263). Pure parse/map/serialize: no DB, auth,
 * provider or network access.
 *
 * Variant matrix (EL-approved, 2026-11-08):
 * - Character Card V2 JSON and PNG (`chara` tEXt): import and export.
 * - YAML: data-only parse of the same known card shapes (core schema, no
 *   custom tags, no aliases/anchors, single document). Import only.
 * - Legacy V1 (flat name/description/personality/…): mapped when every known
 *   field is unambiguous text, otherwise rejected. Exported as V2, with a warning.
 * - V3 (`chara_card_v3` / `ccv3` chunk): detected; name, description and the
 *   embedded book are mapped, every other field is preserved. Export writes V2
 *   and reports the V3-only fields that are left out. No full V3 claim.
 *
 * Mapping: data.name → name, data.description → description. Everything else
 * (personality, scenario, greetings, example dialogue, system prompt,
 * post-history instructions, creator notes, tags, extensions, the embedded
 * character_book) is preserved in the `_inkstoryInterchange` envelope and never
 * becomes a prompt or generation instruction.
 */

import { parseDocument } from "yaml";
import { activationFlags, normalizePrimaryKeys, parseLorebook, sameStringSet } from "./lorebook";
import { extractCardText, readPng, base64ToUtf8 } from "./png";
import {
  BLOCKING_LOREBOOK_FEATURES,
  CARD_FORMAT,
  CARD_LIMITS,
  type CardEncoding,
  type CardExportSource,
  type CardInput,
  type CardSourceVersion,
  type InterchangeEnvelope,
  type InterchangeObject,
  type InterchangeWarning,
  type LorebookExportSource,
  type ParsedCard,
  type ParsedLorebook,
  type SerializedCard,
} from "./types";
import {
  assertBoundedValue,
  invalid,
  isPlainObject,
  jsonByteLength,
  parseBoundedJson,
  readCardEnvelope,
  readInterchangeEnvelope,
} from "./validate";

const V1_FIELDS = ["name", "description", "personality", "scenario", "first_mes", "mes_example"];

/** Every field of a Character Card V2 `data` object, with spec defaults. */
const V2_DATA_DEFAULTS: InterchangeObject = {
  name: "",
  description: "",
  personality: "",
  scenario: "",
  first_mes: "",
  mes_example: "",
  creator_notes: "",
  system_prompt: "",
  post_history_instructions: "",
  alternate_greetings: [],
  tags: [],
  creator: "",
  character_version: "",
  extensions: {},
};
const V2_DATA_KEYS = new Set([...Object.keys(V2_DATA_DEFAULTS), "character_book"]);

const JSON_LIMITS = {
  maxFileBytes: CARD_LIMITS.maxFileBytes,
  maxDepth: CARD_LIMITS.maxDepth,
  maxStringLength: CARD_LIMITS.maxStringLength,
};

function cloneObject(value: InterchangeObject): InterchangeObject {
  return structuredClone(value);
}

/** Data-only YAML: core schema, no aliases, no custom tags, one document. */
export function parseCardYaml(text: string): unknown {
  if (new TextEncoder().encode(text).length > CARD_LIMITS.maxFileBytes) {
    throw invalid(`File exceeds ${CARD_LIMITS.maxFileBytes} bytes`);
  }
  const doc = parseDocument(text, {
    schema: "core",
    uniqueKeys: true,
    merge: false,
    customTags: [],
    strict: true,
  });
  if (doc.errors.length > 0 || doc.warnings.length > 0) {
    const first = doc.errors[0] ?? doc.warnings[0];
    throw invalid(`File is not a supported YAML card: ${first?.message.split("\n")[0]}`);
  }
  let value: unknown;
  try {
    value = doc.toJS({ maxAliasCount: 0 });
  } catch {
    throw invalid("YAML cards may not use anchors or aliases");
  }
  assertBoundedValue(value, JSON_LIMITS);
  return value;
}

function readCardRoot(input: CardInput): unknown {
  if (input.encoding === "png") {
    const { keyword, text } = extractCardText(readPng(input.bytes));
    const json = base64ToUtf8(text, `PNG "${keyword}" metadata`);
    return parseBoundedJson(json, JSON_LIMITS);
  }
  if (typeof input.content !== "string" || input.content.trim() === "") {
    throw invalid("File content is required");
  }
  return input.encoding === "yaml"
    ? parseCardYaml(input.content)
    : parseBoundedJson(input.content, JSON_LIMITS);
}

interface DetectedCard {
  version: CardSourceVersion;
  /** The object holding name/description/etc. (`data` for V2/V3, root for V1). */
  fields: InterchangeObject;
  warnings: InterchangeWarning[];
}

/** Detects the card variant. Ambiguous or unknown shapes fail loudly. */
export function detectCardVersion(root: unknown): DetectedCard {
  if (!isPlainObject(root)) {
    throw invalid("Character card must be an object");
  }
  const warnings: InterchangeWarning[] = [];
  if (root.spec === "chara_card_v2" || root.spec === "chara_card_v3") {
    if (!isPlainObject(root.data)) {
      throw invalid(`Card declares ${root.spec} but has no "data" object`);
    }
    const version: CardSourceVersion = root.spec === "chara_card_v2" ? "v2" : "v3";
    const expected = version === "v2" ? "2" : "3";
    if (
      root.spec_version !== undefined &&
      !(typeof root.spec_version === "string" && root.spec_version.startsWith(`${expected}.`))
    ) {
      warnings.push({
        code: "SPEC_VERSION_UNKNOWN",
        message: `Card declares ${root.spec} with spec_version ${JSON.stringify(root.spec_version)}; read as ${version.toUpperCase()}.`,
      });
    }
    if (version === "v3") {
      warnings.push({
        code: "V3_PARTIAL_SUPPORT",
        message:
          "Character Card V3: name, description and the embedded book are mapped; other V3 fields are kept but not used, and export writes V2.",
      });
    }
    return { version, fields: root.data, warnings };
  }
  if (root.spec !== undefined) {
    throw invalid(`Unsupported character card spec ${JSON.stringify(root.spec)}`);
  }
  if ("data" in root) {
    throw invalid('Card has a "data" object but no "spec"; cannot tell which version it is');
  }
  const looksV1 = typeof root.name === "string" && typeof root.description === "string";
  if (!looksV1) {
    throw invalid("File is not a recognized character card (V1, V2 or V3)");
  }
  for (const field of V1_FIELDS) {
    if (root[field] !== undefined && typeof root[field] !== "string") {
      throw invalid(`Legacy V1 card field "${field}" must be text`);
    }
  }
  warnings.push({
    code: "LEGACY_V1_CARD",
    message: "Legacy V1 card: mapped as-is and exported as Character Card V2.",
  });
  return { version: "v1", fields: root, warnings };
}

/**
 * Converts a V2/V3 `character_book` into SillyTavern World Info JSON (the same
 * conversion SillyTavern applies when it imports an embedded book), so the
 * lorebook codec owns all activation and preservation rules.
 */
export function characterBookToWorldInfo(book: InterchangeObject): InterchangeObject {
  if (!Array.isArray(book.entries)) {
    throw invalid('Embedded character_book has no "entries" list');
  }
  const entries: InterchangeObject = {};
  book.entries.forEach((raw, index) => {
    if (!isPlainObject(raw)) {
      throw invalid(`Embedded book entry ${index} is not an object`);
    }
    const ext = isPlainObject(raw.extensions) ? raw.extensions : {};
    const uid = typeof raw.id === "number" || typeof raw.id === "string" ? raw.id : index;
    const title =
      typeof raw.comment === "string" && raw.comment.trim()
        ? raw.comment
        : typeof raw.name === "string"
          ? raw.name
          : "";
    entries[String(index)] = {
      uid,
      key: raw.keys ?? [],
      keysecondary: raw.secondary_keys ?? [],
      comment: title,
      content: raw.content ?? "",
      constant: raw.constant === true,
      selective: raw.selective === true,
      order: typeof raw.insertion_order === "number" ? raw.insertion_order : 100,
      position: ext.position ?? (raw.position === "before_char" ? 0 : 1),
      disable: raw.enabled === false,
      displayIndex: ext.display_index ?? index,
      excludeRecursion: ext.exclude_recursion ?? false,
      preventRecursion: ext.prevent_recursion ?? false,
      delayUntilRecursion: ext.delay_until_recursion ?? false,
      probability: ext.probability ?? 100,
      useProbability: ext.useProbability ?? true,
      depth: ext.depth ?? 4,
      selectiveLogic: ext.selectiveLogic ?? 0,
      group: ext.group ?? "",
      groupOverride: ext.group_override ?? false,
      groupWeight: ext.group_weight ?? 100,
      scanDepth: ext.scan_depth ?? null,
      caseSensitive: raw.case_sensitive ?? ext.case_sensitive ?? null,
      matchWholeWords: ext.match_whole_words ?? null,
      useGroupScoring: ext.use_group_scoring ?? null,
      automationId: ext.automation_id ?? "",
      role: ext.role ?? null,
      vectorized: ext.vectorized ?? false,
      sticky: ext.sticky ?? 0,
      cooldown: ext.cooldown ?? 0,
      delay: ext.delay ?? 0,
      extensions: ext,
    };
  });
  const { entries: _entries, ...bookFields } = book;
  return { ...bookFields, entries };
}

function parseEmbeddedBook(
  fields: InterchangeObject,
  warnings: InterchangeWarning[],
): ParsedLorebook | null {
  const book = fields.character_book;
  if (book === undefined || book === null) return null;
  try {
    if (!isPlainObject(book)) throw invalid("character_book must be an object");
    const parsed = parseLorebook(JSON.stringify(characterBookToWorldInfo(book)));
    parsed.preview.sourceVersion = "character_book";
    return parsed;
  } catch (err) {
    warnings.push({
      code: "EMBEDDED_BOOK_INVALID",
      message: `The embedded character book can't be imported (${err instanceof Error ? err.message : "invalid"}). It is kept with the card.`,
    });
    return null;
  }
}

/**
 * Parses a JSON, YAML or PNG character card into a preview plus the bounded
 * payload to preserve. Throws 422 VALIDATION_FAILED before any DB write.
 */
export function parseCharacterCard(input: CardInput): ParsedCard {
  const encoding: CardEncoding = input.encoding;
  if (encoding !== "json" && encoding !== "yaml" && encoding !== "png") {
    throw invalid("encoding must be json, yaml or png");
  }
  const root = readCardRoot(input) as InterchangeObject;
  const { version, fields, warnings } = detectCardVersion(root);

  if (fields.name !== undefined && typeof fields.name !== "string") {
    throw invalid('Card "name" must be text');
  }
  if (
    fields.description !== undefined &&
    fields.description !== null &&
    typeof fields.description !== "string"
  ) {
    throw invalid('Card "description" must be text');
  }

  let name = typeof fields.name === "string" ? fields.name.trim() : "";
  if (!name) {
    name = "Imported character";
    warnings.push({ code: "FALLBACK_NAME", message: `Card has no name; named "${name}".` });
  }
  if (name.length > CARD_LIMITS.maxNameLength) {
    name = name.slice(0, CARD_LIMITS.maxNameLength).trimEnd();
    warnings.push({
      code: "NAME_TRUNCATED",
      message: `Name was shortened to ${CARD_LIMITS.maxNameLength} characters.`,
    });
  }
  const description = typeof fields.description === "string" ? fields.description : "";

  // Preserve everything except the description, which now lives natively.
  const originalCard = cloneObject(root);
  if (version === "v1") {
    delete originalCard.description;
  } else {
    delete (originalCard.data as InterchangeObject).description;
  }
  if (jsonByteLength(originalCard) > CARD_LIMITS.maxOriginalCardBytes) {
    throw invalid(
      `Card metadata exceeds ${CARD_LIMITS.maxOriginalCardBytes} bytes; it cannot be preserved`,
    );
  }

  const book = version === "v1" ? null : parseEmbeddedBook(fields, warnings);
  const preservedFields = Object.keys(fields).filter(
    (key) => key !== "name" && key !== "description",
  );

  return {
    preview: {
      format: CARD_FORMAT,
      sourceVersion: version,
      sourceEncoding: encoding,
      name,
      description,
      mappedFields: ["name", "description"],
      preservedFields,
      embeddedBook: book
        ? {
            name: book.preview.bookName,
            entryCount: book.preview.entryCount,
            entries: book.preview.entries,
            warnings: book.preview.warnings,
          }
        : null,
      warnings,
    },
    originalCard,
    embeddedBook: book,
  };
}

function v2DataFrom(fields: InterchangeObject): InterchangeObject {
  const data: InterchangeObject = { ...V2_DATA_DEFAULTS };
  for (const [key, value] of Object.entries(fields)) {
    if (V2_DATA_KEYS.has(key)) data[key] = value;
  }
  if (!isPlainObject(data.extensions)) data.extensions = {};
  return data;
}

/** Source key used when an embedded book entry is imported through the lorebook codec. */
export function characterBookEntrySourceKey(entry: InterchangeObject, index: number): string {
  const uid = typeof entry.id === "number" || typeof entry.id === "string" ? entry.id : index;
  if (typeof uid === "number" && Number.isFinite(uid)) return String(uid);
  if (typeof uid === "string" && uid.trim() !== "") return uid.trim();
  return String(index);
}

function overlayCharacterBookEntry(
  original: InterchangeObject,
  source: LorebookExportSource,
  env: InterchangeEnvelope | null,
): { entry: InterchangeObject; warnings: InterchangeWarning[] } {
  const next: InterchangeObject = { ...original };
  const warnings: InterchangeWarning[] = [];
  const originalTitle =
    typeof original.comment === "string" && original.comment.trim()
      ? original.comment.trim()
      : typeof original.name === "string"
        ? original.name.trim()
        : "";
  if (originalTitle !== source.name) next.comment = source.name;
  next.content = source.description;

  const originalKeys = Array.isArray(original.keys)
    ? original.keys.filter((key): key is string => typeof key === "string")
    : [];
  const normalized = normalizePrimaryKeys(originalKeys);
  if (!sameStringSet(normalized.aliases, source.aliases)) {
    next.keys = [...source.aliases, ...normalized.regexKeys];
  }

  if (env && source.trackingMode !== env.importedTrackingMode) {
    const flags = activationFlags(source.trackingMode);
    next.constant = flags.constant;
    next.enabled = !flags.disable;
    const blocking = env.unsupportedFeatures.filter((feature) =>
      BLOCKING_LOREBOOK_FEATURES.has(feature),
    );
    if (source.trackingMode !== "NEVER" && blocking.length > 0) {
      warnings.push({
        code: "ACTIVATION_SEMANTICS_DIFFER",
        message: `"${source.name}" still carries ${blocking.join(", ")}; SillyTavern will apply them on top of the ${source.trackingMode} mode chosen in inkstory.`,
        entryId: source.id,
        sourceEntryKey: env.sourceEntryKey,
      });
    }
  }
  return { entry: next, warnings };
}

/**
 * Overlays current Codex fields of imported book entries onto a preserved
 * `character_book`. Missing live entries keep their imported text (with a
 * warning). This is a semantic overlay, not a byte-identical rewrite.
 */
export function overlayCharacterBook(
  book: InterchangeObject,
  sources: readonly LorebookExportSource[],
  options: { cardEntryId?: string } = {},
): { book: InterchangeObject; warnings: InterchangeWarning[] } {
  const warnings: InterchangeWarning[] = [];
  if (!Array.isArray(book.entries)) return { book, warnings };

  const byKey = new Map<string, LorebookExportSource>();
  let overlaidCount = 0;
  for (const source of sources) {
    const read = readInterchangeEnvelope(source.customFields);
    if (read.status === "ok") byKey.set(read.envelope.sourceEntryKey, source);
  }

  const entries = book.entries.map((raw, index) => {
    if (!isPlainObject(raw)) return raw;
    const key = characterBookEntrySourceKey(raw, index);
    const source = byKey.get(key);
    if (!source) {
      warnings.push({
        code: "EMBEDDED_BOOK_ENTRY_MISSING",
        message: `Embedded book entry "${key}" has no live Codex entry; the imported text was kept.`,
        sourceEntryKey: key,
        entryId: options.cardEntryId,
      });
      return raw;
    }
    const read = readInterchangeEnvelope(source.customFields);
    const overlaid = overlayCharacterBookEntry(
      raw,
      source,
      read.status === "ok" ? read.envelope : null,
    );
    warnings.push(...overlaid.warnings);
    overlaidCount += 1;
    return overlaid.entry;
  });

  if (overlaidCount > 0) {
    warnings.unshift({
      code: "EMBEDDED_BOOK_OVERLAID",
      message:
        "The embedded character book includes current Codex edits to imported entries (name, description, aliases and activation).",
      entryId: options.cardEntryId,
    });
  }

  return { book: { ...book, entries }, warnings };
}

/**
 * Serializes one Codex entry as a Character Card V2 object. Entries imported
 * from a card start from the preserved card and overlay the native name and
 * description; other entries get V2 defaults plus their tags.
 */
export function serializeCharacterCard(source: CardExportSource): SerializedCard {
  const warnings: InterchangeWarning[] = [];
  const read = readCardEnvelope(source.customFields);
  let card: InterchangeObject;

  if (read.status === "ok") {
    const env = read.envelope;
    const original = cloneObject(env.originalCard);
    if (env.sourceVersion === "v2") {
      card = original;
      card.data = v2DataFrom(isPlainObject(original.data) ? original.data : {});
    } else if (env.sourceVersion === "v1") {
      card = {
        ...original,
        // Restore the V1 top-level description slot; it is filled in below.
        description: "",
        spec: "chara_card_v2",
        spec_version: "2.0",
        data: v2DataFrom(original),
      };
      warnings.push({
        code: "LEGACY_V1_CARD",
        message: `"${source.name}" was imported from a V1 card and is exported as Character Card V2.`,
        entryId: source.id,
      });
    } else {
      const data = isPlainObject(original.data) ? original.data : {};
      const dropped = Object.keys(data).filter((k) => !V2_DATA_KEYS.has(k) && k !== "description");
      card = { spec: "chara_card_v2", spec_version: "2.0", data: v2DataFrom(data) };
      if (dropped.length > 0) {
        warnings.push({
          code: "V3_FIELDS_NOT_EXPORTED",
          message: `Exported as Character Card V2; V3-only fields are not written: ${dropped.join(", ")}.`,
          entryId: source.id,
        });
      }
    }
    card.spec = "chara_card_v2";
    card.spec_version = "2.0";
    const preservedBook = (card.data as InterchangeObject).character_book;
    if (env.embeddedBookImported && isPlainObject(preservedBook)) {
      if (source.embeddedBookEntries) {
        const overlaid = overlayCharacterBook(preservedBook, source.embeddedBookEntries, {
          cardEntryId: source.id,
        });
        (card.data as InterchangeObject).character_book = overlaid.book;
        warnings.push(...overlaid.warnings);
      } else {
        warnings.push({
          code: "EMBEDDED_BOOK_FROM_IMPORT",
          message:
            "The embedded character book is exported as it was imported; Codex entry edits were not supplied.",
          entryId: source.id,
        });
      }
    }
  } else {
    if (read.status === "invalid") {
      warnings.push({
        code: "ENVELOPE_INVALID",
        message: `"${source.name}" has unreadable import metadata; exported with default card fields.`,
        entryId: source.id,
      });
    }
    card = {
      spec: "chara_card_v2",
      spec_version: "2.0",
      data: { ...V2_DATA_DEFAULTS, tags: [...source.tags], extensions: {} },
    };
    if (source.aliases.length > 0) {
      warnings.push({
        code: "NOT_PORTABLE",
        message: "Character cards have no aliases field; aliases were not exported.",
        entryId: source.id,
      });
    }
  }

  const data = card.data as InterchangeObject;
  data.name = source.name;
  data.description = source.description;
  // Keep V1-compatible top-level copies in sync when the card carries them.
  if (typeof card.name === "string") card.name = source.name;
  if (typeof card.description === "string") card.description = source.description;

  if (source.type !== "CHARACTER") {
    warnings.push({
      code: "NOT_A_CHARACTER",
      message: `"${source.name}" is a ${source.type} entry; it is exported as a character card anyway.`,
      entryId: source.id,
    });
  }
  return { card, warnings };
}
