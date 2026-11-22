"use client";

import { useState } from "react";
import Link from "next/link";
import { PLANS, PLAN_PRICING, type PlanTier } from "@/lib/billing/plans";

interface PricingTableProps {
  /** Logged-in users get a "Manage plan" CTA (billing portal); anonymous users go to signup. */
  isAuthenticated: boolean;
}

type TierKey = Exclude<PlanTier, "FREE"> | "FREE";

const TIERS: Array<{
  tier: TierKey;
  name: string;
  blurb: string;
  features: string[];
  highlight?: boolean;
}> = [
  {
    tier: "FREE",
    name: "Free",
    blurb: "Try InkStory with your first book.",
    features: [
      "1 novel",
      "30 codex entries",
      "4,000-token AI context",
      "Mention detection & relations",
    ],
  },
  {
    tier: "PRO",
    name: "Author Pro",
    blurb: "For writers shipping books on a deadline.",
    highlight: true,
    features: [
      "Unlimited novels & entries",
      "6,000-token AI context",
      "Full relation graph expansion",
      "Temporal progressions",
      "Priority context ranking",
    ],
  },
  {
    tier: "STUDIO",
    name: "Studio",
    blurb: "For multi-book series teams.",
    features: [
      "Everything in Author Pro",
      "Multi-series sharing",
      "Series-scoped story bible",
      "Priority support",
    ],
  },
];

/** True when the tier can be billed annually (Studio is monthly-only). */
export function supportsAnnual(tier: TierKey): boolean {
  return tier !== "FREE" && PLAN_PRICING[tier].annual !== undefined;
}

/** Monthly-equivalent price label; PLAN_PRICING amounts are in cents. */
export function priceDisplay(tier: TierKey, annual: boolean): string {
  if (tier === "FREE") {
    return "$0";
  }
  const pricing = PLAN_PRICING[tier];
  if (annual && pricing.annual) {
    return `$${Math.round(pricing.annual / 12) / 100}`;
  }
  return `$${pricing.monthly / 100}`;
}

export function periodDisplay(tier: TierKey, annual: boolean): string {
  if (tier === "FREE") {
    return "forever";
  }
  if (!supportsAnnual(tier)) {
    return annual ? "per month, monthly billing only" : "per month";
  }
  return annual ? "per month, billed annually" : "per month";
}

const BILLING_ERROR = "Could not open billing. Please try again.";

async function postJson(
  fetchImpl: typeof fetch,
  url: string,
  body?: unknown,
): Promise<{ ok: boolean; data: Record<string, unknown> | null }> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok, data };
}

/**
 * "Manage plan" handler: opens the Stripe billing portal (POST
 * /api/billing/portal). Authors without a Stripe customer yet are sent to
 * checkout for the chosen paid tier instead (Free goes to the dashboard).
 * Resolves to an error message to show, or null after navigating.
 */
export async function manageBilling(
  tier: TierKey,
  annual: boolean,
  fetchImpl: typeof fetch = fetch,
  navigate: (url: string) => void = (url) => window.location.assign(url),
): Promise<string | null> {
  try {
    const portal = await postJson(fetchImpl, "/api/billing/portal");
    if (portal.ok && typeof portal.data?.portalUrl === "string") {
      navigate(portal.data.portalUrl);
      return null;
    }
    if (portal.data?.code !== "NO_CUSTOMER") {
      return typeof portal.data?.error === "string" ? portal.data.error : BILLING_ERROR;
    }
    if (tier === "FREE") {
      navigate("/dashboard");
      return null;
    }
    const checkout = await postJson(fetchImpl, "/api/billing/checkout", {
      plan: tier,
      interval: annual && supportsAnnual(tier) ? "annual" : "monthly",
    });
    if (checkout.ok && typeof checkout.data?.checkoutUrl === "string") {
      navigate(checkout.data.checkoutUrl);
      return null;
    }
    return typeof checkout.data?.error === "string" ? checkout.data.error : BILLING_ERROR;
  } catch {
    return BILLING_ERROR;
  }
}

function ManagePlanButton({ tier, annual }: { tier: TierKey; annual: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setError(null);
          const message = await manageBilling(tier, annual);
          setError(message);
          setPending(false);
        }}
        className="block w-full rounded-md bg-ink-800 px-4 py-2 text-center text-sm font-medium text-ink-50 hover:bg-ink-900 disabled:opacity-60"
      >
        {pending ? "Opening…" : "Manage plan →"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </>
  );
}

/** Interactive pricing table with a monthly/annual billing toggle. */
export function PricingTable({ isAuthenticated }: PricingTableProps) {
  const [annual, setAnnual] = useState(false);

  return (
    <div data-testid="pricing-table">
      {/* Billing toggle */}
      <div className="mb-8 flex items-center justify-center gap-3">
        <span className={`text-sm ${annual ? "text-ink-500" : "font-semibold text-ink-900"}`}>
          Monthly
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={annual}
          aria-label="Toggle annual billing"
          onClick={() => setAnnual((v) => !v)}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            annual ? "bg-ink-800" : "bg-ink-300"
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              annual ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
        <span className={`text-sm ${annual ? "font-semibold text-ink-900" : "text-ink-500"}`}>
          Annual
        </span>
        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
          Save $36/yr on Pro
        </span>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        {TIERS.map((t) => {
          const cta = isAuthenticated ? (
            <ManagePlanButton tier={t.tier} annual={annual} />
          ) : (
            <Link
              href="/signup"
              className="block rounded-md bg-ink-800 px-4 py-2 text-center text-sm font-medium text-ink-50 hover:bg-ink-900"
            >
              Start writing
            </Link>
          );

          return (
            <div
              key={t.tier}
              className={`relative rounded-xl border p-6 text-left ${
                t.highlight
                  ? "border-ink-800 bg-card shadow-md"
                  : "border-ink-200 bg-ink-50 shadow-xs"
              }`}
            >
              {t.highlight && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-ink-800 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-50">
                  Most popular
                </span>
              )}
              <h3 className="text-lg font-semibold text-ink-900">{t.name}</h3>
              <p className="mt-1 text-xs text-ink-500">{t.blurb}</p>
              <p className="mt-4">
                <span className="text-3xl font-semibold text-ink-900">
                  {priceDisplay(t.tier, annual)}
                </span>{" "}
                <span className="text-xs text-ink-500">{periodDisplay(t.tier, annual)}</span>
              </p>
              <ul className="mt-4 space-y-2 text-sm text-ink-700">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span aria-hidden className="mt-0.5 text-emerald-600">
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
              <div className="mt-6">{cta}</div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-center text-xs text-ink-400">
        Limits shown are enforced in-app. {limitsFootnote()}
      </p>
    </div>
  );
}

function limitsFootnote(): string {
  const free = PLANS.FREE;
  return `Free includes ${free.maxNovels} novel and ${free.maxCodexEntries} codex entries.`;
}
