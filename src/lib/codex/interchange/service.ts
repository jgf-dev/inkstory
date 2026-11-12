/**
 * Codex interchange orchestration (STO-1262): preview, transactional import
 * and export of SillyTavern lorebook JSON. Auth/ownership, scope and quota live
 * here; parsing and mapping live in the pure codec (`./lorebook`).
 */

import { Temporal } from "temporal-polyfill";
import { db } from "@/lib/prisma";
import { getEntitlements } from "@/lib/billing/entitlements";
import { CodexError } from "../errors";
import { resolveAndValidateScope } from "../service";
import type { CodexTrackingMode, CodexType } from "../types";
import { parseLorebook, serializeLorebook } from "./lorebook";
import {
  INTERCHANGE_ENVELOPE_KEY,
  INTERCHANGE_SCHEMA_VERSION,
  LOREBOOK_FORMAT,
  LOREBOOK_LIMITS,
  LOREBOOK_MAPPING_VERSION,
  type InterchangeEnvelope,
  type InterchangeWarning,
  type LorebookExportSource,
  type LorebookImportOptions,
  type LorebookPreview,
  type LorebookEntryDraft,
} from "./types";
import { invalid, isPlainObject, readInterchangeEnvelope } from "./validate";

const CODEX_TYPES = new Set<CodexType>([
  "CHARACTER",
  "LOCATION",
  "ITEM",
  "LORE",
  "FACTION",
  "CONCEPT",
  "OTHER",
]);
const TRACKING_MODES = new Set<CodexTrackingMode>(["ALWAYS", "DETECTED", "NEVER"]);

/** Parses a lorebook file and returns what an import would create. No DB access. */
export function previewLorebookImport(raw: unknown): LorebookPreview {
  return parseLorebook(raw).preview;
}

function applyActivationOverrides(
  drafts: LorebookEntryDraft[],
  overrides: unknown,
  warnings: InterchangeWarning[],
): void {
  if (overrides === undefined || overrides === null) return;
  if (!isPlainObject(overrides)) {
    throw invalid("activationOverrides must be an object keyed by sourceEntryKey");
  }
  const byKey = new Map(drafts.map((d) => [d.sourceEntryKey, d]));
  for (const [key, mode] of Object.entries(overrides)) {
    const draft = byKey.get(key);
    if (!draft) {
      throw invalid(`activationOverrides refers to unknown entry "${key}"`);
    }
    if (typeof mode !== "string" || !TRACKING_MODES.has(mode as CodexTrackingMode)) {
      throw invalid(`activationOverrides["${key}"] must be ALWAYS, DETECTED or NEVER`);
    }
    if (draft.activation === "disabled" && mode !== "NEVER") {
      warnings.push({
        code: "OVERRIDE_IGNORED",
        message: "Entry is disabled in the lorebook and stays NEVER.",
        sourceEntryKey: key,
      });
      continue;
    }
    draft.trackingMode = mode as CodexTrackingMode;
  }
}

export interface LorebookImportResult {
  groupId: string;
  created: Array<{
    id: string;
    name: string;
    sourceEntryKey: string;
    trackingMode: CodexTrackingMode;
  }>;
  warnings: InterchangeWarning[];
}

/**
 * Imports a lorebook as new Codex entries (create-copy; never overwrites).
 * The whole batch commits in one transaction: scope, ownership and the plan's
 * entry quota are checked inside it, so a failure leaves no partial import.
 */
export async function importLorebook(
  userId: string,
  raw: unknown,
  options: LorebookImportOptions = {},
): Promise<LorebookImportResult> {
  const parsed = parseLorebook(raw);
  const warnings = [...parsed.preview.warnings];

  const type = options.type ?? "LORE";
  if (!CODEX_TYPES.has(type)) {
    throw invalid("type must be a valid Codex entry type");
  }
  // Export compares against the mode the file's own flags imply, so record it
  // before overrides change the drafts.
  const parsedModes = new Map(parsed.drafts.map((d) => [d, d.trackingMode]));
  applyActivationOverrides(parsed.drafts, options.activationOverrides, warnings);

  const groupId = crypto.randomUUID();
  const now = Temporal.Now.plainDateTimeISO();
  const seriesScoped = Boolean(options.seriesScoped);

  const prepared = parsed.drafts.map((draft) => {
    const envelope: InterchangeEnvelope = {
      schemaVersion: INTERCHANGE_SCHEMA_VERSION,
      format: LOREBOOK_FORMAT,
      sourceVersion: parsed.preview.sourceVersion,
      groupId,
      sourceEntryKey: draft.sourceEntryKey,
      sourceOrder: draft.sourceOrder,
      originalEntry: draft.originalEntry,
      bookMetadata: parsed.bookMetadata,
      mappingVersion: LOREBOOK_MAPPING_VERSION,
      importedTrackingMode: parsedModes.get(draft) ?? draft.trackingMode,
      unsupportedFeatures: draft.unsupportedFeatures,
    };
    return { id: crypto.randomUUID(), draft, envelope };
  });

  await db.transaction(async (tx) => {
    // Serialize concurrent imports/creates for this user so the quota check holds.
    await tx.orm.public.User.where({ id: userId }).forNoKeyUpdate().first();
    const { resolvedNovelId, resolvedSeriesId } = await resolveAndValidateScope(
      userId,
      seriesScoped,
      options.novelId,
      options.seriesId,
      tx,
    );

    const limits = await getEntitlements(userId, tx);
    if (limits.maxCodexEntries !== Number.POSITIVE_INFINITY) {
      const existing = await tx.orm.public.CodexEntry.where((e) => e.ownerId.eq(userId))
        .where((e) => e.deletedAt.isNull())
        .all();
      if (existing.length + prepared.length > limits.maxCodexEntries) {
        throw new CodexError(
          `Plan limit reached: importing ${prepared.length} entries would exceed ${limits.maxCodexEntries} codex entries. Upgrade for unlimited entries.`,
          "QUOTA_EXCEEDED",
          402,
        );
      }
    }

    await tx.orm.public.CodexEntry.createAndCount(
      prepared.map(({ id, draft, envelope }) => ({
        id,
        ownerId: userId,
        name: draft.name,
        type,
        description: draft.description,
        notes: null,
        trackingMode: draft.trackingMode,
        seriesScoped,
        novelId: resolvedNovelId,
        seriesId: resolvedSeriesId,
        customFields: { [INTERCHANGE_ENVELOPE_KEY]: envelope } as any,
        color: null,
        thumbnailUrl: null,
        position: draft.sourceOrder,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })),
    );

    const aliasRows = prepared.flatMap(({ id, draft }) =>
      draft.aliases.map((name) => ({
        id: crypto.randomUUID(),
        entryId: id,
        name,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })),
    );
    if (aliasRows.length > 0) {
      await tx.orm.public.CodexAlias.createAndCount(aliasRows);
    }
  });

  return {
    groupId,
    created: prepared.map(({ id, draft }) => ({
      id,
      name: draft.name,
      sourceEntryKey: draft.sourceEntryKey,
      trackingMode: draft.trackingMode,
    })),
    warnings,
  };
}

export interface LorebookExportInput {
  entryIds?: unknown;
  name?: unknown;
}

export interface LorebookExportResult {
  filename: string;
  lorebook: Record<string, unknown>;
  warnings: InterchangeWarning[];
}

function exportFilename(name: string | null): string {
  const slug = (name ?? "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .toLowerCase()
    .slice(0, 80);
  return `${slug || "lorebook"}.json`;
}

/**
 * Exports the selected Codex entries as SillyTavern lorebook JSON. Every id
 * must be an active entry owned by the caller in a live novel/series;
 * anything else is reported as not found.
 */
export async function exportLorebook(
  userId: string,
  input: LorebookExportInput,
): Promise<LorebookExportResult> {
  const { entryIds, name } = input;
  if (
    !Array.isArray(entryIds) ||
    entryIds.length === 0 ||
    !entryIds.every((id) => typeof id === "string" && id.length > 0)
  ) {
    throw invalid("entryIds must be a non-empty list of entry ids");
  }
  const ids = [...new Set(entryIds as string[])];
  if (ids.length > LOREBOOK_LIMITS.maxEntries) {
    throw invalid(`Cannot export more than ${LOREBOOK_LIMITS.maxEntries} entries at once`);
  }
  if (name !== undefined && name !== null && typeof name !== "string") {
    throw invalid("name must be text");
  }

  const rows = await db.orm.public.CodexEntry.where((e) => e.id.in(ids))
    .where((e) => e.ownerId.eq(userId))
    .where((e) => e.deletedAt.isNull())
    .all();
  if (rows.length !== ids.length) {
    throw new CodexError("One or more codex entries were not found", "NOT_FOUND", 404);
  }

  const novelIds = [...new Set(rows.flatMap((r) => (r.novelId ? [r.novelId] : [])))];
  const seriesIds = [...new Set(rows.flatMap((r) => (r.seriesId ? [r.seriesId] : [])))];
  const [novels, series] = await Promise.all([
    novelIds.length > 0
      ? db.orm.public.Novel.where((n) => n.id.in(novelIds))
          .where((n) => n.deletedAt.isNull())
          .all()
      : [],
    seriesIds.length > 0
      ? db.orm.public.Series.where((s) => s.id.in(seriesIds))
          .where((s) => s.deletedAt.isNull())
          .all()
      : [],
  ]);
  const liveNovels = new Set(novels.map((n) => n.id));
  const liveSeries = new Set(series.map((s) => s.id));
  for (const row of rows) {
    const novelGone = row.novelId !== null && !liveNovels.has(row.novelId);
    const seriesGone = row.seriesScoped && row.seriesId !== null && !liveSeries.has(row.seriesId);
    if (novelGone || seriesGone) {
      throw new CodexError("One or more codex entries were not found", "NOT_FOUND", 404);
    }
  }

  const [aliases, tags, outgoing, incoming, progressions] = await Promise.all([
    db.orm.public.CodexAlias.where((a) => a.entryId.in(ids))
      .where((a) => a.deletedAt.isNull())
      .all(),
    db.orm.public.CodexTag.where((t) => t.entryId.in(ids))
      .where((t) => t.deletedAt.isNull())
      .all(),
    db.orm.public.CodexRelation.where((r) => r.sourceEntryId.in(ids))
      .where((r) => r.deletedAt.isNull())
      .all(),
    db.orm.public.CodexRelation.where((r) => r.targetEntryId.in(ids))
      .where((r) => r.deletedAt.isNull())
      .all(),
    db.orm.public.CodexProgression.where((p) => p.entryId.in(ids))
      .where((p) => p.deletedAt.isNull())
      .all(),
  ]);
  const aliasesByEntry = new Map<string, string[]>();
  for (const alias of aliases) {
    const list = aliasesByEntry.get(alias.entryId) ?? [];
    list.push(alias.name);
    aliasesByEntry.set(alias.entryId, list);
  }

  const sourceOrderOf = (customFields: unknown): number => {
    const read = readInterchangeEnvelope(customFields);
    return read.status === "ok" ? read.envelope.sourceOrder : 0;
  };
  const ordered = [...rows].sort(
    (a, b) =>
      a.position - b.position ||
      sourceOrderOf(a.customFields) - sourceOrderOf(b.customFields) ||
      a.name.localeCompare(b.name),
  );

  const sources: LorebookExportSource[] = ordered.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    trackingMode: row.trackingMode,
    aliases: aliasesByEntry.get(row.id) ?? [],
    customFields: row.customFields,
  }));

  const exportName = typeof name === "string" ? name : null;
  const { lorebook, warnings } = serializeLorebook(sources, { name: exportName });
  const dropsData =
    tags.length > 0 ||
    outgoing.length > 0 ||
    incoming.length > 0 ||
    progressions.length > 0 ||
    rows.some((row) => row.type !== "LORE");
  if (dropsData) {
    warnings.push({
      code: "NOT_PORTABLE",
      message: "Tags, entry types, relations and progressions are not part of lorebook JSON.",
    });
  }

  const bookName = typeof lorebook.name === "string" ? lorebook.name : exportName;
  return { filename: exportFilename(bookName), lorebook, warnings };
}
