import { createSupabaseServerClient } from "@/lib/supabase/server";
import { db } from "@/lib/prisma";
import { appBaseUrl, getStripe, isStripeConfigured } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * POST /api/billing/portal
 *
 * Creates a Stripe Billing Portal session for the signed-in author and
 * returns `{ portalUrl }`. Authors manage payment methods, invoices, plan
 * changes, and cancellations there (self-serve; no manual ops).
 *
 * Returns 400 `NO_CUSTOMER` for Free authors who have never subscribed
 * (there is no portal customer yet) and 503 `BILLING_NOT_CONFIGURED` when
 * Stripe keys are absent.
 */
export async function POST() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();

    if (!authUser) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isStripeConfigured()) {
      return Response.json(
        { error: "Billing is not configured", code: "BILLING_NOT_CONFIGURED" },
        { status: 503 },
      );
    }

    const user = await db.orm.public.User.where({ id: authUser.id }).first();
    if (!user || user.deletedAt !== null) {
      return Response.json({ error: "User not found", code: "NOT_FOUND" }, { status: 404 });
    }

    if (!user.stripeCustomerId) {
      return Response.json(
        {
          error: "No billing profile yet — subscribe to a plan first",
          code: "NO_CUSTOMER",
        },
        { status: 400 },
      );
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${appBaseUrl()}/dashboard/billing`,
    });

    return Response.json({ portalUrl: session.url });
  } catch {
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}
