import { Temporal } from "temporal-polyfill";
import { db } from "@/lib/prisma";
import { CodexError } from "@/lib/codex/errors";
import { ensureNovelQuota } from "@/lib/billing/entitlements";

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
