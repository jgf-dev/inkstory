/**
 * Token budgeter (STO-1172): enforces a hard estimated-token limit on an
 * `AssembledContext` so prompt assembly cannot blow up the model context
 * window.
 *
 * Strategy (priority order = the assembler's ranked entry order):
 * 1. Include entries whole, highest priority first, while they fit.
 * 2. When an entry does not fit whole, truncate its description to the
 *    largest prefix that fits (graceful degradation) and mark it truncated.
 * 3. When nothing further fits, drop the entry and keep scanning — a smaller,
 *    lower-priority entry may still fit the remaining budget.
 *
 * The budget accounts for the exact prompt the formatter will emit: each entry
 * is measured as `estimateFormattedEntryTokens` (block + terminating newline)
 * plus the fixed wrapper (header/footer). Because `estimateTokens` is
 * subadditive under concatenation, this guarantees
 * `estimateFormattedContextTokens(result) <= maxTokens`.
 */

import type { AssembledContext, AssembledContextEntry } from "./context-assembler";
import {
  estimateFormattedContextTokens,
  estimateFormattedEntryTokens,
  estimateWrapperTokens,
} from "./prompt-formatter";

/** Default hard limit on estimated prompt tokens when callers omit `maxTokens`. */
export const DEFAULT_MAX_TOKENS = 4000;

export interface TokenBudgetOptions {
  /** Hard limit on estimated prompt tokens. Defaults to {@link DEFAULT_MAX_TOKENS}. */
  maxTokens?: number;
}

export interface TokenBudgetMeta {
  /** Budget the result was fitted against. */
  maxTokens: number;
  /** Estimated tokens of the input context before budgeting. */
  estimatedTokensBefore: number;
  /** Estimated tokens of the returned context (always <= `maxTokens`). */
  estimatedTokensAfter: number;
  /** Entries removed entirely because nothing fit. */
  droppedEntryIds: string[];
  /** Entries kept with a shortened description to fit the remaining budget. */
  truncatedEntryIds: string[];
}

export type BudgetedAssembledContext = Omit<AssembledContext, "meta"> & {
  meta: AssembledContext["meta"] & TokenBudgetMeta;
};

function normalizeCount(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

/**
 * Largest description prefix length (in characters) whose entry block fits
 * `remaining` estimated tokens, or `null` when even an empty description
 * cannot fit. Binary search over a monotonic estimate.
 */
function largestFittingPrefixLength(
  entry: AssembledContextEntry,
  remaining: number,
): number | null {
  if (remaining < estimateFormattedEntryTokens({ ...entry, description: "" })) {
    return null;
  }

  let lo = 0;
  let hi = entry.description.length;
  let best: number | null = null;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate: AssembledContextEntry = {
      ...entry,
      description: entry.description.slice(0, mid),
    };
    if (estimateFormattedEntryTokens(candidate) <= remaining) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * Applies a hard estimated-token budget to an assembled context.
 *
 * Returns a new context (input is not mutated) whose `meta` is extended with
 * budget statistics. Entry order is preserved; lowest-priority overflow is
 * dropped or gracefully truncated as described in the module doc.
 */
export function applyTokenBudget(
  context: AssembledContext,
  options: TokenBudgetOptions = {},
): BudgetedAssembledContext {
  const maxTokens = normalizeCount(options.maxTokens, DEFAULT_MAX_TOKENS);
  const estimatedTokensBefore = estimateFormattedContextTokens(context);

  if (context.entries.length === 0 || estimatedTokensBefore <= maxTokens) {
    return {
      ...context,
      meta: {
        ...context.meta,
        maxTokens,
        estimatedTokensBefore,
        estimatedTokensAfter: estimatedTokensBefore,
        droppedEntryIds: [],
        truncatedEntryIds: [],
      },
    };
  }

  let used = estimateWrapperTokens();
  const kept: AssembledContextEntry[] = [];
  const droppedEntryIds: string[] = [];
  const truncatedEntryIds: string[] = [];

  for (const entry of context.entries) {
    const whole = estimateFormattedEntryTokens(entry);
    if (used + whole <= maxTokens) {
      kept.push(entry);
      used += whole;
      continue;
    }

    const remaining = maxTokens - used;
    const prefixLength = largestFittingPrefixLength(entry, remaining);
    if (prefixLength === null) {
      droppedEntryIds.push(entry.id);
      continue;
    }

    const truncated: AssembledContextEntry = {
      ...entry,
      description: entry.description.slice(0, prefixLength),
    };
    kept.push(truncated);
    truncatedEntryIds.push(entry.id);
    used += estimateFormattedEntryTokens(truncated);
  }

  const result: BudgetedAssembledContext = {
    ...context,
    entries: kept,
    meta: {
      ...context.meta,
      maxTokens,
      estimatedTokensBefore,
      estimatedTokensAfter: estimateFormattedContextTokens({ ...context, entries: kept }),
      droppedEntryIds,
      truncatedEntryIds,
    },
  };

  return result;
}
