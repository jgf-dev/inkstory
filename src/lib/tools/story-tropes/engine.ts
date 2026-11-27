/**
 * Deterministic story trope engine (STO-1312). No network, no LLM: tropes are
 * weighted picks from the bundled catalog, driven by a seeded RNG so the same
 * seed + filters + count + locks always give the same combo.
 */
import { createRng, pickWeighted, type Rng } from "@/lib/tools/shared/rng";
import { TROPE_CATALOG } from "./catalog";
import {
  ANY,
  type CategoryFilter,
  type GeneratedTrope,
  type GenreFilter,
  type Trope,
  type TropeCatalog,
  type TropeGeneratorOptions,
} from "./types";

export const MIN_COUNT = 1;
export const MAX_COUNT = 8;
export const DEFAULT_COUNT = 4;
/** Random draws per open slot before falling back to a deterministic scan. */
const DRAWS_PER_SLOT = 30;

export function clampCount(count: number): number {
  if (!Number.isFinite(count)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.trunc(count)));
}

export function findTrope(id: string, catalog: TropeCatalog = TROPE_CATALOG): Trope | undefined {
  return catalog.tropes.find((trope) => trope.id === id);
}

/** Map of trope id to the ids it may not be combined with. Built per call. */
export function buildExclusionIndex(catalog: TropeCatalog): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  const add = (from: string, to: string) => {
    const set = index.get(from) ?? new Set<string>();
    set.add(to);
    index.set(from, set);
  };
  for (const [a, b] of catalog.exclusions) {
    add(a, b);
    add(b, a);
  }
  return index;
}

export function areExcluded(
  a: string,
  b: string,
  index: Map<string, Set<string>> = buildExclusionIndex(TROPE_CATALOG),
): boolean {
  return index.get(a)?.has(b) ?? false;
}

export function matchesFilters(
  trope: Trope,
  genre: GenreFilter,
  category: CategoryFilter,
): boolean {
  const genreOk = genre === ANY || trope.genres.length === 0 || trope.genres.includes(genre);
  const categoryOk = category === ANY || trope.category === category;
  return genreOk && categoryOk;
}

function fits(trope: Trope, chosen: readonly Trope[], index: Map<string, Set<string>>): boolean {
  return chosen.every((entry) => entry.id !== trope.id && !areExcluded(entry.id, trope.id, index));
}

/**
 * Valid locks in order: unknown ids, repeats and ids that clash with an
 * earlier lock are dropped, and at most `MAX_COUNT` are kept.
 */
export function resolveLocks(
  ids: readonly string[],
  catalog: TropeCatalog = TROPE_CATALOG,
  index: Map<string, Set<string>> = buildExclusionIndex(catalog),
): Trope[] {
  const locked: Trope[] = [];
  for (const id of ids) {
    if (locked.length >= MAX_COUNT) break;
    const trope = findTrope(id, catalog);
    if (!trope || !fits(trope, locked, index)) {
      continue;
    }
    locked.push(trope);
  }
  return locked;
}

/** Seed string mixed with the filters and count, so each setting has its own stream. */
export function rngKey(options: TropeGeneratorOptions): string {
  return [options.seed, options.genre, options.category, clampCount(options.count)].join("|");
}

function drawFree(
  rng: Rng,
  pool: readonly Trope[],
  chosen: Trope[],
  slots: number,
  index: Map<string, Set<string>>,
): void {
  const options = pool.map((trope) => ({ value: trope, weight: trope.weight }));
  const target = chosen.length + slots;
  // One rng() call per draw, and rejected draws are not removed from the
  // pool, so locking a shown trope keeps the other picks stable.
  for (let draw = 0; draw < slots * DRAWS_PER_SLOT && chosen.length < target; draw += 1) {
    const trope = pickWeighted(rng, options);
    if (fits(trope, chosen, index)) chosen.push(trope);
  }
  // Rare with real filters: fill any remaining slots by scanning in catalog order.
  for (const trope of pool) {
    if (chosen.length >= target) break;
    if (fits(trope, chosen, index)) chosen.push(trope);
  }
}

/**
 * Builds a combo of `count` tropes (or more if more are locked). Locked
 * tropes come first and are kept even if they fall outside the filters; the
 * rest are weighted picks that match the filters, never repeat and never
 * clash with anything already in the combo. May return fewer tropes when the
 * filters leave too few compatible options.
 */
export function generateTropes(
  options: TropeGeneratorOptions,
  catalog: TropeCatalog = TROPE_CATALOG,
): GeneratedTrope[] {
  const index = buildExclusionIndex(catalog);
  const locked = resolveLocks(options.locked, catalog, index);
  const count = Math.max(clampCount(options.count), locked.length);
  const chosen: Trope[] = [...locked];
  const pool = catalog.tropes.filter((trope) =>
    matchesFilters(trope, options.genre, options.category),
  );
  if (pool.length > 0 && chosen.length < count) {
    drawFree(createRng(rngKey(options)), pool, chosen, count - chosen.length, index);
  }
  return chosen.map((trope, position) => ({ trope, locked: position < locked.length }));
}
