import { NextRequest } from "next/server";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { POST as checkout } from "../src/app/api/billing/checkout/route";
import { POST as portal } from "../src/app/api/billing/portal/route";
import { POST as webhook } from "../src/app/api/billing/webhook/route";
import * as subscriptionSync from "../src/lib/billing/subscription-sync";
import {
  STRIPE_EVENT_CLAIM_TTL_MS,
  claimStripeEvent,
  recordStripeEventProcessed,
} from "../src/lib/billing/subscription-sync";
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

    it("returns 400 when Studio is requested with annual billing", async () => {
      const res = await checkout(
        new NextRequest("http://localhost:3000/api/billing/checkout", {
          method: "POST",
          body: JSON.stringify({ plan: "STUDIO", interval: "annual" }),
        }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("VALIDATION_FAILED");
      expect(body.error).toMatch(/monthly/i);
      expect(createCheckoutSession).not.toHaveBeenCalled();
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
          success_url: "http://localhost:3000/dashboard?billing=success",
          cancel_url: "http://localhost:3000/dashboard?billing=cancelled",
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
          return_url: "http://localhost:3000/dashboard",
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

    function stubEventLog() {
      return [
        vi.spyOn(subscriptionSync, "claimStripeEvent").mockResolvedValue("claimed"),
        vi.spyOn(subscriptionSync, "markStripeEventProcessed").mockResolvedValue(undefined),
      ];
    }

    it("reads current_period_end from the subscription item (stripe v23)", async () => {
      const stubs = stubEventLog();
      const syncSpy = vi
        .spyOn(subscriptionSync, "applySubscriptionToUser")
        .mockResolvedValue(undefined as never);
      constructEventAsync.mockResolvedValueOnce({
        id: `evt_item_period_${runId}`,
        type: "customer.subscription.updated",
        data: {
          object: subscriptionFixture({
            current_period_end: undefined,
            items: {
              data: [{ price: { id: "price_pro_monthly" }, current_period_end: 1_900_000_000 }],
            },
            metadata: { userId },
          }),
        },
      });

      expect((await webhookRequest({})).status).toBe(200);
      const snapshot = syncSpy.mock.calls[0]?.[1];
      expect(snapshot?.currentPeriodEnd?.toString()).toBe(
        Temporal.Instant.fromEpochMilliseconds(1_900_000_000_000)
          .toZonedDateTimeISO("UTC")
          .toPlainDateTime()
          .toString(),
      );
      syncSpy.mockRestore();
      for (const stub of stubs) stub.mockRestore();
    });

    for (const status of ["unpaid", "incomplete_expired", "canceled"]) {
      it(`downgrades to Free on customer.subscription.updated with status ${status}`, async () => {
        const stubs = stubEventLog();
        const downgradeSpy = vi
          .spyOn(subscriptionSync, "downgradeToFree")
          .mockResolvedValue(undefined as never);
        const syncSpy = vi.spyOn(subscriptionSync, "applySubscriptionToUser");
        constructEventAsync.mockResolvedValueOnce({
          id: `evt_lapsed_${status}_${runId}`,
          type: "customer.subscription.updated",
          data: { object: subscriptionFixture({ status, metadata: { userId } }) },
        });

        expect((await webhookRequest({})).status).toBe(200);
        expect(downgradeSpy).toHaveBeenCalledWith("cus_123");
        expect(syncSpy).not.toHaveBeenCalled();
        downgradeSpy.mockRestore();
        syncSpy.mockRestore();
        for (const stub of stubs) stub.mockRestore();
      });
    }

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

    it("acks a duplicate delivery of the same event with 200 without re-processing", async () => {
      const event = {
        id: `evt_double_${runId}`,
        type: "customer.subscription.updated",
        data: {
          object: subscriptionFixture({
            items: { data: [{ price: { id: "price_pro_monthly" } }] },
            metadata: { userId },
          }),
        },
      };
      constructEventAsync.mockResolvedValueOnce(event).mockResolvedValueOnce(event);
      const syncSpy = vi.spyOn(subscriptionSync, "applySubscriptionToUser");

      const first = await webhookRequest({});
      expect(first.status).toBe(200);
      expect((await first.json()).duplicate).toBeUndefined();
      expect(syncSpy).toHaveBeenCalledTimes(1);

      const second = await webhookRequest({});
      expect(second.status).toBe(200);
      expect((await second.json()).duplicate).toBe(true);
      expect(syncSpy).toHaveBeenCalledTimes(1);

      const rows = await db.orm.public.StripeWebhookEvent.where({ eventId: event.id }).all();
      expect(rows).toHaveLength(1);
      syncSpy.mockRestore();
    });

    it("answers 409 (retryable) while another delivery's claim is still in flight", async () => {
      const eventId = `evt_inflight_${runId}`;
      expect(await claimStripeEvent(eventId, "customer.subscription.updated")).toBe("claimed");

      const event = {
        id: eventId,
        type: "customer.subscription.updated",
        data: { object: subscriptionFixture({ metadata: { userId } }) },
      };
      constructEventAsync.mockResolvedValueOnce(event);
      const syncSpy = vi.spyOn(subscriptionSync, "applySubscriptionToUser");
      const res = await webhookRequest({});
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("EVENT_IN_FLIGHT");
      expect(syncSpy).not.toHaveBeenCalled();

      // The first delivery fails and releases its claim: Stripe's retry is processed.
      await subscriptionSync.releaseStripeEvent(eventId);
      constructEventAsync.mockResolvedValueOnce(event);
      const retry = await webhookRequest({});
      expect(retry.status).toBe(200);
      expect((await retry.json()).duplicate).toBeUndefined();
      expect(syncSpy).toHaveBeenCalledTimes(1);
      syncSpy.mockRestore();

      const [row] = await db.orm.public.StripeWebhookEvent.where({ eventId }).all();
      expect((row?.payload as { status?: string } | null)?.status).toBe("processed");
    });

    it("takes over an abandoned in-flight claim after the TTL", async () => {
      const eventId = `evt_stale_${runId}`;
      const longAgo = Date.now() - STRIPE_EVENT_CLAIM_TTL_MS - 1_000;
      expect(await claimStripeEvent(eventId, "invoice.paid", longAgo)).toBe("claimed");
      // A fresh claim inside the TTL is still in flight.
      expect(await claimStripeEvent(eventId, "invoice.paid", longAgo + 1_000)).toBe("in_flight");

      constructEventAsync.mockResolvedValueOnce({
        id: eventId,
        type: "invoice.paid",
        data: { object: {} },
      });
      const res = await webhookRequest({});
      expect(res.status).toBe(200);
      expect((await res.json()).duplicate).toBeUndefined();

      const rows = await db.orm.public.StripeWebhookEvent.where({ eventId }).all();
      expect(rows).toHaveLength(1);
      expect(await claimStripeEvent(eventId, "invoice.paid")).toBe("processed");
    });

    it("rethrows claim errors that are not unique conflicts", async () => {
      const createSpy = vi
        .spyOn(db.orm.public.StripeWebhookEvent, "create")
        .mockRejectedValueOnce(new Error("db down"));
      await expect(claimStripeEvent(`evt_db_down_${runId}`, "invoice.paid")).rejects.toThrow(
        "db down",
      );
      createSpy.mockRestore();
    });

    it("returns 500 when the event cannot be claimed", async () => {
      constructEventAsync.mockResolvedValueOnce({
        id: `evt_claim_fail_${runId}`,
        type: "invoice.paid",
        data: { object: {} },
      });
      const claimSpy = vi
        .spyOn(subscriptionSync, "claimStripeEvent")
        .mockRejectedValueOnce(new Error("db down"));
      expect((await webhookRequest({})).status).toBe(500);
      claimSpy.mockRestore();
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
