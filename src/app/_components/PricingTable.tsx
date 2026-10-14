"use client";

import { useState } from "react";
import Link from "next/link";
import { PLANS, PLAN_PRICING, type PlanTier } from "@/lib/billing/plans";

interface PricingTableProps {
  /** Logged-in users get a dashboard CTA; anonymous users go to signup. */
  isAuthenticated: boolean;
}

const TIERS: Array<{
  tier: Exclude<PlanTier, "FREE"> | "FREE";
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

function priceDisplay(tier: Exclude<PlanTier, "FREE"> | "FREE", annual: boolean): string {
  if (tier === "FREE") {
    return "$0";
  }
  const pricing = PLAN_PRICING[tier as Exclude<PlanTier, "FREE">];
  if (annual && pricing.annual) {
    return `$${Math.round(pricing.annual / 12)}`;
  }
  return `$${pricing.monthly / 100}`;
}

function periodDisplay(tier: Exclude<PlanTier, "FREE"> | "FREE", annual: boolean): string {
  if (tier === "FREE") {
    return "forever";
  }
  return annual ? "per month, billed annually" : "per month";
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
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
              annual ? "translate-x-5.5" : "translate-x-0.5"
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
            <Link
              href="/dashboard"
              className="block rounded-md bg-ink-800 px-4 py-2 text-center text-sm font-medium text-ink-50 hover:bg-ink-900"
            >
              Manage plan →
            </Link>
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
                  ? "border-ink-800 bg-white shadow-md"
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
