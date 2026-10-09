/**
 * Subscription state sync (STO-1180): the single write path that mirrors
 * Stripe subscription state onto User rows, plus webhook event-id logging for
 * idempotent processing.
 *
 * Webhook receivers and checkout flows both call {@link applySubscriptionToUser}
 * so the User row is the one source of truth for entitlements.
 */

import { Temporal } from "temporal-polyfill";
import { db } from "@/lib/prisma";
import type { PlanTier } from "./plans";

/** A resolved subscription state ready to write onto a user. */
export interface SubscriptionSnapshot {
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  tier: PlanTier | null;
  /** Stripe subscription status string (active, trialing, past_due, ...). */
  status: string | null;
  /** Period end as a plain datetime, or null when Stripe does not report one. */
  currentPeriodEnd: Temporal.PlainDateTime | null;
}

/**
 * Applies a subscription snapshot to the user behind `stripeCustomerId`,
 * returning the updated row (or null when no user matches).
 *
 * `userIdHint` links first-time customers: at checkout completion the Stripe
 * customer is brand new and not yet stored on any user, so the checkout
 * session's `client_reference_id` (or metadata) supplies the user id.
 *
 * Tier changes only apply when the snapshot carries a known tier; unknown
 * price ids leave the current tier untouched (belt-and-braces against price
 * rotation).
 */
export async function applySubscriptionToUser(
  stripeCustomerId: string,
  snapshot: SubscriptionSnapshot,
  userIdHint?: string | null,
) {
  let user = await db.orm.public.User.where({ stripeCustomerId }).first();
  if (!user && userIdHint) {
    user = await db.orm.public.User.where({ id: userIdHint }).first();
  }
  if (!user) {
    return null;
  }

  const updated = await db.orm.public.User.where({ id: user.id }).update({
    stripeCustomerId: snapshot.stripeCustomerId,
    stripeSubscriptionId: snapshot.stripeSubscriptionId,
    ...(snapshot.tier ? { planTier: snapshot.tier } : {}),
    subscriptionStatus: snapshot.status,
    currentPeriodEnd: snapshot.currentPeriodEnd,
    updatedAt: Temporal.Now.plainDateTimeISO(),
  });
  return updated;
}

/** Downgrades the user behind a Stripe customer to Free and clears mirror fields. */
export async function downgradeToFree(stripeCustomerId: string) {
  const user = await db.orm.public.User.where({ stripeCustomerId }).first();
  if (!user) {
    return null;
  }

  return db.orm.public.User.where({ id: user.id }).update({
    planTier: "FREE",
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    currentPeriodEnd: null,
    updatedAt: Temporal.Now.plainDateTimeISO(),
  });
}

/** True when a webhook event id has already been processed (idempotency). */
export async function isStripeEventProcessed(eventId: string): Promise<boolean> {
  // `.first()` resolves to null (not undefined) when there is no row.
  const existing = await db.orm.public.StripeWebhookEvent.where({ eventId }).first();
  return existing !== null && existing !== undefined;
}

/** Records a webhook event id as processed (upsert keeps retries idempotent). */
export async function recordStripeEventProcessed(eventId: string, type: string): Promise<void> {
  await db.orm.public.StripeWebhookEvent.upsert({
    create: { id: crypto.randomUUID(), eventId, type },
    update: {},
  });
}
