/**
 * Query-string parsing and URL building for the shareable adult writing
 * prompt generator. Unknown or malformed values fall back to defaults.
 */
import {
  normalizeSeed,
  type SearchParamValue,
  type SearchParamsRecord,
} from "../name-generator/params";
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
const LOCK_SEPARATOR = ",";

export interface ParsedPromptGeneratorParams extends PromptFilters {
  /** Normalized seed, or `null` when absent or invalid. */
  seed: string | null;
  /** Valid locked fragment ids, in order. */
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

/** Accepts `lock=a,b` and/or repeated `lock=a&lock=b`; keeps only valid ids that fit the filters. */
export function parseLockedIds(
  values: readonly string[],
  filters: Pick<PromptFilters, "pairing" | "heat">,
): string[] {
  const ids = values
    .flatMap((value) => value.split(LOCK_SEPARATOR))
    .map((id) => id.trim().toLowerCase())
    .filter((id) => id.length > 0)
    .slice(0, MAX_LOCKS * 4);
  return resolveLocks(ids, filters).map((fragment) => fragment.id);
}

export function parsePromptGeneratorParams(
  params: SearchParamsRecord | URLSearchParams | undefined,
): ParsedPromptGeneratorParams {
  const get = (key: string): string | undefined => all(params, key)[0];
  const pairing = oneOf(PAIRINGS, get("pairing")) as PairingFilter;
  const heat = oneOf(HEAT_LEVELS, get("heat")) as HeatFilter;
  return {
    seed: normalizeSeed(get("seed")),
    pairing,
    heat,
    genre: oneOf(PROMPT_GENRES, get("genre")) as GenreFilter,
    trope: oneOf(PROMPT_TROPES, get("trope")) as TropeFilter,
    locked: parseLockedIds(all(params, "lock"), { pairing, heat }),
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

export { toggleLock } from "../story-tropes/params";
