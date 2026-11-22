/**
 * Short-lived OpenRouter endpoint-catalog overlay (STO-1265).
 *
 * `GET /api/v1/models/{author}/{slug}/endpoints` is public (no key) and lists
 * `supported_parameters` per endpoint. Results are cached in memory per
 * isolate for {@link OPENROUTER_CATALOG_TTL_MS}; expired entries are never
 * used, and failures are not cached, so stale or missing metadata resolves to
 * `unknown` (no native sampler sent). Workers-compatible: fetch + Map only.
 */

export const OPENROUTER_CATALOG_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_CATALOG_TTL_MS = 60 * 60 * 1000;
const CATALOG_TIMEOUT_MS = 5000;
const MAX_CACHE_ENTRIES = 256;

export interface OpenRouterEndpointInfo {
  /** Routing slug, e.g. `deepinfra/turbo`. */
  tag: string;
  providerName: string;
  supportedParameters: string[];
}

export interface OpenRouterCatalogEntry {
  model: string;
  fetchedAt: number;
  endpoints: OpenRouterEndpointInfo[];
}

export interface CatalogLoadOptions {
  fetch?: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
}

export type OpenRouterCatalogLoader = (
  model: string,
  options?: CatalogLoadOptions,
) => Promise<OpenRouterCatalogEntry | null>;

const cache = new Map<string, OpenRouterCatalogEntry>();

/** Test hook: drop all cached catalog entries. */
export function clearOpenRouterCatalogCache(): void {
  cache.clear();
}

const MODEL_ID = /^[A-Za-z0-9][\w.-]*\/[\w.-]+(?::[\w.-]+)?$/;

/** `author/slug[:variant]` → catalog path, or null for ids we won't look up. */
export function catalogPathFor(model: string): string | null {
  const id = model.trim();
  if (!MODEL_ID.test(id)) return null;
  const [author, rest] = id.split("/");
  const slug = rest.split(":")[0];
  return `/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`;
}

export function isFresh(entry: OpenRouterCatalogEntry, now: number): boolean {
  return now - entry.fetchedAt >= 0 && now - entry.fetchedAt < OPENROUTER_CATALOG_TTL_MS;
}

function parseEndpoints(body: unknown): OpenRouterEndpointInfo[] | null {
  const endpoints = (body as { data?: { endpoints?: unknown } } | null)?.data?.endpoints;
  if (!Array.isArray(endpoints)) return null;
  const parsed: OpenRouterEndpointInfo[] = [];
  for (const raw of endpoints) {
    const e = raw as { tag?: unknown; provider_name?: unknown; supported_parameters?: unknown };
    if (typeof e?.tag !== "string" || !e.tag || !Array.isArray(e.supported_parameters)) continue;
    parsed.push({
      tag: e.tag,
      providerName: typeof e.provider_name === "string" ? e.provider_name : e.tag,
      supportedParameters: e.supported_parameters.filter((p): p is string => typeof p === "string"),
    });
  }
  // A non-empty list with no valid entry is malformed metadata, not proof the
  // model has no capable endpoints — report it as unavailable (unknown).
  if (endpoints.length > 0 && parsed.length === 0) return null;
  return parsed;
}

/**
 * Loads (and caches) the endpoint catalog for an OpenRouter model. Returns
 * null when the catalog is unavailable or malformed — callers must treat that
 * as unknown support.
 */
export const loadOpenRouterCatalog: OpenRouterCatalogLoader = async (model, options = {}) => {
  const path = catalogPathFor(model);
  if (!path) return null;
  const now = options.now ?? Date.now;
  const key = model.trim();
  const cached = cache.get(key);
  if (cached && isFresh(cached, now())) return cached;
  if (cached) cache.delete(key);

  const doFetch = options.fetch ?? globalThis.fetch;
  const timeout = AbortSignal.timeout(CATALOG_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let body: unknown;
  try {
    const response = await doFetch(`${OPENROUTER_CATALOG_BASE_URL}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) return null;
    body = await response.json();
  } catch {
    return null;
  }
  const endpoints = parseEndpoints(body);
  if (!endpoints) return null;

  const entry: OpenRouterCatalogEntry = { model: key, fetchedAt: now(), endpoints };
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, entry);
  return entry;
};
