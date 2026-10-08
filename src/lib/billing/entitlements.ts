/**
 * Tier entitlements and quota guards (STO-1180).
 *
 * Guards throw `CodexError` with code `QUOTA_EXCEEDED` (HTTP 402) so API
 * routes and UI share one upgrade-trigger contract. Entitlements are read
 * from the User row's `planTier`; there is no per-request Stripe call.
 */

import { db } from "@/lib/prisma";
import { CodexError } from "@/lib/codex/errors";
import { DEFAULT_PLAN_TIER, PLANS, type PlanTier, type PlanLimits } from "./plans";

export type { PlanLimits, PlanTier };

/** Reads the effective plan tier for a user (missing/deleted users are Free). */
export async function getPlanTierForUser(userId: string): Promise<PlanTier> {
  const user = await db.orm.public.User.where({ id: userId }).first();
  if (!user || user.deletedAt !== null) {
    return DEFAULT_PLAN_TIER;
  }
  return user.planTier;
}

/** Resolves the entitlement limits in effect for a user. */
export async function getEntitlements(userId: string): Promise<PlanLimits> {
  return PLANS[await getPlanTierForUser(userId)];
}

/**
 * Guard: the user may create another novel.
 *
 * @throws {CodexError} QUOTA_EXCEEDED (402) when the tier's `maxNovels` cap
 *   is reached.
 */
export async function ensureNovelQuota(userId: string): Promise<void> {
  const limits = await getEntitlements(userId);
  if (limits.maxNovels === Number.POSITIVE_INFINITY) {
    return;
  }

  const novels = await db.orm.public.Novel.where((n) => n.ownerId.eq(userId))
    .where((n) => n.deletedAt.isNull())
    .all();
  if (novels.length >= limits.maxNovels) {
    throw new CodexError(
      `Plan limit reached: ${limits.maxNovels} novel${limits.maxNovels === 1 ? "" : "s"}. Upgrade to create more.`,
      "QUOTA_EXCEEDED",
      402,
    );
  }
}

/**
 * Guard: the user may create another Codex entry (counts entries across all
 * of the user's books — the Free tier is single-book anyway).
 *
 * @throws {CodexError} QUOTA_EXCEEDED (402) when the tier's `maxCodexEntries`
 *   cap is reached.
 */
export async function ensureCodexEntryQuota(userId: string): Promise<void> {
  const limits = await getEntitlements(userId);
  if (limits.maxCodexEntries === Number.POSITIVE_INFINITY) {
    return;
  }

  const entries = await db.orm.public.CodexEntry.where((e) => e.ownerId.eq(userId))
    .where((e) => e.deletedAt.isNull())
    .all();
  if (entries.length >= limits.maxCodexEntries) {
    throw new CodexError(
      `Plan limit reached: ${limits.maxCodexEntries} codex entries. Upgrade for unlimited entries.`,
      "QUOTA_EXCEEDED",
      402,
    );
  }
}

/**
 * Resolve the effective context token budget: the caller's request capped by
 * the tier ceiling, defaulting to the tier ceiling when unset (STO-1172/1180).
 */
export function resolveContextTokenBudget(requested: number | undefined, ceiling: number): number {
  if (requested === undefined) {
    return ceiling;
  }
  return Math.min(requested, ceiling);
}
