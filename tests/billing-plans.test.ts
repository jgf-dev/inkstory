import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_PLAN_TIER,
  PLANS,
  PLAN_PRICING,
  isPlanTier,
  tierForPriceId,
} from "../src/lib/billing/plans";

describe("billing plans", () => {
  afterEach(() => {
    delete process.env.STRIPE_PRICE_PRO_MONTHLY;
    delete process.env.STRIPE_PRICE_PRO_ANNUAL;
    delete process.env.STRIPE_PRICE_STUDIO_MONTHLY;
  });

  it("encodes the launch tier limits", () => {
    expect(PLANS.FREE).toEqual({
      maxNovels: 1,
      maxCodexEntries: 30,
      maxContextTokens: 4000,
      seriesSharing: false,
    });
    expect(PLANS.PRO.maxNovels).toBe(Number.POSITIVE_INFINITY);
    expect(PLANS.PRO.maxCodexEntries).toBe(Number.POSITIVE_INFINITY);
    expect(PLANS.PRO.maxContextTokens).toBe(6000);
    expect(PLANS.STUDIO.seriesSharing).toBe(true);
    expect(DEFAULT_PLAN_TIER).toBe("FREE");
  });

  it("prices Author Pro at $15/mo or $144/yr and Studio at $35/mo", () => {
    expect(PLAN_PRICING.PRO).toEqual({ monthly: 1500, annual: 14400 });
    expect(PLAN_PRICING.STUDIO).toEqual({ monthly: 3500 });
  });

  it("validates plan tiers", () => {
    expect(isPlanTier("PRO")).toBe(true);
    expect(isPlanTier("enterprise")).toBe(false);
    expect(isPlanTier(null)).toBe(false);
  });

  it("maps configured Stripe price ids to tiers", () => {
    process.env.STRIPE_PRICE_PRO_MONTHLY = "price_pro_monthly";
    process.env.STRIPE_PRICE_PRO_ANNUAL = "price_pro_annual";
    process.env.STRIPE_PRICE_STUDIO_MONTHLY = "price_studio_monthly";

    expect(tierForPriceId("price_pro_monthly")).toBe("PRO");
    expect(tierForPriceId("price_pro_annual")).toBe("PRO");
    expect(tierForPriceId("price_studio_monthly")).toBe("STUDIO");
    expect(tierForPriceId("price_unknown")).toBeNull();
    expect(tierForPriceId(null)).toBeNull();
  });
});
