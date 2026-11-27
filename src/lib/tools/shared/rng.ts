/**
 * Seedable pseudo-random number generation shared by public /tools generators.
 *
 * Everything here is pure: each call to `createRng` returns a fresh closure,
 * so no state is shared between requests on the Worker.
 */

/** A function returning a float in `[0, 1)`. */
export type Rng = () => number;

/** 32-bit FNV-1a hash of a string. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Mulberry32 generator seeded from an arbitrary string. */
export function createRng(seed: string): Rng {
  let state = hashString(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in `[0, max)`. */
export function randomInt(rng: Rng, max: number): number {
  return Math.floor(rng() * max);
}

export interface WeightedOption<T> {
  value: T;
  weight: number;
}

/** Picks one option with probability proportional to its weight. */
export function pickWeighted<T>(rng: Rng, options: readonly WeightedOption<T>[]): T {
  if (options.length === 0) throw new Error("pickWeighted needs at least one option");
  const total = options.reduce((sum, option) => sum + Math.max(0, option.weight), 0);
  if (total <= 0) return options[0].value;
  let roll = rng() * total;
  for (const option of options) {
    roll -= Math.max(0, option.weight);
    if (roll < 0) return option.value;
  }
  return options[options.length - 1].value;
}

/**
 * Picks from a curated list where earlier entries are favoured: the first
 * entry weighs twice as much as the last, with a linear ramp in between.
 */
export function pickRanked<T>(rng: Rng, list: readonly T[]): T {
  if (list.length === 0) throw new Error("pickRanked needs a non-empty list");
  if (list.length === 1) return list[0];
  const last = list.length - 1;
  return pickWeighted(
    rng,
    list.map((value, index) => ({ value, weight: 2 - index / last })),
  );
}
