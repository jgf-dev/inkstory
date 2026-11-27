/**
 * Shared query-string and seed helpers for public /tools generators.
 * Unknown or malformed values fall back to defaults instead of erroring.
 */
import { hashString } from "@/lib/tools/shared/rng";

export const SEED_MAX_LENGTH = 32;
const SEED_PATTERN = /^[a-z0-9-]+$/;

export type SearchParamValue = string | string[] | undefined;
export type SearchParamsRecord = Record<string, SearchParamValue>;

export function allParams(
  params: SearchParamsRecord | URLSearchParams | undefined,
  key: string,
): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const value: SearchParamValue = params?.[key];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function firstParam(
  params: SearchParamsRecord | URLSearchParams | undefined,
  key: string,
): string | undefined {
  return allParams(params, key)[0];
}

export function oneOf<T extends string, F extends string = T>(
  allowed: readonly T[],
  value: string | undefined,
  fallback: F,
): T | F {
  const normalized = value?.trim().toLowerCase() ?? "";
  return (allowed as readonly string[]).includes(normalized) ? (normalized as T) : fallback;
}

export function parseClampedCount(
  value: string | undefined,
  defaultCount: number,
  clamp: (count: number) => number,
): number {
  if (!value || !/^\d+$/.test(value.trim())) return defaultCount;
  return clamp(Number(value));
}

/** Lowercases and validates a seed; returns `null` if it is unusable. */
export function normalizeSeed(value: string | undefined): string | null {
  const seed = value?.trim().toLowerCase() ?? "";
  if (seed.length === 0 || seed.length > SEED_MAX_LENGTH) return null;
  return SEED_PATTERN.test(seed) ? seed : null;
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
