/**
 * Token Budget Bar segment math (JGF-128, design rev 4 §1.1 item 4).
 *
 * Pure functions so the stacked-bar layout is unit-testable without a DOM.
 * The bar always caps at 100% width; when the segments exceed the budget the
 * real segments are scaled into the share of the window that still fits and
 * the overflow share renders as a destructive red band with a label.
 */

import { DEFAULT_MAX_TOKENS } from "./token-budgeter";

export type BudgetSegmentId = "seed" | "mentions" | "relations" | "progressions";

export const BUDGET_SEGMENT_LABELS: Record<BudgetSegmentId, string> = {
  seed: "Seed",
  mentions: "Mentions",
  relations: "Relations",
  progressions: "Progressions",
};

export interface BudgetSegmentInput {
  id: BudgetSegmentId;
  tokens: number;
}

export interface BudgetSegmentLayout extends BudgetSegmentInput {
  /** Percentage of the bar this segment occupies (0–100). */
  pct: number;
}

export interface TokenBudgetBarModel {
  maxTokens: number;
  /** Sum of all segment tokens (may exceed maxTokens). */
  usedTokens: number;
  /** Percentage of the bar covered by real segments (<= 100). */
  usedPct: number;
  /** True when the segments exceed the budget. */
  overBudget: boolean;
  /** Tokens beyond the budget (0 when within budget). */
  overflowTokens: number;
  /** Width of the red overflow band (0 when within budget). */
  overflowPct: number;
  /** Remaining neutral buffer width (0 when over budget). */
  bufferPct: number;
  /** Real segments in display order with resolved widths. */
  segments: BudgetSegmentLayout[];
}

function clampTokens(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.floor(value);
}

/**
 * Resolves segment widths for the stacked bar.
 *
 * Within budget: widths are `tokens / maxTokens × 100` and the remainder is
 * the neutral buffer. Over budget: the overflow share of demanded tokens,
 * `(used - max) / used`, becomes the red band; the real segments keep their
 * relative proportions inside the remaining `max / used` share of the bar,
 * so the whole bar caps at exactly 100%.
 */
export function computeTokenBudgetBar(
  segments: readonly BudgetSegmentInput[],
  maxTokens: number = DEFAULT_MAX_TOKENS,
): TokenBudgetBarModel {
  const max = clampTokens(maxTokens) || DEFAULT_MAX_TOKENS;
  const clean = segments.map((s) => ({ id: s.id, tokens: clampTokens(s.tokens) }));
  const usedTokens = clean.reduce((sum, s) => sum + s.tokens, 0);

  if (usedTokens === 0) {
    return {
      maxTokens: max,
      usedTokens: 0,
      usedPct: 0,
      overBudget: false,
      overflowTokens: 0,
      overflowPct: 0,
      bufferPct: 100,
      segments: clean.map((s) => ({ ...s, pct: 0 })),
    };
  }

  if (usedTokens <= max) {
    const laidOut = clean.map((s) => ({ ...s, pct: (s.tokens / max) * 100 }));
    const usedPct = (usedTokens / max) * 100;
    return {
      maxTokens: max,
      usedTokens,
      usedPct,
      overBudget: false,
      overflowTokens: 0,
      overflowPct: 0,
      bufferPct: Math.max(0, 100 - usedPct),
      segments: laidOut,
    };
  }

  // Over budget: red band = share of demand that does not fit.
  const overflowTokens = usedTokens - max;
  const overflowPct = (overflowTokens / usedTokens) * 100;
  const realPct = 100 - overflowPct; // === (max / used) × 100
  const laidOut = clean.map((s) => ({
    ...s,
    pct: (s.tokens / usedTokens) * realPct,
  }));

  return {
    maxTokens: max,
    usedTokens,
    usedPct: realPct,
    overBudget: true,
    overflowTokens,
    overflowPct,
    bufferPct: 0,
    segments: laidOut,
  };
}

/** "1,234 / 4,000 tokens" summary label for the bar. */
export function formatBudgetSummary(model: TokenBudgetBarModel): string {
  const used = model.usedTokens.toLocaleString("en-US");
  const max = model.maxTokens.toLocaleString("en-US");
  return `${used} / ${max} tokens`;
}
