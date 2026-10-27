import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  PricingTable,
  manageBilling,
  periodDisplay,
  priceDisplay,
  supportsAnnual,
} from "../src/app/_components/PricingTable";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("PricingTable helpers", () => {
  it("shows monthly prices in dollars", () => {
    expect(priceDisplay("FREE", false)).toBe("$0");
    expect(priceDisplay("PRO", false)).toBe("$15");
    expect(priceDisplay("STUDIO", false)).toBe("$35");
  });

  it("converts annual cents to a monthly dollar equivalent", () => {
    // 14400 cents / 12 months = $12, not $1200.
    expect(priceDisplay("PRO", true)).toBe("$12");
  });

  it("keeps Studio on its monthly price when annual is toggled", () => {
    expect(supportsAnnual("STUDIO")).toBe(false);
    expect(supportsAnnual("FREE")).toBe(false);
    expect(supportsAnnual("PRO")).toBe(true);
    expect(priceDisplay("STUDIO", true)).toBe("$35");
    expect(periodDisplay("STUDIO", true)).toBe("per month, monthly billing only");
    expect(periodDisplay("STUDIO", false)).toBe("per month");
  });

  it("labels billing periods", () => {
    expect(periodDisplay("FREE", true)).toBe("forever");
    expect(periodDisplay("PRO", true)).toBe("per month, billed annually");
    expect(periodDisplay("PRO", false)).toBe("per month");
  });
});

describe("manageBilling", () => {
  it("redirects to the billing portal URL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { portalUrl: "https://billing.stripe.com/p/x" }));
    const navigate = vi.fn();
    expect(await manageBilling("PRO", false, fetchImpl, navigate)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/billing/portal",
      expect.objectContaining({ method: "POST" }),
    );
    expect(navigate).toHaveBeenCalledWith("https://billing.stripe.com/p/x");
  });

  it("starts checkout for a paid tier when there is no Stripe customer yet", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { code: "NO_CUSTOMER", error: "No billing" }))
      .mockResolvedValueOnce(jsonResponse(200, { checkoutUrl: "https://checkout.stripe.com/c" }));
    const navigate = vi.fn();
    expect(await manageBilling("PRO", true, fetchImpl, navigate)).toBeNull();
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "/api/billing/checkout",
      expect.objectContaining({ body: JSON.stringify({ plan: "PRO", interval: "annual" }) }),
    );
    expect(navigate).toHaveBeenCalledWith("https://checkout.stripe.com/c");
  });

  it("never requests annual Studio checkout", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { code: "NO_CUSTOMER" }))
      .mockResolvedValueOnce(jsonResponse(503, { code: "BILLING_NOT_CONFIGURED" }));
    const navigate = vi.fn();
    expect(await manageBilling("STUDIO", true, fetchImpl, navigate)).toMatch(/Could not open/);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "/api/billing/checkout",
      expect.objectContaining({ body: JSON.stringify({ plan: "STUDIO", interval: "monthly" }) }),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("surfaces checkout errors from the API", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { code: "NO_CUSTOMER" }))
      .mockResolvedValueOnce(jsonResponse(409, { error: "Already subscribed" }));
    expect(await manageBilling("PRO", false, fetchImpl, vi.fn())).toBe("Already subscribed");
  });

  it("sends Free authors without a customer to the dashboard", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(400, { code: "NO_CUSTOMER" }));
    const navigate = vi.fn();
    expect(await manageBilling("FREE", false, fetchImpl, navigate)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/dashboard");
  });

  it("surfaces portal errors and network failures", async () => {
    const navigate = vi.fn();
    const unauthorized = vi.fn().mockResolvedValue(jsonResponse(401, { error: "Unauthorized" }));
    expect(await manageBilling("PRO", false, unauthorized, navigate)).toBe("Unauthorized");

    const notJson = vi.fn().mockResolvedValue(new Response("oops", { status: 500 }));
    expect(await manageBilling("PRO", false, notJson, navigate)).toMatch(/Could not open/);

    const offline = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await manageBilling("PRO", false, offline, navigate)).toMatch(/Could not open/);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("PricingTable rendering", () => {
  it("renders Manage plan buttons for signed-in authors", () => {
    const html = renderToStaticMarkup(React.createElement(PricingTable, { isAuthenticated: true }));
    expect(html.match(/Manage plan/g)).toHaveLength(3);
    expect(html).not.toContain('href="/signup"');
  });

  it("renders signup links for anonymous visitors", () => {
    const html = renderToStaticMarkup(
      React.createElement(PricingTable, { isAuthenticated: false }),
    );
    expect(html).toContain('href="/signup"');
    expect(html).not.toContain("Manage plan");
  });
});
