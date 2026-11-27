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
      let allowed = true;
      for (const window of windows) {
        let counter = window.counters.get(key);
        if (!counter || counter.resetAt <= at) {
          window.counters.delete(key);
          evict(window.counters, at, maxKeys);
          counter = { count: 0, resetAt: at + window.windowMs };
          window.counters.set(key, counter);
        }
        counter.count += 1;
        if (counter.count > window.limit) allowed = false;
      }
      return allowed;
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
