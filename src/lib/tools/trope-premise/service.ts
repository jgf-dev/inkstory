/**
 * AI mode for the story trope generator (STO-1314). The algorithmic combo is
 * always the fallback: missing key, rate limit, quota, timeout, provider
 * error or invalid output all return the catalog tropes silently.
 */
import type { AiFailureReason, OpenRouterOptions } from "@/lib/tools/shared/openrouter";
import { GLOBAL_RATE_LIMIT_KEY, type ToolAiLimiters } from "@/lib/tools/shared/rate-limit";
import { comboTropes } from "./input";
import { requestAiPremise } from "./openrouter";
import type { PremiseInput, PremiseResult } from "./types";

export type PremiseFallbackReason =
  | "not_configured"
  | "ip_rate_limited"
  | "global_rate_limited"
  | AiFailureReason;

export interface PremiseDeps extends Omit<OpenRouterOptions, "apiKey">, ToolAiLimiters {
  apiKey: string | undefined;
  /** Receives a short reason code when AI mode falls back. */
  onFallback?: (reason: PremiseFallbackReason) => void;
}

export async function getTropePremise(
  input: PremiseInput,
  clientIp: string,
  deps: PremiseDeps,
): Promise<PremiseResult> {
  const { apiKey: rawApiKey, ipLimiter, globalLimiter, onFallback, ...aiOptions } = deps;
  const tropes = comboTropes(input);
  const fallback = (reason: PremiseFallbackReason): PremiseResult => {
    onFallback?.(reason);
    return { source: "combo", premise: null, tropes };
  };

  const apiKey = rawApiKey?.trim();
  if (!apiKey) return fallback("not_configured");
  if (!ipLimiter.consume(clientIp)) return fallback("ip_rate_limited");
  if (!globalLimiter.consume(GLOBAL_RATE_LIMIT_KEY)) return fallback("global_rate_limited");

  const outcome = await requestAiPremise(input, { ...aiOptions, apiKey });
  if (!outcome.ok) return fallback(outcome.reason);
  return { source: "ai", premise: outcome.value, tropes };
}
