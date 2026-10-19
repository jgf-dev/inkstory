/**
 * Subscription state sync (STO-1210): the single write path that mirrors
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

/** How long an unfinished claim blocks retries before it is considered abandoned. */
export const STRIPE_EVENT_CLAIM_TTL_MS = 5 * 60 * 1000;

/** Outcome of {@link claimStripeEvent}. */
export type StripeEventClaim =
  /** This request owns processing. */
  | "claimed"
  /** The event was already fully processed: acknowledge without re-processing. */
  | "processed"
  /** Another delivery is still processing it: answer non-2xx so Stripe retries. */
  | "in_flight";

interface ClaimPayload {
  status?: unknown;
  claimedAt?: unknown;
}

/**
 * Claims a webhook event for processing by inserting its StripeWebhookEvent
 * row first. The unique `eventId` makes the insert the idempotency gate.
 *
 * The row's `payload` tracks progress: `{ status: "processing", claimedAt }`
 * while a delivery works on it, `{ status: "processed" }` once
 * {@link markStripeEventProcessed} runs. Rows without a status (written by
 * {@link recordStripeEventProcessed}) count as processed. Only processed rows
 * are reported as duplicates; an in-flight claim stays retryable, and one
 * older than {@link STRIPE_EVENT_CLAIM_TTL_MS} is treated as abandoned (the
 * worker crashed before releasing it) and taken over.
 */
export async function claimStripeEvent(
  eventId: string,
  type: string,
  now: number = Date.now(),
): Promise<StripeEventClaim> {
  const payload = { status: "processing", claimedAt: now };
  try {
    await db.orm.public.StripeWebhookEvent.create({
      id: crypto.randomUUID(),
      eventId,
      type,
      payload,
    });
    return "claimed";
  } catch (err) {
    // Unique-key conflict on eventId: another delivery already claimed it.
    // Any other failure (no row present afterwards) is a real error.
    const existing = await db.orm.public.StripeWebhookEvent.where({ eventId }).first();
    if (!existing) {
      throw err;
    }
    const state = (existing.payload ?? {}) as ClaimPayload;
    if (state.status !== "processing") {
      return "processed";
    }
    const claimedAt = typeof state.claimedAt === "number" ? state.claimedAt : 0;
    if (now - claimedAt < STRIPE_EVENT_CLAIM_TTL_MS) {
      return "in_flight";
    }
    // Abandoned claim: drop that exact row and race for a fresh one.
    await db.orm.public.StripeWebhookEvent.where({ id: existing.id }).delete();
    try {
      await db.orm.public.StripeWebhookEvent.create({
        id: crypto.randomUUID(),
        eventId,
        type,
        payload,
      });
      return "claimed";
    } catch {
      return "in_flight";
    }
  }
}

/** Marks a claimed event as fully processed so later deliveries are duplicates. */
export async function markStripeEventProcessed(eventId: string): Promise<void> {
  await db.orm.public.StripeWebhookEvent.where({ eventId }).update({
    payload: { status: "processed" },
  });
}

/** Releases a claim after a processing failure so Stripe's retry is processed. */
export async function releaseStripeEvent(eventId: string): Promise<void> {
  await db.orm.public.StripeWebhookEvent.where({ eventId }).delete();
}
