/**
 * AI mode for the character name generator (STO-1313). The algorithmic
 * template is always the fallback: missing key, rate limit, quota, timeout,
 * provider error or invalid output all return the template silently.
 */
import { createRateLimiter, type RateLimiter } from "./rate-limit";
import { requestAiBackstory, type AiBackstoryOptions } from "./openrouter";
import { templateBackstory } from "./template";
import type { BackstoryInput, BackstoryResult } from "./types";

/** Per client IP: 5 a minute and 20 an hour. */
export const BACKSTORY_IP_WINDOWS = [
  { limit: 5, windowMs: 60_000 },
  { limit: 20, windowMs: 3_600_000 },
] as const;
/** Per isolate across all clients, to protect the shared free quota. */
export const BACKSTORY_GLOBAL_WINDOWS = [{ limit: 300, windowMs: 3_600_000 }] as const;

const GLOBAL_KEY = "*";

export interface BackstoryDeps {
  apiKey: string | undefined;
  model?: string;
  appUrl?: string;
  ipLimiter: RateLimiter;
  globalLimiter: RateLimiter;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Receives a short reason code when AI mode falls back. */
  onFallback?: (reason: string) => void;
}

export function createBackstoryLimiters(now?: () => number) {
  return {
    ipLimiter: createRateLimiter({ windows: BACKSTORY_IP_WINDOWS, now }),
    globalLimiter: createRateLimiter({ windows: BACKSTORY_GLOBAL_WINDOWS, now }),
  };
}

export async function getCharacterBackstory(
  input: BackstoryInput,
  clientIp: string,
  deps: BackstoryDeps,
): Promise<BackstoryResult> {
  const fallback = (reason: string): BackstoryResult => {
    deps.onFallback?.(reason);
    return { backstory: templateBackstory(input), source: "template" };
  };

  const apiKey = deps.apiKey?.trim();
  if (!apiKey) return fallback("not_configured");
  if (!deps.ipLimiter.consume(clientIp)) return fallback("ip_rate_limited");
  if (!deps.globalLimiter.consume(GLOBAL_KEY)) return fallback("global_rate_limited");

  const options: AiBackstoryOptions = {
    apiKey,
    model: deps.model,
    appUrl: deps.appUrl,
    fetch: deps.fetch,
    timeoutMs: deps.timeoutMs,
  };
  const outcome = await requestAiBackstory(input, options);
  if (!outcome.ok) return fallback(outcome.reason);
  return { backstory: outcome.backstory, source: "ai" };
}
