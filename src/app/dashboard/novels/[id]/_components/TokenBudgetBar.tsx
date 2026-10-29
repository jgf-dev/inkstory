"use client";

import { useState } from "react";
import {
  BUDGET_SEGMENT_LABELS,
  computeTokenBudgetBar,
  formatBudgetSummary,
  type BudgetSegmentId,
  type BudgetSegmentInput,
} from "@/lib/codex/budget-segments";
import { DEFAULT_MAX_TOKENS } from "@/lib/codex/token-budgeter";

/** Per-entity breakdown row shown in a segment's hover/focus card. */
export interface BudgetBreakdownItem {
  label: string;
  tokens: number;
}

export interface TokenBudgetBarProps {
  segments: readonly BudgetSegmentInput[];
  /** Active LLM context limit; defaults to 4,000. */
  maxTokens?: number;
  /** Per-segment entity breakdowns for the hover/focus cards. */
  breakdown?: Partial<Record<BudgetSegmentId, BudgetBreakdownItem[]>>;
  loading?: boolean;
  error?: string | null;
}

const SEGMENT_BAR_CLASSES: Record<BudgetSegmentId, string> = {
  seed: "bg-budget-seed",
  mentions: "bg-budget-mentions",
  relations: "bg-budget-relations",
  progressions: "bg-budget-progressions",
};

const SEGMENT_ORDER: BudgetSegmentId[] = ["seed", "mentions", "relations", "progressions"];

/**
 * Interactive Visual Context Budget Bar (JGF-128, design rev 4 §1.1 item 4):
 * persistent stacked bar of token allocation against the active LLM context
 * limit. Hovering/focusing a segment shows an exact breakdown card; the
 * over-budget state caps the bar at 100% and paints the overflow share in
 * destructive red with a label.
 */
export function TokenBudgetBar({
  segments,
  maxTokens = DEFAULT_MAX_TOKENS,
  breakdown,
  loading = false,
  error = null,
}: Readonly<TokenBudgetBarProps>) {
  const [openSegment, setOpenSegment] = useState<BudgetSegmentId | null>(null);

  const model = computeTokenBudgetBar(segments, maxTokens);
  const byId = new Map(model.segments.map((s) => [s.id, s]));

  if (loading) {
    return (
      <div data-testid="token-budget-bar" aria-busy="true" className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Context budget</p>
        <div className="h-3 w-full motion-safe:animate-pulse rounded-full bg-elevated" />
        <p className="text-[11px] text-muted">Estimating tokens…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="token-budget-bar" className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Context budget</p>
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700"
        >
          {error}
        </p>
      </div>
    );
  }

  return (
    <div data-testid="token-budget-bar" className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Context budget</p>
        <p className="text-[11px] tabular-nums text-muted" data-testid="token-budget-summary">
          {formatBudgetSummary(model)}
        </p>
      </div>

      <div
        role="group"
        aria-label={`Token budget: ${formatBudgetSummary(model)}`}
        className="flex h-3 w-full overflow-visible rounded-full bg-budget-buffer ring-1 ring-strong"
      >
        {SEGMENT_ORDER.map((id) => {
          const segment = byId.get(id);
          if (!segment || segment.pct <= 0) return null;
          return (
            <div key={id} className="relative h-full" style={{ width: `${segment.pct}%` }}>
              <button
                type="button"
                aria-label={`${BUDGET_SEGMENT_LABELS[id]}: ${segment.tokens.toLocaleString("en-US")} tokens`}
                aria-expanded={openSegment === id}
                onFocus={() => setOpenSegment(id)}
                onBlur={() => setOpenSegment(null)}
                onMouseEnter={() => setOpenSegment(id)}
                onMouseLeave={() => setOpenSegment(null)}
                data-testid={`budget-segment-${id}`}
                className={`block h-full min-h-3 w-full ${SEGMENT_BAR_CLASSES[id]} ${
                  id === "seed" ? "rounded-l-full" : ""
                } ${!model.overBudget && id === lastVisibleSegment(model.segments) ? "rounded-r-full" : ""}`}
              />
              {openSegment === id && (
                <div
                  role="tooltip"
                  data-testid={`budget-breakdown-${id}`}
                  className="absolute left-1/2 top-full z-50 mt-2 w-52 -translate-x-1/2 rounded-lg border border-subtle bg-card p-3 shadow-lg"
                >
                  <p className="text-xs font-semibold text-primary">
                    {BUDGET_SEGMENT_LABELS[id]}
                    <span className="ml-1 font-normal tabular-nums text-muted">
                      {segment.tokens.toLocaleString("en-US")} tokens
                    </span>
                  </p>
                  <ul className="mt-1.5 space-y-0.5">
                    {(breakdown?.[id] ?? []).map((item) => (
                      <li
                        key={item.label}
                        className="flex items-baseline justify-between gap-2 text-[11px] text-secondary"
                      >
                        <span className="truncate">{item.label}</span>
                        <span className="shrink-0 tabular-nums text-muted">
                          {item.tokens.toLocaleString("en-US")}
                        </span>
                      </li>
                    ))}
                    {(breakdown?.[id] ?? []).length === 0 && (
                      <li className="text-[11px] text-muted">No itemized entries.</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
        {model.overBudget && (
          <div
            className="h-full rounded-r-full bg-budget-overflow"
            style={{ width: `${model.overflowPct}%` }}
            data-testid="budget-overflow-segment"
            title={`Over budget by ${model.overflowTokens.toLocaleString("en-US")} tokens`}
          />
        )}
      </div>

      {model.overBudget ? (
        <p
          role="alert"
          className="text-[11px] font-medium text-red-600"
          data-testid="budget-over-label"
        >
          Over budget by {model.overflowTokens.toLocaleString("en-US")} tokens — trim mentions,
          relations or progressions before generating.
        </p>
      ) : (
        <p className="text-[11px] text-muted">
          {model.bufferPct > 0.5
            ? `${Math.round(model.bufferPct)}% of the context window is free.`
            : "Context window nearly full."}
        </p>
      )}
    </div>
  );
}

function lastVisibleSegment(segments: readonly { id: BudgetSegmentId; pct: number }[]) {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].pct > 0) return segments[i].id;
  }
  return "seed";
}
