/**
 * Query-string parsing and URL building for the shareable generator page.
 * Unknown or malformed values fall back to defaults instead of erroring.
 */
import {
  SEED_MAX_LENGTH,
  createRandomSeed,
  firstParam,
  nextSeed,
  normalizeSeed,
  oneOf,
  parseClampedCount,
  type SearchParamValue,
  type SearchParamsRecord,
} from "@/lib/tools/shared/params";
import { DEFAULT_COUNT, clampCount, isFlavorForGenre } from "./engine";
import {
  ANY_FLAVOR,
  GENDERS,
  GENRES,
  NAME_TYPES,
  type GenderPresentation,
  type Genre,
  type NameGeneratorFilters,
  type NameType,
} from "./types";

export {
  SEED_MAX_LENGTH,
  createRandomSeed,
  nextSeed,
  normalizeSeed,
  type SearchParamValue,
  type SearchParamsRecord,
};

export const NAME_GENERATOR_PATH = "/tools/character-name-generator";
export const NAME_GENERATOR_URL = `https://syncodex.xyz${NAME_GENERATOR_PATH}`;
export const DEFAULT_GENRE: Genre = "fantasy";
export const DEFAULT_GENDER: GenderPresentation = "any";
export const DEFAULT_NAME_TYPE: NameType = "full";

export interface ParsedNameGeneratorParams extends NameGeneratorFilters {
  /** Normalized seed, or `null` when absent or invalid. */
  seed: string | null;
}

export function parseNameGeneratorParams(
  params: SearchParamsRecord | URLSearchParams | undefined,
): ParsedNameGeneratorParams {
  const get = (key: string): string | undefined => firstParam(params, key);

  const genre = oneOf(GENRES, get("genre"), DEFAULT_GENRE);
  const flavorParam = get("flavor")?.trim().toLowerCase() ?? ANY_FLAVOR;
  return {
    seed: normalizeSeed(get("seed")),
    genre,
    gender: oneOf(GENDERS, get("gender"), DEFAULT_GENDER),
    flavor: isFlavorForGenre(genre, flavorParam) ? flavorParam : ANY_FLAVOR,
    type: oneOf(NAME_TYPES, get("type"), DEFAULT_NAME_TYPE),
    count: parseClampedCount(get("count"), DEFAULT_COUNT, clampCount),
  };
}

/** Builds the shareable page URL; default-valued filters are omitted. */
export function buildNameGeneratorHref(seed: string, filters: NameGeneratorFilters): string {
  const query = new URLSearchParams({ seed });
  query.set("genre", filters.genre);
  if (filters.gender !== DEFAULT_GENDER) query.set("gender", filters.gender);
  if (filters.flavor !== ANY_FLAVOR) query.set("flavor", filters.flavor);
  if (filters.type !== DEFAULT_NAME_TYPE) query.set("type", filters.type);
  if (filters.count !== DEFAULT_COUNT) query.set("count", String(filters.count));
  return `${NAME_GENERATOR_PATH}?${query.toString()}`;
}
