/** Request-time telemetry over the existing assembler output (STO-1264).
 * No persistence, reranking, extra caps, or model-specific tokenization.
 */
import type { AssembledContext, ContextEntrySource } from "./context-assembler";
import {
  estimateFormattedEntryTokens,
  estimateWrapperTokens,
  formatAssembledContext,
} from "./prompt-formatter";
import { applyTokenBudget, type BudgetedAssembledContext } from "./token-budgeter";
import { estimateTokens } from "./tokens";

export interface ContextInspection extends AssembledContext {
  inspection: {
    context: BudgetedAssembledContext;
    formattedContext: string;
    telemetry: {
      method: "approximate";
      entries: { id: string; source: ContextEntrySource; tokens: number }[];
      bySource: Record<ContextEntrySource, number>;
      wrapperTokens: number;
      /** Sum of independently rounded blocks, used for the additive stack. */
      totalTokens: number;
      /** Estimate of the concatenated XML; may be lower due to rounding. */
      formattedTokens: number;
    };
  };
}

export function inspectAssembledContext(
  context: AssembledContext,
  maxTokens: number,
): ContextInspection {
  const budgeted = applyTokenBudget(context, { maxTokens });
  const bySource: Record<ContextEntrySource, number> = {
    manual: 0,
    always: 0,
    mention: 0,
    relation: 0,
  };
  const entries = budgeted.entries.map((entry) => {
    const tokens = estimateFormattedEntryTokens(entry);
    bySource[entry.source] += tokens;
    return { id: entry.id, source: entry.source, tokens };
  });
  const formattedContext = formatAssembledContext(budgeted);
  const wrapperTokens = estimateWrapperTokens();
  return {
    ...context,
    inspection: {
      context: budgeted,
      formattedContext,
      telemetry: {
        method: "approximate",
        entries,
        bySource,
        wrapperTokens,
        totalTokens: wrapperTokens + entries.reduce((sum, entry) => sum + entry.tokens, 0),
        formattedTokens: estimateTokens(formattedContext),
      },
    },
  };
}
