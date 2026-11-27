/**
 * Strict in-memory rate limiting for the public AI tools.
 *
 * Counters live in the Worker isolate, so limits are per isolate rather than
 * global. That is enough to stop one client from draining the free OpenRouter
 * quota through a single connection, and a denied request costs nothing
 * because callers fall back to the algorithmic result. No IP is persisted.
 */

export interface RateLimitWindow {
  limit: number;
  windowMs: number;
}

export interface RateLimiter {
  /** Records one hit for `key` and reports whether it is within every window. */
  consume(key: string): boolean;
}

export interface RateLimiterOptions {
  windows: readonly RateLimitWindow[];
  /** Cap on tracked keys per window; the oldest keys are evicted past it. */
  maxKeys?: number;
  now?: () => number;
}

interface Counter {
  count: number;
  resetAt: number;
}

const DEFAULT_MAX_KEYS = 5000;

function evict(counters: Map<string, Counter>, now: number, maxKeys: number): void {
  if (counters.size < maxKeys) return;
  for (const [key, counter] of counters) {
    if (counter.resetAt <= now) counters.delete(key);
  }
  // Map iteration follows insertion order, so this drops the oldest keys.
  for (const key of counters.keys()) {
    if (counters.size < maxKeys) break;
    counters.delete(key);
  }
}

/** Fixed-window limiter that must pass every configured window. */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  const now = options.now ?? Date.now;
  const windows = options.windows.map((window) => ({
    ...window,
    counters: new Map<string, Counter>(),
  }));

  return {
    consume(key) {
      const at = now();
      for (const window of windows) {
        const counter = window.counters.get(key);
        const currentCount = counter && counter.resetAt > at ? counter.count : 0;
        if (currentCount >= window.limit) return false;
      }
      for (const window of windows) {
        let counter = window.counters.get(key);
        if (!counter || counter.resetAt <= at) {
          window.counters.delete(key);
          evict(window.counters, at, maxKeys);
          counter = { count: 0, resetAt: at + window.windowMs };
          window.counters.set(key, counter);
        }
        counter.count += 1;
      }
      return true;
    },
  };
}

/**
 * Best-effort client address. Cloudflare sets `cf-connecting-ip`; the first
 * `x-forwarded-for` hop covers local and proxied runs. Unknown clients share
 * one bucket, which only makes the limit stricter.
 */
export function clientIpFrom(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

/** Per client IP for each public AI tool: 5 a minute and 20 an hour. */
export const TOOL_AI_IP_WINDOWS = [
  { limit: 5, windowMs: 60_000 },
  { limit: 20, windowMs: 3_600_000 },
] as const;
/** Per isolate across all clients for each tool, to protect the shared free quota. */
export const TOOL_AI_GLOBAL_WINDOWS = [{ limit: 300, windowMs: 3_600_000 }] as const;
/** Key used with the global limiter. */
export const GLOBAL_RATE_LIMIT_KEY = "*";

export interface ToolAiLimiters {
  ipLimiter: RateLimiter;
  globalLimiter: RateLimiter;
}

/** A fresh per-IP and global limiter pair; create one per route module. */
export function createToolAiLimiters(now?: () => number): ToolAiLimiters {
  return {
    ipLimiter: createRateLimiter({ windows: TOOL_AI_IP_WINDOWS, now }),
    globalLimiter: createRateLimiter({ windows: TOOL_AI_GLOBAL_WINDOWS, now }),
  };
}
