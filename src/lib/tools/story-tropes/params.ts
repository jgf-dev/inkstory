/**
 * Query-string parsing and URL building for the shareable trope generator.
 * Unknown or malformed values fall back to defaults instead of erroring.
 */
import {
  normalizeSeed,
  type SearchParamValue,
  type SearchParamsRecord,
} from "../name-generator/params";
import { DEFAULT_COUNT, MAX_COUNT, clampCount, resolveLocks } from "./engine";
import {
  ANY,
  TROPE_CATEGORIES,
  TROPE_GENRES,
  type CategoryFilter,
  type GenreFilter,
  type TropeFilters,
} from "./types";

export const TROPE_GENERATOR_PATH = "/tools/story-trope-generator";
const LOCK_SEPARATOR = ",";

export interface ParsedTropeGeneratorParams extends TropeFilters {
  /** Normalized seed, or `null` when absent or invalid. */
  seed: string | null;
  /** Valid locked trope ids, in order. */
  locked: string[];
}

function all(params: SearchParamsRecord | URLSearchParams | undefined, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const value: SearchParamValue = params?.[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function oneOf<T extends string>(allowed: readonly T[], value: string | undefined): T | typeof ANY {
  const normalized = value?.trim().toLowerCase() ?? "";
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : ANY;
}

function parseCount(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value.trim())) return DEFAULT_COUNT;
  return clampCount(Number(value));
}

/** Accepts `lock=a,b` and/or repeated `lock=a&lock=b`; keeps only valid, compatible ids. */
export function parseLockedIds(values: readonly string[]): string[] {
  const ids = values
    .flatMap((value) => value.split(LOCK_SEPARATOR))
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id.length > 0)
    .slice(0, MAX_COUNT * 4);
  return resolveLocks(ids).map((trope) => trope.id);
}

export function parseTropeGeneratorParams(
  params: SearchParamsRecord | URLSearchParams | undefined,
): ParsedTropeGeneratorParams {
  const get = (key: string): string | undefined => all(params, key)[0];
  return {
    seed: normalizeSeed(get("seed")),
    genre: oneOf(TROPE_GENRES, get("genre")) as GenreFilter,
    category: oneOf(TROPE_CATEGORIES, get("category")) as CategoryFilter,
    count: parseCount(get("count")),
    locked: parseLockedIds(all(params, "lock")),
  };
}

/** Builds the shareable page URL; default-valued filters and empty locks are omitted. */
export function buildTropeGeneratorHref(
  seed: string,
  filters: TropeFilters,
  locked: readonly string[],
): string {
  const query = new URLSearchParams({ seed });
  if (filters.genre !== ANY) query.set("genre", filters.genre);
  if (filters.category !== ANY) query.set("category", filters.category);
  if (filters.count !== DEFAULT_COUNT) query.set("count", String(filters.count));
  if (locked.length > 0) query.set("lock", locked.join(LOCK_SEPARATOR));
  return `${TROPE_GENERATOR_PATH}?${query.toString()}`;
}

/** Locked ids with `id` added (appended) or removed. */
export function toggleLock(locked: readonly string[], id: string): string[] {
  return locked.includes(id) ? locked.filter((entry) => entry !== id) : [...locked, id];
}
