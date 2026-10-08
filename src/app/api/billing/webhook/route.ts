import type Stripe from "stripe";
import { Temporal } from "temporal-polyfill";
import { NextRequest } from "next/server";
import { getStripe, isWebhookConfigured } from "@/lib/stripe";
import {
  applySubscriptionToUser,
  downgradeToFree,
  isStripeEventProcessed,
  recordStripeEventProcessed,
  type SubscriptionSnapshot,
} from "@/lib/billing/subscription-sync";
import { tierForPriceId } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

/** Extracts the customer id from a Stripe object's `customer` field. */
function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined,
): string | null {
  if (!customer) {
    return null;
  }
  return typeof customer === "string" ? customer : customer.id;
}

/** Maps epoch seconds to the ORM's Temporal plain-datetime (UTC). */
function epochSecondsToDateTime(seconds: number): Temporal.PlainDateTime {
  return Temporal.Instant.fromEpochMilliseconds(seconds * 1000)
    .toZonedDateTimeISO("UTC")
    .toPlainDateTime();
}

/** Maps a Stripe Subscription object onto our subscription snapshot. */
function subscriptionToSnapshot(sub: Stripe.Subscription): SubscriptionSnapshot {
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const periodEnd = (sub as unknown as { current_period_end?: number | null }).current_period_end;
  return {
    stripeCustomerId: customerIdOf(sub.customer) ?? "",
    stripeSubscriptionId: sub.id,
    tier: tierForPriceId(priceId),
    status: sub.status ?? null,
    currentPeriodEnd: periodEnd ? epochSecondsToDateTime(periodEnd) : null,
  };
}

/**
 * POST /api/billing/webhook
 *
 * Stripe webhook receiver (STO-1180). Verifies signatures against
 * `STRIPE_WEBHOOK_SECRET`, deduplicates by event id (processed events are
 * logged in `stripe_webhook_events`), and syncs subscription state:
 *
 * - `checkout.session.completed` — resolves the subscription and applies it.
 * - `customer.subscription.updated` — applies tier/status/period end.
 * - `customer.subscription.deleted` (or `canceled` status) — downgrades to Free.
 *
 * Always answers 200 for verified events (except signature failures: 400) so
 * Stripe does not retry healthy deliveries.
 */
export async function POST(request: NextRequest) {
  if (!isWebhookConfigured()) {
    return Response.json(
      { error: "Billing is not configured", code: "BILLING_NOT_CONFIGURED" },
      { status: 503 },
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return Response.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET as string,
    );
  } catch {
    return Response.json({ error: "Invalid webhook signature" }, { status: 400 });
  }

  if (await isStripeEventProcessed(event.id)) {
    return Response.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "subscription") {
          const customerId = customerIdOf(session.customer);
          let subscription: Stripe.Subscription | null = null;
          if (typeof session.subscription === "string") {
            subscription = await getStripe().subscriptions.retrieve(session.subscription);
          } else if (session.subscription) {
            subscription = session.subscription as Stripe.Subscription;
          }
          if (customerId && subscription) {
            const userIdHint =
              typeof session.client_reference_id === "string"
                ? session.client_reference_id
                : ((session.metadata?.userId as string | undefined) ?? null);
            await applySubscriptionToUser(
              customerId,
              subscriptionToSnapshot(subscription),
              userIdHint,
            );
          }
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = customerIdOf(subscription.customer);
        if (customerId) {
          const canceled =
            event.type === "customer.subscription.deleted" || subscription.status === "canceled";
          const userIdHint = (subscription.metadata?.userId as string | undefined) ?? null;
          if (canceled) {
            await downgradeToFree(customerId);
          } else {
            await applySubscriptionToUser(
              customerId,
              subscriptionToSnapshot(subscription),
              userIdHint,
            );
          }
        }
        break;
      }

      default:
        // Unhandled event types are recorded and acked.
        break;
    }

    await recordStripeEventProcessed(event.id, event.type);
    return Response.json({ received: true });
  } catch {
    // Processing failed: do NOT record the event so Stripe's retry can replay it.
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
