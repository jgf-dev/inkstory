/**
 * AI mode for the character name generator (STO-1313). The algorithmic
 * template is always the fallback: missing key, rate limit, quota, timeout,
 * provider error or invalid output all return the template silently.
 */
import {
  GLOBAL_RATE_LIMIT_KEY,
  TOOL_AI_GLOBAL_WINDOWS,
  TOOL_AI_IP_WINDOWS,
  createToolAiLimiters,
  type RateLimiter,
} from "@/lib/tools/shared/rate-limit";
import { requestAiBackstory, type AiBackstoryOptions, type AiFailureReason } from "./openrouter";
import { templateBackstory } from "./template";
import type { BackstoryInput, BackstoryResult } from "./types";

/** Per client IP: 5 a minute and 20 an hour. */
export const BACKSTORY_IP_WINDOWS = TOOL_AI_IP_WINDOWS;
/** Per isolate across all clients, to protect the shared free quota. */
export const BACKSTORY_GLOBAL_WINDOWS = TOOL_AI_GLOBAL_WINDOWS;

export type BackstoryFallbackReason =
  | "not_configured"
  | "ip_rate_limited"
  | "global_rate_limited"
  | AiFailureReason;

export interface BackstoryDeps extends Omit<AiBackstoryOptions, "apiKey"> {
  apiKey: string | undefined;
  ipLimiter: RateLimiter;
  globalLimiter: RateLimiter;
  /** Receives a short reason code when AI mode falls back. */
  onFallback?: (reason: BackstoryFallbackReason) => void;
}

export function createBackstoryLimiters(now?: () => number) {
  return createToolAiLimiters(now);
}

export async function getCharacterBackstory(
  input: BackstoryInput,
  clientIp: string,
  deps: BackstoryDeps,
): Promise<BackstoryResult> {
  const { apiKey: rawApiKey, ipLimiter, globalLimiter, onFallback, ...aiOptions } = deps;
  const fallback = (reason: BackstoryFallbackReason): BackstoryResult => {
    onFallback?.(reason);
    return { backstory: templateBackstory(input), source: "template" };
  };

  const apiKey = rawApiKey?.trim();
  if (!apiKey) return fallback("not_configured");
  if (!ipLimiter.consume(clientIp)) return fallback("ip_rate_limited");
  if (!globalLimiter.consume(GLOBAL_RATE_LIMIT_KEY)) return fallback("global_rate_limited");

  const outcome = await requestAiBackstory(input, { ...aiOptions, apiKey });
  if (!outcome.ok) return fallback(outcome.reason);
  return { backstory: outcome.backstory, source: "ai" };
}
