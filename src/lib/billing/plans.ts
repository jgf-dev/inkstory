/**
 * Subscription plan definitions (STO-1180).
 *
 * Tiers per the launch plan: Free (1 book, 30 entries), Author Pro ($15/mo or
 * $144/yr), Studio ($35/mo). Limits here are the single source of truth for
 * paywall enforcement; prices are display/marketing data (in cents).
 *
 * Stripe price ids come from env so live/test price objects can be rotated
 * without code changes:
 * - `STRIPE_PRICE_PRO_MONTHLY` / `STRIPE_PRICE_PRO_ANNUAL`
 * - `STRIPE_PRICE_STUDIO_MONTHLY`
 */

export type PlanTier = "FREE" | "PRO" | "STUDIO";

export interface PlanLimits {
  /** Maximum non-deleted novels a user may own. */
  maxNovels: number;
  /** Maximum non-deleted Codex entries a user may own (all books). */
  maxCodexEntries: number;
  /** Ceiling for the assembled-context token budget (STO-1172). */
  maxContextTokens: number;
  /** Whether multi-series sharing features are unlocked. */
  seriesSharing: boolean;
}

const UNLIMITED = Number.POSITIVE_INFINITY;

export const PLANS: Record<PlanTier, PlanLimits> = {
  FREE: {
    maxNovels: 1,
    maxCodexEntries: 30,
    maxContextTokens: 4000,
    seriesSharing: false,
  },
  PRO: {
    maxNovels: UNLIMITED,
    maxCodexEntries: UNLIMITED,
    maxContextTokens: 6000,
    seriesSharing: false,
  },
  STUDIO: {
    maxNovels: UNLIMITED,
    maxCodexEntries: UNLIMITED,
    maxContextTokens: 6000,
    seriesSharing: true,
  },
};

/** Default plan for users with no subscription. */
export const DEFAULT_PLAN_TIER: PlanTier = "FREE";

/** Display pricing in cents; annual Pro is discounted ($144/yr). */
export const PLAN_PRICING: Record<
  Exclude<PlanTier, "FREE">,
  { monthly: number; annual?: number }
> = {
  PRO: { monthly: 1500, annual: 14400 },
  STUDIO: { monthly: 3500 },
};

export function isPlanTier(value: unknown): value is PlanTier {
  return value === "FREE" || value === "PRO" || value === "STUDIO";
}

/** Maps a Stripe price id to its plan tier via env-configured price ids. */
export function tierForPriceId(priceId: string | null | undefined): PlanTier | null {
  if (!priceId) {
    return null;
  }
  if (
    priceId === process.env.STRIPE_PRICE_PRO_MONTHLY ||
    priceId === process.env.STRIPE_PRICE_PRO_ANNUAL
  ) {
    return "PRO";
  }
  if (priceId === process.env.STRIPE_PRICE_STUDIO_MONTHLY) {
    return "STUDIO";
  }
  return null;
}
