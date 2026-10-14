import { NextRequest } from "next/server";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { POST as checkout } from "../src/app/api/billing/checkout/route";
import { POST as portal } from "../src/app/api/billing/portal/route";
import { POST as webhook } from "../src/app/api/billing/webhook/route";
import { recordStripeEventProcessed } from "../src/lib/billing/subscription-sync";
import { db } from "../src/lib/prisma";

const mockGetUser = vi.fn();
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: () => mockGetUser(),
    },
  }),
}));

const mockStripeConfigured = vi.fn();
const mockWebhookConfigured = vi.fn();
const constructEventAsync = vi.fn();
const createCheckoutSession = vi.fn();
const createPortalSession = vi.fn();
const retrieveSubscription = vi.fn();

vi.mock("../src/lib/stripe", () => ({
  isStripeConfigured: () => mockStripeConfigured(),
  isWebhookConfigured: () => mockWebhookConfigured(),
  getStripe: () => ({
    checkout: { sessions: { create: createCheckoutSession } },
    billingPortal: { sessions: { create: createPortalSession } },
    subscriptions: { retrieve: retrieveSubscription },
    webhooks: { constructEventAsync },
  }),
  appBaseUrl: () => "http://localhost:3000",
}));

function subscriptionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_123",
    customer: "cus_123",
    status: "active",
    current_period_end: 1_800_000_000,
    items: { data: [{ price: { id: "price_pro_monthly" } }] },
    ...overrides,
  };
}

function webhookRequest(event: unknown, signature = "sig_valid"): Promise<Response> {
  return webhook(
    new NextRequest("http://localhost:3000/api/billing/webhook", {
      method: "POST",
      body: JSON.stringify(event),
      headers: { "stripe-signature": signature },
    }),
  );
}

describe("billing routes", { timeout: 20_000 }, () => {
  const runId = crypto.randomUUID();
  const userId = `test-billing-user-${runId}`;
  const novellessUserId = `test-billing-nocust-${runId}`;

  beforeAll(async () => {
    const now = Temporal.Now.plainDateTimeISO();
    await db.orm.public.User.upsert({
      create: { id: userId, email: `billing-${runId}@inkstory.local`, updatedAt: now },
      update: { updatedAt: now },
    });
    await db.orm.public.User.upsert({
      create: {
        id: novellessUserId,
        email: `billing-nocust-${runId}@inkstory.local`,
        updatedAt: now,
      },
      update: { updatedAt: now },
    });
  });

  afterAll(async () => {
    for (const id of [userId, novellessUserId]) {
      try {
        await db.orm.public.User.where({ id }).delete();
      } catch {
        // ignore
      }
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: userId, email: "billing@inkstory.local" } },
    });
    mockStripeConfigured.mockReturnValue(true);
    mockWebhookConfigured.mockReturnValue(true);
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_monthly";
    process.env.STRIPE_PRICE_PRO_ANNUAL = "price_pro_annual";
    process.env.STRIPE_PRICE_STUDIO_MONTHLY = "price_studio_monthly";
  });

  describe("POST /api/billing/checkout", () => {
    it("returns 401 when unauthenticated", async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });
      const res = await checkout(
        new NextRequest("http://localhost:3000/api/billing/checkout", {
          method: "POST",
          body: JSON.stringify({ plan: "PRO" }),
        }),
      );
      expect(res.status).toBe(401);
    });

    it("returns 400 for an invalid plan", async () => {
      const res = await checkout(
        new NextRequest("http://localhost:3000/api/billing/checkout", {
          method: "POST",
          body: JSON.stringify({ plan: "FREE" }),
        }),
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("VALIDATION_FAILED");
    });

    it("returns 503 when Stripe is not configured", async () => {
      mockStripeConfigured.mockReturnValueOnce(false);
      const res = await checkout(
        new NextRequest("http://localhost:3000/api/billing/checkout", {
          method: "POST",
          body: JSON.stringify({ plan: "PRO" }),
        }),
      );
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe("BILLING_NOT_CONFIGURED");
    });

    it("returns 503 when the plan has no configured price", async () => {
      delete process.env.STRIPE_PRICE_PRO_MONTHLY;
      const res = await checkout(
        new NextRequest("http://localhost:3000/api/billing/checkout", {
          method: "POST",
          body: JSON.stringify({ plan: "PRO" }),
        }),
      );
      expect(res.status).toBe(503);
    });

    it("creates a checkout session with the env price and user metadata", async () => {
      createCheckoutSession.mockResolvedValueOnce({ url: "https://stripe.test/checkout" });

      const res = await checkout(
        new NextRequest("http://localhost:3000/api/billing/checkout", {
          method: "POST",
          body: JSON.stringify({ plan: "PRO", interval: "annual" }),
        }),
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ checkoutUrl: "https://stripe.test/checkout" });
      expect(createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "subscription",
          line_items: [{ price: "price_pro_annual", quantity: 1 }],
          customer_email: `billing-${runId}@inkstory.local`,
          client_reference_id: userId,
          success_url: "http://localhost:3000/dashboard/billing?status=success",
          cancel_url: "http://localhost:3000/dashboard/billing?status=cancelled",
        }),
      );
    });

    it("reuses the existing Stripe customer when present", async () => {
      await db.orm.public.User.where({ id: userId }).update({
        stripeCustomerId: "cus_existing",
        updatedAt: Temporal.Now.plainDateTimeISO(),
      });
      createCheckoutSession.mockResolvedValueOnce({ url: "https://stripe.test/checkout" });

      await checkout(
        new NextRequest("http://localhost:3000/api/billing/checkout", {
          method: "POST",
          body: JSON.stringify({ plan: "PRO" }),
        }),
      );
      expect(createCheckoutSession).toHaveBeenCalledWith(
        expect.objectContaining({ customer: "cus_existing" }),
      );

      // Reset the fixture user for other tests.
      await db.orm.public.User.where({ id: userId }).update({
        stripeCustomerId: null,
        updatedAt: Temporal.Now.plainDateTimeISO(),
      });
    });
  });

  describe("POST /api/billing/portal", () => {
    it("returns 401 when unauthenticated", async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });
      const res = await portal();
      expect(res.status).toBe(401);
    });

    it("returns 503 when Stripe is not configured", async () => {
      mockStripeConfigured.mockReturnValueOnce(false);
      expect((await portal()).status).toBe(503);
    });

    it("returns 400 for authors without a Stripe customer", async () => {
      const res = await portal();
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("NO_CUSTOMER");
    });

    it("returns a portal URL for customers", async () => {
      await db.orm.public.User.where({ id: novellessUserId }).update({
        stripeCustomerId: "cus_portal",
        updatedAt: Temporal.Now.plainDateTimeISO(),
      });
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: novellessUserId, email: "nocust@inkstory.local" } },
      });
      createPortalSession.mockResolvedValueOnce({ url: "https://stripe.test/portal" });

      const res = await portal();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ portalUrl: "https://stripe.test/portal" });
      expect(createPortalSession).toHaveBeenCalledWith(
        expect.objectContaining({
          customer: "cus_portal",
          return_url: "http://localhost:3000/dashboard/billing",
        }),
      );
    });
  });

  describe("POST /api/billing/webhook", () => {
    it("returns 503 when webhooks are not configured", async () => {
      mockWebhookConfigured.mockReturnValueOnce(false);
      expect((await webhookRequest({})).status).toBe(503);
    });

    it("returns 400 when the signature header is missing", async () => {
      const res = await webhook(
        new NextRequest("http://localhost:3000/api/billing/webhook", {
          method: "POST",
          body: "{}",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid signatures", async () => {
      constructEventAsync.mockRejectedValueOnce(new Error("bad signature"));
      expect((await webhookRequest({ id: "evt_x" }, "sig_bad")).status).toBe(400);
    });

    it("syncs subscription state on checkout.session.completed", async () => {
      constructEventAsync.mockResolvedValueOnce({
        id: `evt_checkout_${runId}`,
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "subscription",
            customer: "cus_123",
            subscription: "sub_123",
            client_reference_id: userId,
            metadata: { userId, plan: "PRO", interval: "monthly" },
          },
        },
      });
      retrieveSubscription.mockResolvedValueOnce(subscriptionFixture());

      const res = await webhookRequest({});
      expect(res.status).toBe(200);

      const user = await db.orm.public.User.where({ id: userId }).first();
      expect(user?.stripeCustomerId).toBe("cus_123");
      expect(user?.stripeSubscriptionId).toBe("sub_123");
      expect(user?.planTier).toBe("PRO");
      expect(user?.subscriptionStatus).toBe("active");
      expect(user?.currentPeriodEnd).not.toBeNull();

      // Idempotent replay of the same event id is a no-op.
      constructEventAsync.mockResolvedValueOnce({
        id: `evt_checkout_${runId}`,
        type: "checkout.session.completed",
        data: { object: {} },
      });
      const replay = await webhookRequest({});
      expect((await replay.json()).duplicate).toBe(true);
    });

    it("applies tier changes on customer.subscription.updated", async () => {
      constructEventAsync.mockResolvedValueOnce({
        id: `evt_updated_${runId}`,
        type: "customer.subscription.updated",
        data: {
          object: subscriptionFixture({
            items: { data: [{ price: { id: "price_studio_monthly" } }] },
            metadata: { userId },
          }),
        },
      });

      await webhookRequest({});

      const user = await db.orm.public.User.where({ id: userId }).first();
      expect(user?.planTier).toBe("STUDIO");
    });

    it("downgrades to Free on customer.subscription.deleted", async () => {
      constructEventAsync.mockResolvedValueOnce({
        id: `evt_deleted_${runId}`,
        type: "customer.subscription.deleted",
        data: { object: subscriptionFixture({ status: "canceled" }) },
      });

      const res = await webhookRequest({});

      expect(res.status).toBe(200);
      const user = await db.orm.public.User.where({ id: userId }).first();
      expect(user?.planTier).toBe("FREE");
      expect(user?.stripeSubscriptionId).toBeNull();
      expect(user?.subscriptionStatus).toBeNull();
    });

    it("acks verified unhandled event types", async () => {
      constructEventAsync.mockResolvedValueOnce({
        id: `evt_other_${runId}`,
        type: "invoice.paid",
        data: { object: {} },
      });
      const res = await webhookRequest({});
      expect(res.status).toBe(200);
      expect((await res.json()).received).toBe(true);
    });

    it("returns 500 and does not record the event when processing fails", async () => {
      const failingEventId = `evt_failing_${runId}`;
      constructEventAsync.mockResolvedValueOnce({
        id: failingEventId,
        type: "checkout.session.completed",
        data: {
          object: { mode: "subscription", customer: "cus_123", subscription: "sub_retrieve_fails" },
        },
      });
      retrieveSubscription.mockRejectedValueOnce(new Error("stripe down"));

      expect((await webhookRequest({})).status).toBe(500);

      // Event was NOT recorded, so a retry would be processed.
      constructEventAsync.mockResolvedValueOnce({
        id: failingEventId,
        type: "checkout.session.completed",
        data: { object: {} },
      });
      retrieveSubscription.mockResolvedValueOnce(subscriptionFixture());
      const retry = await webhookRequest({});
      expect((await retry.json()).duplicate).toBeUndefined();
    });

    it("records processed events for idempotency", async () => {
      await recordStripeEventProcessed(`evt_manual_${runId}`, "invoice.paid");
      constructEventAsync.mockResolvedValueOnce({
        id: `evt_manual_${runId}`,
        type: "invoice.paid",
        data: { object: {} },
      });
      const res = await webhookRequest({});
      expect((await res.json()).duplicate).toBe(true);
    });
  });
});
