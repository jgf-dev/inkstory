/**
 * Query-string parsing and URL building for the shareable adult writing
 * prompt generator. Unknown or malformed values fall back to defaults.
 */
import { normalizeSeed, type SearchParamsRecord } from "@/lib/tools/name-generator/params";
import {
  LOCK_SEPARATOR,
  getParamValues,
  parseFilterOption,
  splitLockIds,
  toggleLock,
} from "@/lib/tools/query-params";
import { MAX_LOCKS, resolveLocks } from "./engine";
import {
  ANY,
  HEAT_LEVELS,
  PAIRINGS,
  PROMPT_GENRES,
  PROMPT_TROPES,
  type GenreFilter,
  type HeatFilter,
  type PairingFilter,
  type PromptFilters,
  type TropeFilter,
} from "./types";

export const PROMPT_GENERATOR_PATH = "/tools/adult-writing-prompt-generator";

export interface ParsedPromptGeneratorParams extends PromptFilters {
  /** Normalized seed, or `null` when absent or invalid. */
  seed: string | null;
  /** Valid locked fragment ids, in order. */
  locked: string[];
}

/** Accepts `lock=a,b` and/or repeated `lock=a&lock=b`; keeps only valid ids that fit the filters. */
export function parseLockedIds(
  values: readonly string[],
  filters: Pick<PromptFilters, "pairing" | "heat">,
): string[] {
  const ids = splitLockIds(values, MAX_LOCKS * 4);
  return resolveLocks(ids, filters).map((fragment) => fragment.id);
}

export function parsePromptGeneratorParams(
  params: SearchParamsRecord | URLSearchParams | undefined,
): ParsedPromptGeneratorParams {
  const get = (key: string): string | undefined => getParamValues(params, key)[0];
  const pairing = parseFilterOption(PAIRINGS, get("pairing"), ANY) as PairingFilter;
  const heat = parseFilterOption(HEAT_LEVELS, get("heat"), ANY) as HeatFilter;
  return {
    seed: normalizeSeed(get("seed")),
    pairing,
    heat,
    genre: parseFilterOption(PROMPT_GENRES, get("genre"), ANY) as GenreFilter,
    trope: parseFilterOption(PROMPT_TROPES, get("trope"), ANY) as TropeFilter,
    locked: parseLockedIds(getParamValues(params, "lock"), { pairing, heat }),
  };
}

/** Builds the shareable page URL; "any" filters and empty locks are omitted. */
export function buildPromptGeneratorHref(
  seed: string,
  filters: PromptFilters,
  locked: readonly string[],
): string {
  const query = new URLSearchParams({ seed });
  if (filters.pairing !== ANY) query.set("pairing", filters.pairing);
  if (filters.heat !== ANY) query.set("heat", filters.heat);
  if (filters.genre !== ANY) query.set("genre", filters.genre);
  if (filters.trope !== ANY) query.set("trope", filters.trope);
  if (locked.length > 0) query.set("lock", locked.join(LOCK_SEPARATOR));
  return `${PROMPT_GENERATOR_PATH}?${query.toString()}`;
}

export { toggleLock };
