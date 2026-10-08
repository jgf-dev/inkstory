import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { db } from "@/lib/prisma";
import { appBaseUrl, getStripe, isStripeConfigured } from "@/lib/stripe";
import { isPlanTier } from "@/lib/billing/plans";

export const dynamic = "force-dynamic";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

/** Env key for a plan/interval combination's Stripe price id. */
function priceIdFor(plan: "PRO" | "STUDIO", interval: "monthly" | "annual"): string | undefined {
  if (plan === "PRO") {
    return interval === "annual"
      ? process.env.STRIPE_PRICE_PRO_ANNUAL
      : process.env.STRIPE_PRICE_PRO_MONTHLY;
  }
  return process.env.STRIPE_PRICE_STUDIO_MONTHLY;
}

/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout session (test mode until live keys rotate) for
 * the requested plan and returns `{ checkoutUrl }`.
 *
 * Returns 503 `BILLING_NOT_CONFIGURED` when Stripe keys/price ids are absent,
 * and 409 `ALREADY_SUBSCRIBED` for users with an active subscription (they
 * should change plans via the billing portal instead).
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      plan?: unknown;
      interval?: unknown;
    } | null;

    if (!body || !isPlanTier(body.plan) || body.plan === "FREE") {
      return Response.json(
        { error: "Field 'plan' must be 'PRO' or 'STUDIO'", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }
    const interval = body.interval === "annual" ? "annual" : "monthly";

    if (!isStripeConfigured()) {
      return Response.json(
        { error: "Billing is not configured", code: "BILLING_NOT_CONFIGURED" },
        { status: 503 },
      );
    }

    const priceId = priceIdFor(body.plan, interval);
    if (!priceId) {
      return Response.json(
        {
          error: `No Stripe price configured for ${body.plan} (${interval})`,
          code: "BILLING_NOT_CONFIGURED",
        },
        { status: 503 },
      );
    }

    const user = await db.orm.public.User.where({ id: authUser.id }).first();
    if (!user || user.deletedAt !== null) {
      return Response.json({ error: "User not found", code: "NOT_FOUND" }, { status: 404 });
    }

    if (
      user.subscriptionStatus !== null &&
      ACTIVE_SUBSCRIPTION_STATUSES.has(user.subscriptionStatus)
    ) {
      return Response.json(
        {
          error: "You already have an active subscription; use the billing portal to change plans",
          code: "ALREADY_SUBSCRIBED",
        },
        { status: 409 },
      );
    }

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      ...(user.stripeCustomerId
        ? { customer: user.stripeCustomerId }
        : { customer_email: user.email }),
      client_reference_id: user.id,
      metadata: { userId: user.id, plan: body.plan, interval },
      // Copied onto the subscription so webhook events can resolve the user
      // even for first-time customers.
      subscription_data: { metadata: { userId: user.id } },
      success_url: `${appBaseUrl()}/dashboard/billing?status=success`,
      cancel_url: `${appBaseUrl()}/dashboard/billing?status=cancelled`,
    });

    return Response.json({ checkoutUrl: session.url });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
