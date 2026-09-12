import { Temporal } from "temporal-polyfill";
import { db } from "@/lib/prisma";
import { detectMentionsInText, type MentionDetectionResult } from "./mention-detection";
import type {
  CodexEntryFilter,
  CreateCodexAliasInput,
  CreateCodexEntryInput,
  CreateCodexProgressionInput,
  CreateCodexRelationInput,
  CreateCodexTagInput,
  UpdateCodexEntryInput,
  UpdateCodexProgressionInput,
  UpdateCodexRelationInput,
} from "./types";

/**
 * Custom error class for Codex domain validation and authorization failures.
 */
export class CodexError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "VALIDATION_FAILED"
      | "SCOPING_ERROR"
      | "CONFLICT",
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "CodexError";
  }
}

/**
 * Standardized API error handler for Codex REST routes.
 * Ensures malformed JSON (SyntaxError) returns 400 instead of 500.
 */
export function handleCodexApiError(err: unknown): Response {
  if (err instanceof SyntaxError) {
    return Response.json(
      { error: "Malformed or invalid JSON body", code: "INVALID_JSON" },
      { status: 400 },
    );
  }
  if (err instanceof CodexError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

function nowTimestamp(): Temporal.PlainDateTime {
  return Temporal.Now.plainDateTimeISO();
}

/**
 * Validates ownership and resolves scope for a Codex Entry.
 */
async function resolveAndValidateScope(
  userId: string,
  seriesScoped: boolean,
  novelId?: string | null,
  seriesId?: string | null,
): Promise<{ resolvedNovelId: string | null; resolvedSeriesId: string | null }> {
  if (seriesScoped) {
    if (!seriesId) {
      throw new CodexError("Series-scoped codex entries require a seriesId", "SCOPING_ERROR", 422);
    }
    const series = await db.orm.public.Series.where({ id: seriesId }).first();
    if (!series || series.deletedAt !== null) {
      throw new CodexError("Series not found", "NOT_FOUND", 404);
    }
    if (series.ownerId !== userId) {
      throw new CodexError(
        "You do not have permission to attach entries to this series",
        "FORBIDDEN",
        403,
      );
    }
    // Series-scoped entries belong to the entire series, so novelId is null.
    return { resolvedNovelId: null, resolvedSeriesId: series.id };
  }

  // Book-scoped entry
  if (!novelId) {
    throw new CodexError("Book-scoped codex entries require a novelId", "SCOPING_ERROR", 422);
  }
  const novel = await db.orm.public.Novel.where({ id: novelId }).first();
  if (!novel || novel.deletedAt !== null) {
    throw new CodexError("Novel not found", "NOT_FOUND", 404);
  }
  if (novel.ownerId !== userId) {
    throw new CodexError(
      "You do not have permission to attach entries to this novel",
      "FORBIDDEN",
      403,
    );
  }

  // If the novel belongs to a series, inherit seriesId for cross-query optimization
  return {
    resolvedNovelId: novel.id,
    resolvedSeriesId: novel.seriesId ?? null,
  };
}

/**
 * Resolves the novel and owner context for a given scene.
 */
async function resolveSceneContext(
  sceneId: string,
): Promise<{ novelId: string; seriesId: string | null; ownerId: string }> {
  const scene = await db.orm.public.Scene.where({ id: sceneId }).first();
  if (!scene || scene.deletedAt !== null) {
    throw new CodexError("Scene not found", "NOT_FOUND", 404);
  }

  const chapter = await db.orm.public.Chapter.where({ id: scene.chapterId }).first();
  if (!chapter || chapter.deletedAt !== null) {
    throw new CodexError("Chapter not found for scene", "NOT_FOUND", 404);
  }

  const act = await db.orm.public.Act.where({ id: chapter.actId }).first();
  if (!act || act.deletedAt !== null) {
    throw new CodexError("Act not found for scene", "NOT_FOUND", 404);
  }

  const novel = await db.orm.public.Novel.where({ id: act.novelId }).first();
  if (!novel || novel.deletedAt !== null) {
    throw new CodexError("Novel not found for scene", "NOT_FOUND", 404);
  }

  return {
    novelId: novel.id,
    seriesId: novel.seriesId,
    ownerId: novel.ownerId,
  };
}

// ─── Entry CRUD ──────────────────────────────────────────────────────────────

export async function createCodexEntry(userId: string, input: CreateCodexEntryInput) {
  const trimmedName = input.name?.trim();
  if (!trimmedName) {
    throw new CodexError("Entry name cannot be empty", "VALIDATION_FAILED", 422);
  }

  const isSeriesScoped = Boolean(input.seriesScoped);
  const { resolvedNovelId, resolvedSeriesId } = await resolveAndValidateScope(
    userId,
    isSeriesScoped,
    input.novelId,
    input.seriesId,
  );

  const now = nowTimestamp();
  const entryId = crypto.randomUUID();

  const entry = await db.orm.public.CodexEntry.create({
    id: entryId,
    ownerId: userId,
    name: trimmedName,
    type: input.type ?? "CHARACTER",
    description: input.description ?? "",
    notes: input.notes ?? null,
    trackingMode: input.trackingMode ?? "DETECTED",
    seriesScoped: isSeriesScoped,
    novelId: resolvedNovelId,
    seriesId: resolvedSeriesId,
    customFields: (input.customFields as any) ?? null,
    color: input.color ?? null,
    thumbnailUrl: input.thumbnailUrl ?? null,
    position: input.position ?? 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  // Create optional initial aliases
  if (input.aliases && input.aliases.length > 0) {
    for (const aliasName of input.aliases) {
      const trimmed = aliasName.trim();
      if (trimmed) {
        await db.orm.public.CodexAlias.create({
          id: crypto.randomUUID(),
          entryId: entry.id,
          name: trimmed,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }
    }
  }

  // Create optional initial tags
  if (input.tags && input.tags.length > 0) {
    for (const tag of input.tags) {
      const trimmed = tag.name?.trim();
      if (trimmed) {
        await db.orm.public.CodexTag.create({
          id: crypto.randomUUID(),
          entryId: entry.id,
          name: trimmed,
          color: tag.color ?? null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
      }
    }
  }

  return getCodexEntry(userId, entry.id);
}

export async function getCodexEntry(userId: string, entryId: string) {
  const entry = await db.orm.public.CodexEntry.where({ id: entryId }).first();
  if (!entry || entry.deletedAt !== null) {
    throw new CodexError("Codex entry not found", "NOT_FOUND", 404);
  }

  if (entry.ownerId !== userId) {
    throw new CodexError("Unauthorized to view this codex entry", "FORBIDDEN", 403);
  }

  const [aliases, tags, rawSourceRelations, rawTargetRelations, progressions] = await Promise.all([
    db.orm.public.CodexAlias.where((a) => a.entryId.eq(entryId))
      .where((a) => a.deletedAt.isNull())
      .all(),
    db.orm.public.CodexTag.where((t) => t.entryId.eq(entryId))
      .where((t) => t.deletedAt.isNull())
      .all(),
    db.orm.public.CodexRelation.where((r) => r.sourceEntryId.eq(entryId))
      .where((r) => r.deletedAt.isNull())
      .all(),
    db.orm.public.CodexRelation.where((r) => r.targetEntryId.eq(entryId))
      .where((r) => r.deletedAt.isNull())
      .all(),
    db.orm.public.CodexProgression.where((p) => p.entryId.eq(entryId))
      .where((p) => p.deletedAt.isNull())
      .orderBy((p) => p.position.asc())
      .all(),
  ]);

  // Resolve related entries for active relations
  const relatedTargetIds = rawSourceRelations.map((r) => r.targetEntryId);
  const relatedSourceIds = rawTargetRelations.map((r) => r.sourceEntryId);
  const allRelatedIds = Array.from(new Set([...relatedTargetIds, ...relatedSourceIds]));

  const relatedEntries =
    allRelatedIds.length > 0
      ? await db.orm.public.CodexEntry.where((e) => e.id.in(allRelatedIds))
          .where((e) => e.deletedAt.isNull())
          .all()
      : [];

  const relatedMap = new Map(
    relatedEntries.map((e) => [e.id, { id: e.id, name: e.name, type: e.type }]),
  );

  const sourceRelations = rawSourceRelations
    .filter((r) => relatedMap.has(r.targetEntryId))
    .map((r) => ({
      ...r,
      targetEntry: relatedMap.get(r.targetEntryId)!,
    }));

  const targetRelations = rawTargetRelations
    .filter((r) => relatedMap.has(r.sourceEntryId))
    .map((r) => ({
      ...r,
      sourceEntry: relatedMap.get(r.sourceEntryId)!,
    }));

  return {
    ...entry,
    aliases,
    tags,
    sourceRelations,
    targetRelations,
    progressions,
  };
}

export async function updateCodexEntry(
  userId: string,
  entryId: string,
  input: UpdateCodexEntryInput,
) {
  const entry = await db.orm.public.CodexEntry.where({ id: entryId }).first();
  if (!entry || entry.deletedAt !== null) {
    throw new CodexError("Codex entry not found", "NOT_FOUND", 404);
  }

  if (entry.ownerId !== userId) {
    throw new CodexError("Unauthorized to update this codex entry", "FORBIDDEN", 403);
  }

  const now = nowTimestamp();
  const updateData: Record<string, unknown> = {
    updatedAt: now,
  };

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) {
      throw new CodexError("Entry name cannot be empty", "VALIDATION_FAILED", 422);
    }
    updateData.name = trimmed;
  }

  if (input.type !== undefined) updateData.type = input.type;
  if (input.description !== undefined) updateData.description = input.description;
  if (input.notes !== undefined) updateData.notes = input.notes;
  if (input.trackingMode !== undefined) updateData.trackingMode = input.trackingMode;
  if (input.customFields !== undefined) updateData.customFields = input.customFields;
  if (input.color !== undefined) updateData.color = input.color;
  if (input.thumbnailUrl !== undefined) updateData.thumbnailUrl = input.thumbnailUrl;
  if (input.position !== undefined) updateData.position = input.position;

  // Handle scoping update if seriesScoped, novelId, or seriesId changed
  const isSeriesScoped = input.seriesScoped !== undefined ? input.seriesScoped : entry.seriesScoped;

  if (
    input.seriesScoped !== undefined ||
    input.novelId !== undefined ||
    input.seriesId !== undefined
  ) {
    const targetNovelId = input.novelId !== undefined ? input.novelId : entry.novelId;
    const targetSeriesId = input.seriesId !== undefined ? input.seriesId : entry.seriesId;

    const { resolvedNovelId, resolvedSeriesId } = await resolveAndValidateScope(
      userId,
      isSeriesScoped,
      targetNovelId,
      targetSeriesId,
    );

    updateData.seriesScoped = isSeriesScoped;
    updateData.novelId = resolvedNovelId;
    updateData.seriesId = resolvedSeriesId;
  }

  await db.orm.public.CodexEntry.where({ id: entryId }).update(updateData);
  return getCodexEntry(userId, entryId);
}

export async function deleteCodexEntry(userId: string, entryId: string, hardDelete = false) {
  const entry = await db.orm.public.CodexEntry.where({ id: entryId }).first();
  if (!entry || entry.deletedAt !== null) {
    throw new CodexError("Codex entry not found", "NOT_FOUND", 404);
  }

  if (entry.ownerId !== userId) {
    throw new CodexError("Unauthorized to delete this codex entry", "FORBIDDEN", 403);
  }

  if (hardDelete) {
    await db.orm.public.CodexEntry.where({ id: entryId }).delete();
    return { success: true, id: entryId, deleted: "hard" as const };
  }

  const now = nowTimestamp();
  await db.orm.public.CodexEntry.where({ id: entryId }).update({
    deletedAt: now,
    updatedAt: now,
  });

  // Soft-delete relations, aliases, tags, progressions for this entry
  await Promise.all([
    db.orm.public.CodexRelation.where((r) => r.sourceEntryId.eq(entryId))
      .where((r) => r.deletedAt.isNull())
      .update({ deletedAt: now, updatedAt: now }),
    db.orm.public.CodexRelation.where((r) => r.targetEntryId.eq(entryId))
      .where((r) => r.deletedAt.isNull())
      .update({ deletedAt: now, updatedAt: now }),
    db.orm.public.CodexAlias.where((a) => a.entryId.eq(entryId))
      .where((a) => a.deletedAt.isNull())
      .update({ deletedAt: now, updatedAt: now }),
    db.orm.public.CodexTag.where((t) => t.entryId.eq(entryId))
      .where((t) => t.deletedAt.isNull())
      .update({ deletedAt: now, updatedAt: now }),
    db.orm.public.CodexProgression.where((p) => p.entryId.eq(entryId))
      .where((p) => p.deletedAt.isNull())
      .update({ deletedAt: now, updatedAt: now }),
  ]);

  return { success: true, id: entryId, deleted: "soft" as const };
}

async function attachAliasesAndTags<T extends { id: string }>(candidates: T[]) {
  const candidateIds = candidates.map((c) => c.id);
  if (candidateIds.length === 0) {
    return [];
  }

  const [aliases, tags] = await Promise.all([
    db.orm.public.CodexAlias.where((a) => a.entryId.in(candidateIds))
      .where((a) => a.deletedAt.isNull())
      .all(),
    db.orm.public.CodexTag.where((t) => t.entryId.in(candidateIds))
      .where((t) => t.deletedAt.isNull())
      .all(),
  ]);

  const aliasByEntry = new Map<string, typeof aliases>();
  for (const a of aliases) {
    const list = aliasByEntry.get(a.entryId) ?? [];
    list.push(a);
    aliasByEntry.set(a.entryId, list);
  }

  const tagsByEntry = new Map<string, typeof tags>();
  for (const t of tags) {
    const list = tagsByEntry.get(t.entryId) ?? [];
    list.push(t);
    tagsByEntry.set(t.entryId, list);
  }

  return candidates.map((e) => ({
    ...e,
    aliases: aliasByEntry.get(e.id) ?? [],
    tags: tagsByEntry.get(e.id) ?? [],
  }));
}

/**
 * Lists Codex entries accessible to a novel:
 * - Book-scoped entries (novelId === novel.id AND seriesScoped === false)
 * - Series-scoped entries (seriesId === novel.seriesId AND seriesScoped === true)
 */
export async function listCodexEntriesForNovel(
  userId: string,
  novelId: string,
  filter?: CodexEntryFilter,
) {
  const novel = await db.orm.public.Novel.where({ id: novelId }).first();
  if (!novel || novel.deletedAt !== null) {
    throw new CodexError("Novel not found", "NOT_FOUND", 404);
  }
  if (novel.ownerId !== userId) {
    throw new CodexError("Unauthorized to access codex for this novel", "FORBIDDEN", 403);
  }

  // Fetch book-scoped entries for this novel
  const bookEntries = await db.orm.public.CodexEntry.where((e) => e.novelId.eq(novel.id))
    .where((e) => e.ownerId.eq(userId))
    .where((e) => e.deletedAt.isNull())
    .all();

  // Fetch series-scoped entries if novel belongs to a series
  let seriesEntries: typeof bookEntries = [];
  if (novel.seriesId) {
    seriesEntries = await db.orm.public.CodexEntry.where((e) => e.seriesId.eq(novel.seriesId))
      .where((e) => e.ownerId.eq(userId))
      .where((e) => e.seriesScoped.eq(true))
      .where((e) => e.deletedAt.isNull())
      .all();
  }

  // Combine and deduplicate
  const allEntriesMap = new Map<string, (typeof bookEntries)[number]>();
  for (const entry of bookEntries) {
    allEntriesMap.set(entry.id, entry);
  }
  for (const entry of seriesEntries) {
    allEntriesMap.set(entry.id, entry);
  }

  let candidates = Array.from(allEntriesMap.values());

  // Apply in-memory filters
  if (filter?.type) {
    candidates = candidates.filter((e) => e.type === filter.type);
  }
  if (filter?.trackingMode) {
    candidates = candidates.filter((e) => e.trackingMode === filter.trackingMode);
  }
  if (filter?.search) {
    const q = filter.search.toLowerCase();
    candidates = candidates.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.notes && e.notes.toLowerCase().includes(q)),
    );
  }

  const enriched = await attachAliasesAndTags(candidates);
  return enriched.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

/**
 * Lists Codex entries for an entire Series:
 * - seriesOnly = true: only entries with seriesScoped = true
 * - seriesOnly = false: series-scoped + all novels under that series
 */
export async function listCodexEntriesForSeries(
  userId: string,
  seriesId: string,
  filter?: CodexEntryFilter,
) {
  const series = await db.orm.public.Series.where({ id: seriesId }).first();
  if (!series || series.deletedAt !== null) {
    throw new CodexError("Series not found", "NOT_FOUND", 404);
  }
  if (series.ownerId !== userId) {
    throw new CodexError("Unauthorized to access codex for this series", "FORBIDDEN", 403);
  }

  let candidates: Awaited<ReturnType<typeof db.orm.public.CodexEntry.all>>;

  if (filter?.seriesOnly) {
    candidates = await db.orm.public.CodexEntry.where((e) => e.seriesId.eq(series.id))
      .where((e) => e.ownerId.eq(userId))
      .where((e) => e.seriesScoped.eq(true))
      .where((e) => e.deletedAt.isNull())
      .all();
  } else {
    // Both series-scoped and entries associated with this series
    candidates = await db.orm.public.CodexEntry.where((e) => e.seriesId.eq(series.id))
      .where((e) => e.ownerId.eq(userId))
      .where((e) => e.deletedAt.isNull())
      .all();
  }

  if (filter?.type) {
    candidates = candidates.filter((e) => e.type === filter.type);
  }
  if (filter?.trackingMode) {
    candidates = candidates.filter((e) => e.trackingMode === filter.trackingMode);
  }
  if (filter?.search) {
    const q = filter.search.toLowerCase();
    candidates = candidates.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        (e.notes && e.notes.toLowerCase().includes(q)),
    );
  }

  const enriched = await attachAliasesAndTags(candidates);
  return enriched.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
}

// ─── Alias & Tag CRUD ────────────────────────────────────────────────────────

export async function createCodexAlias(userId: string, input: CreateCodexAliasInput) {
  const trimmed = input.name?.trim();
  if (!trimmed) {
    throw new CodexError("Alias name cannot be empty", "VALIDATION_FAILED", 422);
  }

  const entry = await db.orm.public.CodexEntry.where({ id: input.entryId }).first();
  if (!entry || entry.deletedAt !== null) {
    throw new CodexError("Codex entry not found", "NOT_FOUND", 404);
  }
  if (entry.ownerId !== userId) {
    throw new CodexError("Unauthorized to add alias to this entry", "FORBIDDEN", 403);
  }

  const now = nowTimestamp();
  const alias = await db.orm.public.CodexAlias.create({
    id: crypto.randomUUID(),
    entryId: entry.id,
    name: trimmed,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  return alias;
}

export async function deleteCodexAlias(userId: string, aliasId: string) {
  const alias = await db.orm.public.CodexAlias.where({ id: aliasId }).first();
  if (!alias || alias.deletedAt !== null) {
    throw new CodexError("Alias not found", "NOT_FOUND", 404);
  }

  const entry = await db.orm.public.CodexEntry.where({ id: alias.entryId }).first();
  if (!entry || entry.ownerId !== userId) {
    throw new CodexError("Unauthorized to delete this alias", "FORBIDDEN", 403);
  }

  await db.orm.public.CodexAlias.where({ id: aliasId }).delete();
  return { success: true, id: aliasId };
}

export async function createCodexTag(userId: string, input: CreateCodexTagInput) {
  const trimmed = input.name?.trim();
  if (!trimmed) {
    throw new CodexError("Tag name cannot be empty", "VALIDATION_FAILED", 422);
  }

  const entry = await db.orm.public.CodexEntry.where({ id: input.entryId }).first();
  if (!entry || entry.deletedAt !== null) {
    throw new CodexError("Codex entry not found", "NOT_FOUND", 404);
  }
  if (entry.ownerId !== userId) {
    throw new CodexError("Unauthorized to add tag to this entry", "FORBIDDEN", 403);
  }

  const now = nowTimestamp();
  const tag = await db.orm.public.CodexTag.create({
    id: crypto.randomUUID(),
    entryId: entry.id,
    name: trimmed,
    color: input.color ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  return tag;
}

export async function deleteCodexTag(userId: string, tagId: string) {
  const tag = await db.orm.public.CodexTag.where({ id: tagId }).first();
  if (!tag || tag.deletedAt !== null) {
    throw new CodexError("Tag not found", "NOT_FOUND", 404);
  }

  const entry = await db.orm.public.CodexEntry.where({ id: tag.entryId }).first();
  if (!entry || entry.ownerId !== userId) {
    throw new CodexError("Unauthorized to delete this tag", "FORBIDDEN", 403);
  }

  await db.orm.public.CodexTag.where({ id: tagId }).delete();
  return { success: true, id: tagId };
}

// ─── Relation CRUD ───────────────────────────────────────────────────────────

export async function createCodexRelation(userId: string, input: CreateCodexRelationInput) {
  if (input.sourceEntryId === input.targetEntryId) {
    throw new CodexError("An entry cannot have a relation to itself", "VALIDATION_FAILED", 422);
  }

  const trimmedType = input.relationType?.trim();
  if (!trimmedType) {
    throw new CodexError("Relation type cannot be empty", "VALIDATION_FAILED", 422);
  }

  const [source, target] = await Promise.all([
    db.orm.public.CodexEntry.where({ id: input.sourceEntryId }).first(),
    db.orm.public.CodexEntry.where({ id: input.targetEntryId }).first(),
  ]);

  if (!source || source.deletedAt !== null) {
    throw new CodexError("Source codex entry not found", "NOT_FOUND", 404);
  }
  if (!target || target.deletedAt !== null) {
    throw new CodexError("Target codex entry not found", "NOT_FOUND", 404);
  }

  if (source.ownerId !== userId || target.ownerId !== userId) {
    throw new CodexError(
      "Unauthorized: both entries must belong to the active user",
      "FORBIDDEN",
      403,
    );
  }

  // Cross-scope check: if both entries are book-scoped to distinct novels and share no series
  if (!source.seriesScoped && !target.seriesScoped && source.novelId !== target.novelId) {
    if (!source.seriesId || source.seriesId !== target.seriesId) {
      throw new CodexError(
        "Cannot relate entries from different novels outside a shared series",
        "SCOPING_ERROR",
        422,
      );
    }
  }

  const now = nowTimestamp();
  const relation = await db.orm.public.CodexRelation.create({
    id: crypto.randomUUID(),
    sourceEntryId: source.id,
    targetEntryId: target.id,
    relationType: trimmedType,
    reverseType: input.reverseType?.trim() || null,
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  return relation;
}

export async function updateCodexRelation(
  userId: string,
  relationId: string,
  input: UpdateCodexRelationInput,
) {
  const relation = await db.orm.public.CodexRelation.where({ id: relationId }).first();
  if (!relation || relation.deletedAt !== null) {
    throw new CodexError("Relation not found", "NOT_FOUND", 404);
  }

  const source = await db.orm.public.CodexEntry.where({ id: relation.sourceEntryId }).first();
  if (!source || source.ownerId !== userId) {
    throw new CodexError("Unauthorized to update this relation", "FORBIDDEN", 403);
  }

  const updateData: Record<string, unknown> = {
    updatedAt: nowTimestamp(),
  };

  if (input.relationType !== undefined) {
    const trimmed = input.relationType.trim();
    if (!trimmed) {
      throw new CodexError("Relation type cannot be empty", "VALIDATION_FAILED", 422);
    }
    updateData.relationType = trimmed;
  }
  if (input.reverseType !== undefined) updateData.reverseType = input.reverseType?.trim() || null;
  if (input.description !== undefined) updateData.description = input.description;

  await db.orm.public.CodexRelation.where({ id: relationId }).update(updateData);

  return db.orm.public.CodexRelation.where({ id: relationId }).first();
}

export async function deleteCodexRelation(userId: string, relationId: string) {
  const relation = await db.orm.public.CodexRelation.where({ id: relationId }).first();
  if (!relation || relation.deletedAt !== null) {
    throw new CodexError("Relation not found", "NOT_FOUND", 404);
  }

  const source = await db.orm.public.CodexEntry.where({ id: relation.sourceEntryId }).first();
  if (!source || source.ownerId !== userId) {
    throw new CodexError("Unauthorized to delete this relation", "FORBIDDEN", 403);
  }

  await db.orm.public.CodexRelation.where({ id: relationId }).delete();
  return { success: true, id: relationId };
}

// ─── Progression CRUD ────────────────────────────────────────────────────────

export async function createCodexProgression(userId: string, input: CreateCodexProgressionInput) {
  const trimmedDesc = input.description?.trim();
  if (!trimmedDesc) {
    throw new CodexError("Progression description cannot be empty", "VALIDATION_FAILED", 422);
  }

  const entry = await db.orm.public.CodexEntry.where({ id: input.entryId }).first();
  if (!entry || entry.deletedAt !== null) {
    throw new CodexError("Codex entry not found", "NOT_FOUND", 404);
  }
  if (entry.ownerId !== userId) {
    throw new CodexError("Unauthorized for this codex entry", "FORBIDDEN", 403);
  }

  const sceneContext = await resolveSceneContext(input.sceneId);
  if (sceneContext.ownerId !== userId) {
    throw new CodexError("Unauthorized for this scene", "FORBIDDEN", 403);
  }

  // Scoping check: is the entry accessible in the scene's novel?
  if (entry.seriesScoped) {
    if (!sceneContext.seriesId || entry.seriesId !== sceneContext.seriesId) {
      throw new CodexError(
        "Series-scoped entry does not belong to the scene's series",
        "SCOPING_ERROR",
        422,
      );
    }
  } else {
    if (entry.novelId !== sceneContext.novelId) {
      throw new CodexError(
        "Book-scoped entry cannot be linked to a scene in a different novel",
        "SCOPING_ERROR",
        422,
      );
    }
  }

  const now = nowTimestamp();
  const progression = await db.orm.public.CodexProgression.create({
    id: crypto.randomUUID(),
    entryId: entry.id,
    sceneId: input.sceneId,
    mode: input.mode ?? "ADDITION",
    description: trimmedDesc,
    notes: input.notes ?? null,
    position: input.position ?? 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  return progression;
}

export async function updateCodexProgression(
  userId: string,
  progressionId: string,
  input: UpdateCodexProgressionInput,
) {
  const progression = await db.orm.public.CodexProgression.where({ id: progressionId }).first();
  if (!progression || progression.deletedAt !== null) {
    throw new CodexError("Progression not found", "NOT_FOUND", 404);
  }

  const entry = await db.orm.public.CodexEntry.where({ id: progression.entryId }).first();
  if (!entry || entry.ownerId !== userId) {
    throw new CodexError("Unauthorized to update this progression", "FORBIDDEN", 403);
  }

  const updateData: Record<string, unknown> = {
    updatedAt: nowTimestamp(),
  };

  if (input.mode !== undefined) updateData.mode = input.mode;
  if (input.description !== undefined) {
    const trimmed = input.description.trim();
    if (!trimmed) {
      throw new CodexError("Progression description cannot be empty", "VALIDATION_FAILED", 422);
    }
    updateData.description = trimmed;
  }
  if (input.notes !== undefined) updateData.notes = input.notes;
  if (input.position !== undefined) updateData.position = input.position;

  await db.orm.public.CodexProgression.where({ id: progressionId }).update(updateData);

  return db.orm.public.CodexProgression.where({ id: progressionId }).first();
}

export async function deleteCodexProgression(userId: string, progressionId: string) {
  const progression = await db.orm.public.CodexProgression.where({ id: progressionId }).first();
  if (!progression || progression.deletedAt !== null) {
    throw new CodexError("Progression not found", "NOT_FOUND", 404);
  }

  const entry = await db.orm.public.CodexEntry.where({ id: progression.entryId }).first();
  if (!entry || entry.ownerId !== userId) {
    throw new CodexError("Unauthorized to delete this progression", "FORBIDDEN", 403);
  }

  await db.orm.public.CodexProgression.where({ id: progressionId }).delete();
  return { success: true, id: progressionId };
}

// ─── Mention Detection Scanner ───────────────────────────────────────────────

export async function scanMentionsInNovel(
  userId: string,
  novelId: string,
  text: string,
): Promise<MentionDetectionResult> {
  const entries = await listCodexEntriesForNovel(userId, novelId);
  return detectMentionsInText(text, entries);
}

export async function scanMentionsInScene(
  userId: string,
  sceneId: string,
  text?: string,
): Promise<MentionDetectionResult> {
  const scene = await db.orm.public.Scene.where({ id: sceneId }).first();
  if (!scene || scene.deletedAt !== null) {
    throw new CodexError("Scene not found", "NOT_FOUND", 404);
  }

  const sceneContext = await resolveSceneContext(sceneId);
  if (sceneContext.ownerId !== userId) {
    throw new CodexError("Unauthorized to access scene", "FORBIDDEN", 403);
  }

  const textToScan =
    text !== undefined ? text : [scene.content, scene.summary].filter(Boolean).join("\n\n");

  if (!textToScan.trim()) {
    return { matches: [], matchedEntryIds: [] };
  }

  const entries = await listCodexEntriesForNovel(userId, sceneContext.novelId);
  return detectMentionsInText(textToScan, entries);
}
