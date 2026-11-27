/**
 * Query-string parsing and URL building for the shareable generator page.
 * Unknown or malformed values fall back to defaults instead of erroring.
 */
import { DEFAULT_COUNT, clampCount, isFlavorForGenre } from "./engine";
import { hashString } from "./rng";
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

export const NAME_GENERATOR_PATH = "/tools/character-name-generator";
export const NAME_GENERATOR_URL = `https://syncodex.xyz${NAME_GENERATOR_PATH}`;
export const DEFAULT_GENRE: Genre = "fantasy";
export const DEFAULT_GENDER: GenderPresentation = "any";
export const DEFAULT_NAME_TYPE: NameType = "full";
export const SEED_MAX_LENGTH = 32;
const SEED_PATTERN = /^[a-z0-9-]+$/;

export type SearchParamValue = string | string[] | undefined;
export type SearchParamsRecord = Record<string, SearchParamValue>;

export interface ParsedNameGeneratorParams extends NameGeneratorFilters {
  /** Normalized seed, or `null` when absent or invalid. */
  seed: string | null;
}

function first(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(allowed: readonly T[], value: string | undefined, fallback: T): T {
  const normalized = value?.trim().toLowerCase();
  return (allowed as readonly string[]).includes(normalized ?? "") ? (normalized as T) : fallback;
}

/** Lowercases and validates a seed; returns `null` if it is unusable. */
export function normalizeSeed(value: string | undefined): string | null {
  const seed = value?.trim().toLowerCase() ?? "";
  if (seed.length === 0 || seed.length > SEED_MAX_LENGTH) return null;
  return SEED_PATTERN.test(seed) ? seed : null;
}

function parseCount(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value.trim())) return DEFAULT_COUNT;
  return clampCount(Number(value));
}

export function parseNameGeneratorParams(
  params: SearchParamsRecord | URLSearchParams | undefined,
): ParsedNameGeneratorParams {
  const get = (key: string): string | undefined =>
    params instanceof URLSearchParams ? (params.get(key) ?? undefined) : first(params?.[key]);

  const genre = oneOf(GENRES, get("genre"), DEFAULT_GENRE);
  const flavorParam = get("flavor")?.trim().toLowerCase() ?? ANY_FLAVOR;
  return {
    seed: normalizeSeed(get("seed")),
    genre,
    gender: oneOf(GENDERS, get("gender"), DEFAULT_GENDER),
    flavor: isFlavorForGenre(genre, flavorParam) ? flavorParam : ANY_FLAVOR,
    type: oneOf(NAME_TYPES, get("type"), DEFAULT_NAME_TYPE),
    count: parseCount(get("count")),
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

/** Deterministically derives the seed used by "Generate more". */
export function nextSeed(seed: string): string {
  return hashString(`${seed}:next`).toString(36);
}

/** Fresh random seed for a visit without one (Web Crypto; safe on Workers). */
export function createRandomSeed(
  getRandomValues: (array: Uint32Array) => Uint32Array = (array) =>
    globalThis.crypto.getRandomValues(array),
): string {
  const [value] = getRandomValues(new Uint32Array(1));
  return value.toString(36);
}
