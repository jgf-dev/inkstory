import { Temporal } from "temporal-polyfill";
import { db } from "@/lib/prisma";
import { CodexError } from "@/lib/codex/errors";
import type { CodexTrackingMode, CodexType, JsonValue } from "@/lib/codex/types";
import { ensureNovelQuota } from "@/lib/billing/entitlements";
import { countWords } from "@/lib/writing/word-count";

/**
 * Library service (launch phase 4): novel and series creation.
 *
 * Owns the paywall entry point for novels (`ensureNovelQuota`, 402
 * `QUOTA_EXCEEDED` on the Free tier's single-book cap) and validates series
 * ownership before a novel is attached to one.
 */

export interface CreateNovelInput {
  title: string;
  subtitle?: string | null;
  description?: string | null;
  seriesId?: string | null;
}

export interface CreateSeriesInput {
  title: string;
  description?: string | null;
}

const MAX_TITLE_LENGTH = 200;

function nowTimestamp(): Temporal.PlainDateTime {
  return Temporal.Now.plainDateTimeISO();
}

function assertTitle(title: unknown, label: string): string {
  const trimmed = typeof title === "string" ? title.trim() : "";
  if (!trimmed) {
    throw new CodexError(`${label} title cannot be empty`, "VALIDATION_FAILED", 422);
  }
  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new CodexError(
      `${label} title is too long (max ${MAX_TITLE_LENGTH} characters)`,
      "VALIDATION_FAILED",
      422,
    );
  }
  return trimmed;
}

/** Validates ownership of a referenced series, returning its id (or null). */
async function resolveOwnedSeries(
  userId: string,
  seriesId: string | null | undefined,
): Promise<string | null> {
  const trimmed = seriesId?.trim() || null;
  if (!trimmed) {
    return null;
  }

  const series = await db.orm.public.Series.where({ id: trimmed }).first();
  if (!series || series.deletedAt !== null) {
    throw new CodexError("Series not found", "NOT_FOUND", 404);
  }
  if (series.ownerId !== userId) {
    throw new CodexError("Unauthorized for this series", "FORBIDDEN", 403);
  }
  return series.id;
}

/**
 * Creates a novel owned by the user. Enforces the tier's novel quota
 * (Free: 1 novel) and, when `seriesId` is given, validates the series exists
 * and belongs to the caller.
 */
export async function createNovel(userId: string, input: CreateNovelInput) {
  const title = assertTitle(input.title, "Novel");
  await ensureNovelQuota(userId);

  const seriesId = await resolveOwnedSeries(userId, input.seriesId);
  const now = nowTimestamp();

  return db.orm.public.Novel.create({
    id: crypto.randomUUID(),
    title,
    subtitle: input.subtitle?.trim() || null,
    description: input.description?.trim() || null,
    position: 0,
    ownerId: userId,
    seriesId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
}

/** Creates a series owned by the user. */
export async function createSeries(userId: string, input: CreateSeriesInput) {
  const title = assertTitle(input.title, "Series");
  const now = nowTimestamp();

  return db.orm.public.Series.create({
    id: crypto.randomUUID(),
    title,
    description: input.description?.trim() || null,
    position: 0,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
}

// ─── Starter bible (onboarding) ──────────────────────────────────────────────

/**
 * Seeds a small sample fantasy bible for the current user: one series, one
 * novel, a two-scene outline, five codex entries with aliases, relations, a
 * progression, and custom fields. Repeated clicks resolve to the existing
 * sample series (title match) and return without duplicating.
 */
export async function seedStarterBible(userId: string) {
  const now = nowTimestamp();

  // Sample-series marker row lets repeat clicks resolve to the same series.
  const existing = await db.orm.public.Series.where((s) => s.ownerId.eq(userId))
    .where((s) => s.title.eq("The Ashfall Cycle"))
    .where((s) => s.deletedAt.isNull())
    .first();
  if (existing) {
    return { seriesId: existing.id, created: false as const };
  }

  // The sample bible includes a novel, so it must respect the tier's quota.
  await ensureNovelQuota(userId);

  const series = await db.orm.public.Series.create({
    id: crypto.randomUUID(),
    title: "The Ashfall Cycle",
    description: "Sample series — explore, edit, or delete everything.",
    position: 0,
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  const novel = await db.orm.public.Novel.create({
    id: crypto.randomUUID(),
    title: "The Glass Weaver",
    subtitle: "Book One of the Ashfall Cycle",
    description: "An archivist smuggler discovers the city's founding charter is a forgery.",
    position: 0,
    ownerId: userId,
    seriesId: series.id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  const act = await db.orm.public.Act.create({
    id: crypto.randomUUID(),
    title: "Act I — The Foundry",
    position: 0,
    novelId: novel.id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  const chapter = await db.orm.public.Chapter.create({
    id: crypto.randomUUID(),
    title: "Chapter One",
    position: 0,
    actId: act.id,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  const scene1Content =
    "Mara spread the charter across the quay stones, glass needles catching the last light. Below, the tide swallowed the archives gate by gate.";
  await db.orm.public.Scene.create({
    id: crypto.randomUUID(),
    title: "The Quay at Dusk",
    position: 0,
    chapterId: chapter.id,
    content: scene1Content,
    wordCount: countWords(scene1Content),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  const scene2Content = "The ink was wrong. Not faded — rewritten.";
  const scene2 = await db.orm.public.Scene.create({
    id: crypto.randomUUID(),
    title: "The Forgery",
    position: 1,
    chapterId: chapter.id,
    content: scene2Content,
    wordCount: countWords(scene2Content),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  async function createEntry(input: {
    name: string;
    type: CodexType;
    description: string;
    trackingMode: CodexTrackingMode;
    color: string;
    aliases?: string[];
    customFields?: Record<string, JsonValue>;
  }) {
    const entry = await db.orm.public.CodexEntry.create({
      id: crypto.randomUUID(),
      name: input.name,
      type: input.type,
      description: input.description,
      notes: null,
      trackingMode: input.trackingMode,
      seriesScoped: false,
      novelId: novel.id,
      seriesId: null,
      customFields: (input.customFields as any) ?? null,
      color: input.color,
      thumbnailUrl: null,
      position: 0,
      ownerId: userId,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    for (const aliasName of input.aliases ?? []) {
      await db.orm.public.CodexAlias.create({
        id: crypto.randomUUID(),
        name: aliasName,
        entryId: entry.id,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    }

    return entry;
  }

  const mara = await createEntry({
    name: "Mara Vance",
    type: "CHARACTER",
    description: "Ex-smuggler turned archivist. Weaves glass needles that record what they touch.",
    trackingMode: "ALWAYS",
    color: "#3b82f6",
    aliases: ["Rook", "The Glass Weaver"],
    customFields: { Age: 34, Ship: "Rook's Wake", Exiled: true },
  });

  const archives = await createEntry({
    name: "Sunken Archives",
    type: "LOCATION",
    description:
      "Tide-flooded library beneath the harbor. Its gates only open at low tide — and only to archivists.",
    trackingMode: "DETECTED",
    color: "#10b981",
    customFields: { Founded: "Year 312" },
  });

  const charter = await createEntry({
    name: "The Ashfall Charter",
    type: "LORE",
    description: "Founding treaty of the free cities, allegedly signed in volcanic glass.",
    trackingMode: "ALWAYS",
    color: "#f59e0b",
    aliases: ["the Charter"],
  });

  const kaelen = await createEntry({
    name: "Kaelen Ashwright",
    type: "CHARACTER",
    description: "The city's chief forger — and Mara's former mentor. Signed the Charter twice.",
    trackingMode: "DETECTED",
    color: "#8b5cf6",
    aliases: ["the Forger"],
  });

  await createEntry({
    name: "Glass Needles",
    type: "ITEM",
    description: "Archivist tools that record conversations into their facets. Illegal to own.",
    trackingMode: "DETECTED",
    color: "#ec4899",
  });

  // Relations: Mara → mentor → Kaelen; Kaelen → forger of → Charter; Charter → sealed in → Archives
  async function createRelation(input: {
    sourceId: string;
    targetId: string;
    relationType: string;
    reverseType: string | null;
    description: string | null;
  }) {
    return db.orm.public.CodexRelation.create({
      id: crypto.randomUUID(),
      sourceEntryId: input.sourceId,
      targetEntryId: input.targetId,
      relationType: input.relationType,
      reverseType: input.reverseType,
      description: input.description,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  await createRelation({
    sourceId: mara.id,
    targetId: kaelen.id,
    relationType: "MENTOR",
    reverseType: "APPRENTICE",
    description: "Taught her to read the glass. Also taught her to forge.",
  });
  await createRelation({
    sourceId: kaelen.id,
    targetId: charter.id,
    relationType: "FORGER_OF",
    reverseType: null,
    description: "The second signature is his hand.",
  });
  await createRelation({
    sourceId: charter.id,
    targetId: archives.id,
    relationType: "SEALED_IN",
    reverseType: null,
    description: "Rests in the flooded vault, behind three tide gates.",
  });

  // Progression: the Charter's description changes once the forgery is revealed.
  await db.orm.public.CodexProgression.create({
    id: crypto.randomUUID(),
    entryId: charter.id,
    sceneId: scene2.id,
    mode: "ADDITION",
    description: "Mara has confirmed the second signature is a forgery.",
    notes: null,
    position: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });

  return {
    seriesId: series.id,
    novelId: novel.id,
    created: true as const,
  };
}
