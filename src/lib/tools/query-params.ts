/**
 * Shared query-string parsing helpers for public deterministic tool pages.
 */
import type { SearchParamValue, SearchParamsRecord } from "@/lib/tools/name-generator/params";

export const LOCK_SEPARATOR = ",";

/** Extracts all raw string values for `key` from either `URLSearchParams` or a plain record. */
export function getParamValues(
  params: SearchParamsRecord | URLSearchParams | undefined,
  key: string,
): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const value: SearchParamValue = params?.[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Matches a query value against an allowlist (case-insensitive), falling back otherwise. */
export function parseFilterOption<T extends string, F extends string>(
  allowed: readonly T[],
  value: string | undefined,
  fallback: F,
): T | F {
  const normalized = value?.trim().toLowerCase() ?? "";
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : fallback;
}

/** Splits comma-separated and/or repeated `lock` query values into normalized candidate ids. */
export function splitLockIds(values: readonly string[], maxCandidates: number): string[] {
  return values
    .flatMap((value) => value.split(LOCK_SEPARATOR))
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id.length > 0)
    .slice(0, maxCandidates);
}

/** Locked ids with `id` added (appended) or removed. */
export function toggleLock(locked: readonly string[], id: string): string[] {
  return locked.includes(id) ? locked.filter((entry) => entry !== id) : [...locked, id];
}
