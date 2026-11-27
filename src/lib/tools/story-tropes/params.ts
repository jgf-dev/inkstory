/**
 * Query-string parsing and URL building for the shareable trope generator.
 * Unknown or malformed values fall back to defaults instead of erroring.
 */
import { normalizeSeed, type SearchParamsRecord } from "@/lib/tools/name-generator/params";
import {
  LOCK_SEPARATOR,
  getParamValues,
  parseFilterOption,
  splitLockIds,
  toggleLock,
} from "@/lib/tools/query-params";
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

export interface ParsedTropeGeneratorParams extends TropeFilters {
  /** Normalized seed, or `null` when absent or invalid. */
  seed: string | null;
  /** Valid locked trope ids, in order. */
  locked: string[];
}

function parseCount(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value.trim())) return DEFAULT_COUNT;
  return clampCount(Number(value));
}

/** Accepts `lock=a,b` and/or repeated `lock=a&lock=b`; keeps only valid, compatible ids. */
export function parseLockedIds(values: readonly string[]): string[] {
  const ids = splitLockIds(values, MAX_COUNT * 4);
  return resolveLocks(ids).map((trope) => trope.id);
}

export function parseTropeGeneratorParams(
  params: SearchParamsRecord | URLSearchParams | undefined,
): ParsedTropeGeneratorParams {
  const get = (key: string): string | undefined => getParamValues(params, key)[0];
  return {
    seed: normalizeSeed(get("seed")),
    genre: parseFilterOption(TROPE_GENRES, get("genre"), ANY) as GenreFilter,
    category: parseFilterOption(TROPE_CATEGORIES, get("category"), ANY) as CategoryFilter,
    count: parseCount(get("count")),
    locked: parseLockedIds(getParamValues(params, "lock")),
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

export { toggleLock };
