/**
 * Deterministic adult writing prompt engine (STO-1315). No network, no LLM:
 * each slot is a weighted pick from the bundled catalog, driven by a seeded
 * RNG, so the same seed + filters + locks always give the same prompt.
 */
import { createRng, pickWeighted, type Rng } from "../name-generator/rng";
import { PROMPT_CATALOG } from "./catalog";
import {
  ANY,
  PROMPT_SLOTS,
  SLOT_SIZES,
  type GeneratedPrompt,
  type GeneratedSlot,
  type GenreFilter,
  type PromptCatalog,
  type PromptFilters,
  type PromptFragment,
  type PromptGeneratorOptions,
  type PromptSlot,
} from "./types";

/** Upper bound on locks (one per open slot position). */
export const MAX_LOCKS = PROMPT_SLOTS.reduce((sum, slot) => sum + SLOT_SIZES[slot], 0);

export function findFragment(
  id: string,
  catalog: PromptCatalog = PROMPT_CATALOG,
): PromptFragment | undefined {
  return catalog.fragments.find((fragment) => fragment.id === id);
}

function fitsList<T extends string>(list: readonly T[], value: T | typeof ANY): boolean {
  return value === ANY || list.length === 0 || list.includes(value);
}

/** Pairing and heat are hard filters: never relaxed, and locks must match them too. */
export function matchesHardFilters(
  fragment: PromptFragment,
  filters: Pick<PromptFilters, "pairing" | "heat">,
): boolean {
  return fitsList(fragment.pairings, filters.pairing) && fitsList(fragment.heats, filters.heat);
}

export function matchesGenre(fragment: PromptFragment, genre: GenreFilter): boolean {
  return fitsList(fragment.genres, genre);
}

/** The trope filter narrows the setup slot only; other slots ignore it. */
export function matchesTrope(fragment: PromptFragment, filters: PromptFilters): boolean {
  if (filters.trope === ANY || fragment.slot !== "setup") return true;
  return fragment.tropes.includes(filters.trope);
}

/**
 * Candidates for one slot. Pairing and heat always apply; if nothing fits
 * the soft filters the genre is relaxed first, then the trope.
 */
export function slotPool(
  slot: PromptSlot,
  filters: PromptFilters,
  catalog: PromptCatalog = PROMPT_CATALOG,
): PromptFragment[] {
  const hard = catalog.fragments.filter(
    (fragment) => fragment.slot === slot && matchesHardFilters(fragment, filters),
  );
  const strict = hard.filter(
    (fragment) => matchesGenre(fragment, filters.genre) && matchesTrope(fragment, filters),
  );
  if (strict.length > 0) return strict;
  const tropeOnly = hard.filter((fragment) => matchesTrope(fragment, filters));
  return tropeOnly.length > 0 ? tropeOnly : hard;
}

/**
 * Valid locks in order: unknown ids, repeats, fragments that break the
 * pairing or heat filter, and locks beyond a slot's size are dropped.
 */
export function resolveLocks(
  ids: readonly string[],
  filters: Pick<PromptFilters, "pairing" | "heat">,
  catalog: PromptCatalog = PROMPT_CATALOG,
): PromptFragment[] {
  const locked: PromptFragment[] = [];
  for (const id of ids) {
    const fragment = findFragment(id, catalog);
    if (!fragment || !matchesHardFilters(fragment, filters)) continue;
    const inSlot = locked.filter((entry) => entry.slot === fragment.slot);
    if (inSlot.length >= SLOT_SIZES[fragment.slot] || inSlot.some((entry) => entry.id === id)) {
      continue;
    }
    locked.push(fragment);
  }
  return locked;
}

/** Seed string mixed with the filters and slot, so each slot has its own stream. */
export function rngKey(options: PromptGeneratorOptions, slot: PromptSlot): string {
  return [options.seed, options.pairing, options.heat, options.genre, options.trope, slot].join(
    "|",
  );
}

/** Fragments written for the chosen genre weigh more than genre-neutral ones. */
export const GENRE_MATCH_BOOST = 3;

export function fragmentWeight(fragment: PromptFragment, genre: GenreFilter): number {
  const boosted = genre !== ANY && fragment.genres.includes(genre);
  return boosted ? fragment.weight * GENRE_MATCH_BOOST : fragment.weight;
}

function drawDistinct(
  rng: Rng,
  pool: readonly PromptFragment[],
  count: number,
  genre: GenreFilter,
): PromptFragment[] {
  const picked: PromptFragment[] = [];
  let remaining = [...pool];
  while (picked.length < count && remaining.length > 0) {
    const choice = pickWeighted(
      rng,
      remaining.map((fragment) => ({ value: fragment, weight: fragmentWeight(fragment, genre) })),
    );
    picked.push(choice);
    remaining = remaining.filter((fragment) => fragment.id !== choice.id);
  }
  return picked;
}

const GENRE_PHRASES: Record<GenreFilter, string> = {
  any: "an adult romance",
  romance: "a romance",
  "dark-romance": "a dark romance",
  fantasy: "a fantasy romance",
  contemporary: "a contemporary romance",
  historical: "a historical romance",
};

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function texts(slots: readonly GeneratedSlot[], slot: PromptSlot): string[] {
  return (
    slots.find((entry) => entry.slot === slot)?.fragments.map(({ fragment }) => fragment.text) ?? []
  );
}

/** Joins the slot fragments into one copy-ready prompt. Missing slots are skipped. */
export function assemblePrompt(slots: readonly GeneratedSlot[], genre: GenreFilter): string {
  const lines = [`Write a scene for ${GENRE_PHRASES[genre]}.`];
  const add = (label: string, values: string[]) => {
    if (values.length > 0) lines.push(`${label}: ${capitalize(values.join("; "))}.`);
  };
  add("Characters", texts(slots, "pairing"));
  add("Situation", texts(slots, "setup"));
  add("Setting", texts(slots, "setting"));
  add("Tension", texts(slots, "tension"));
  add("Heat and tone", texts(slots, "tone"));
  lines.push("Every character is a fictional, consenting adult.");
  return lines.join(" ");
}

/**
 * Builds one prompt: per slot, locked fragments first, then weighted picks
 * from the filtered pool with no repeats. Each slot draws from its own seeded
 * stream, so locking or unlocking one slot never changes another.
 */
export function generatePrompt(
  options: PromptGeneratorOptions,
  catalog: PromptCatalog = PROMPT_CATALOG,
): GeneratedPrompt {
  const locked = resolveLocks(options.locked, options, catalog);
  const slots: GeneratedSlot[] = PROMPT_SLOTS.map((slot) => {
    const keep = locked.filter((fragment) => fragment.slot === slot);
    const pool = slotPool(slot, options, catalog).filter(
      (fragment) => !keep.some((entry) => entry.id === fragment.id),
    );
    const drawn = drawDistinct(
      createRng(rngKey(options, slot)),
      pool,
      SLOT_SIZES[slot] - keep.length,
      options.genre,
    );
    return {
      slot,
      fragments: [
        ...keep.map((fragment) => ({ fragment, locked: true })),
        ...drawn.map((fragment) => ({ fragment, locked: false })),
      ],
    };
  });
  return { slots, text: assemblePrompt(slots, options.genre) };
}
