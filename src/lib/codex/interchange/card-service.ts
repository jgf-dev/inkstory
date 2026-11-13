/**
 * Character card interchange orchestration (STO-1263): preview, transactional
 * import and export. Auth/ownership, scope and quota live here (shared with the
 * lorebook path); parsing and mapping live in the pure codecs.
 */

import { db } from "@/lib/prisma";
import { parseCharacterCard, serializeCharacterCard } from "./character-card";
import { bytesToBase64, embedCardText, readPng, utf8ToBase64, base64ToBytes } from "./png";
import {
  commitInterchangeBatch,
  exportFilename,
  loadImportedGroupBookSources,
  loadOwnedLiveEntries,
  prepareLorebookBatch,
  type InterchangeBatchEntry,
} from "./service";
import {
  CARD_FORMAT,
  CARD_LIMITS,
  CARD_MAPPING_VERSION,
  INTERCHANGE_ENVELOPE_KEY,
  INTERCHANGE_SCHEMA_VERSION,
  type CardEnvelope,
  type CardImportOptions,
  type CardInput,
  type CardPreview,
  type InterchangeObject,
  type InterchangeWarning,
} from "./types";
import { invalid, readCardEnvelope } from "./validate";

/** Raw request fields describing an uploaded card. */
export interface CardUpload {
  encoding?: unknown;
  /** JSON/YAML text, or base64 PNG bytes when encoding is "png". */
  content?: unknown;
}

/** Validates the upload envelope and decodes PNG base64 within limits. */
export function toCardInput(upload: CardUpload): CardInput {
  const encoding = upload.encoding ?? "json";
  if (encoding !== "json" && encoding !== "yaml" && encoding !== "png") {
    throw invalid("encoding must be json, yaml or png");
  }
  if (typeof upload.content !== "string" || upload.content.trim() === "") {
    throw invalid("File content is required");
  }
  if (encoding === "png") {
    return { encoding, bytes: decodePngBase64(upload.content, "Card PNG") };
  }
  return { encoding, content: upload.content };
}

function decodePngBase64(content: string, label: string): Uint8Array {
  // 4 base64 chars encode 3 bytes; reject before decoding anything huge.
  if (content.length > Math.ceil((CARD_LIMITS.maxPngBytes * 4) / 3) + 4096) {
    throw invalid(`${label} exceeds ${CARD_LIMITS.maxPngBytes} bytes`);
  }
  return base64ToBytes(content, label);
}

/** Parses a card and returns what an import would create. No DB access. */
export function previewCharacterCard(upload: CardUpload): CardPreview {
  return parseCharacterCard(toCardInput(upload)).preview;
}

export interface CardImportResult {
  groupId: string;
  character: { id: string; name: string };
  /** Entries created from the embedded character_book (empty unless opted in). */
  bookEntries: Array<{
    id: string;
    name: string;
    sourceEntryKey: string;
    trackingMode: string;
  }>;
  warnings: InterchangeWarning[];
}

/**
 * Imports a character card as a new CHARACTER entry (create-copy; never
 * overwrites). With `importEmbeddedBook`, the embedded character_book entries
 * are created as LORE entries in the same transaction and share the card's
 * groupId for provenance. No relation edges are created.
 */
export async function importCharacterCard(
  userId: string,
  upload: CardUpload,
  options: CardImportOptions = {},
): Promise<CardImportResult> {
  const parsed = parseCharacterCard(toCardInput(upload));
  const warnings = [...parsed.preview.warnings];
  const groupId = crypto.randomUUID();
  const book = parsed.embeddedBook;
  const importBook = options.importEmbeddedBook === true;

  if (importBook && !book) {
    throw invalid("This card has no importable embedded character book");
  }
  if (!importBook && options.bookActivationOverrides) {
    throw invalid("bookActivationOverrides needs importEmbeddedBook");
  }
  if (book && !importBook) {
    warnings.push({
      code: "EMBEDDED_BOOK_NOT_IMPORTED",
      message: `The embedded character book (${book.preview.entryCount} entries) was kept with the card but not imported as Codex entries.`,
    });
  }

  const envelope: CardEnvelope = {
    schemaVersion: INTERCHANGE_SCHEMA_VERSION,
    format: CARD_FORMAT,
    sourceVersion: parsed.preview.sourceVersion,
    sourceEncoding: parsed.preview.sourceEncoding,
    groupId,
    originalCard: parsed.originalCard,
    mappingVersion: CARD_MAPPING_VERSION,
    embeddedBookImported: importBook,
  };
  const character: InterchangeBatchEntry = {
    id: crypto.randomUUID(),
    name: parsed.preview.name,
    type: "CHARACTER",
    description: parsed.preview.description,
    trackingMode: "DETECTED",
    customFields: { [INTERCHANGE_ENVELOPE_KEY]: envelope },
    position: 0,
    aliases: [],
  };

  let bookBatch: InterchangeBatchEntry[] = [];
  if (importBook && book) {
    warnings.push(...book.preview.warnings);
    bookBatch = prepareLorebookBatch(
      book,
      { type: "LORE", groupId, activationOverrides: options.bookActivationOverrides },
      warnings,
    ).map((entry) => ({ ...entry, position: entry.position + 1 }));
  }

  await commitInterchangeBatch(userId, options, [character, ...bookBatch]);

  return {
    groupId,
    character: { id: character.id, name: character.name },
    bookEntries: bookBatch.map((entry, i) => ({
      id: entry.id,
      name: entry.name,
      sourceEntryKey: book!.drafts[i]!.sourceEntryKey,
      trackingMode: entry.trackingMode,
    })),
    warnings,
  };
}

export interface CardExportInput {
  entryId?: unknown;
  /** "json" (default) or "png". */
  format?: unknown;
  /** Base64 PNG the author supplies for PNG export. Never fetched from a URL. */
  portrait?: unknown;
}

export interface CardExportResult {
  filename: string;
  card: InterchangeObject;
  /** Base64 PNG with the card embedded (PNG export only). */
  png?: string;
  warnings: InterchangeWarning[];
}

/**
 * Exports one owned, live Codex entry as a Character Card V2 (JSON, or PNG
 * when the author supplies a portrait image).
 */
export async function exportCharacterCard(
  userId: string,
  input: CardExportInput,
): Promise<CardExportResult> {
  const { entryId, portrait } = input;
  const format = input.format ?? "json";
  if (typeof entryId !== "string" || entryId.length === 0) {
    throw invalid("entryId is required");
  }
  if (format !== "json" && format !== "png") {
    throw invalid("format must be json or png");
  }
  let portraitBytes: Uint8Array | null = null;
  if (format === "png") {
    if (typeof portrait !== "string" || portrait.trim() === "") {
      throw invalid("PNG export needs a portrait: upload a PNG image to embed the card in");
    }
    portraitBytes = decodePngBase64(portrait, "Portrait");
  } else if (portrait !== undefined && portrait !== null) {
    throw invalid("portrait is only used for PNG export");
  }

  const [row] = await loadOwnedLiveEntries(userId, [entryId]);
  const cardEnvelope = readCardEnvelope(row!.customFields);
  const aliasQuery = db.orm.public.CodexAlias.where((a) => a.entryId.eq(entryId)).where((a) =>
    a.deletedAt.isNull(),
  );
  const tagQuery = db.orm.public.CodexTag.where((t) => t.entryId.eq(entryId)).where((t) =>
    t.deletedAt.isNull(),
  );
  const [aliases, tags, embeddedBookEntries] = await Promise.all([
    aliasQuery.all(),
    tagQuery.all(),
    cardEnvelope.status === "ok" && cardEnvelope.envelope.embeddedBookImported
      ? loadImportedGroupBookSources(userId, cardEnvelope.envelope.groupId)
      : Promise.resolve(undefined),
  ]);

  const { card, warnings } = serializeCharacterCard({
    id: row!.id,
    name: row!.name,
    description: row!.description ?? "",
    type: row!.type,
    aliases: aliases.map((a) => a.name),
    tags: tags.map((t) => t.name),
    customFields: row!.customFields,
    embeddedBookEntries,
  });

  if (!portraitBytes) {
    return { filename: exportFilename(row!.name, "json", "character"), card, warnings };
  }
  const png = embedCardText(readPng(portraitBytes), utf8ToBase64(JSON.stringify(card)));
  return {
    filename: exportFilename(row!.name, "png", "character"),
    card,
    png: bytesToBase64(png),
    warnings,
  };
}
