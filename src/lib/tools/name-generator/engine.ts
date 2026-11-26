/**
 * Deterministic character name engine (STO-1311). No network, no LLM: names
 * are weighted picks from bundled lists plus syllable/compound construction,
 * driven by a seeded RNG so the same seed + filters give the same batch.
 */
import { createRng, pickRanked, pickWeighted, type Rng } from "./rng";
import {
  ANY_FLAVOR,
  type ConcreteGender,
  type Flavor,
  type GenderPresentation,
  type GeneratedName,
  type Genre,
  type GenreDefinition,
  type NameGeneratorOptions,
  type SyllableSet,
} from "./types";
import { GENRE_DEFINITIONS } from "./wordlists";

export const MIN_COUNT = 1;
export const MAX_COUNT = 30;
export const DEFAULT_COUNT = 12;
/** Attempts per requested name before giving up on finding more unique ones. */
const ATTEMPTS_PER_NAME = 25;
const MAX_SYLLABLE_NAME_LENGTH = 12;

const ANY_GENDER_WEIGHTS: readonly { value: ConcreteGender; weight: number }[] = [
  { value: "feminine", weight: 2 },
  { value: "masculine", weight: 2 },
  { value: "neutral", weight: 1 },
];

const SYLLABLE_COUNT_WEIGHTS = [
  { value: 0, weight: 5 },
  { value: 1, weight: 4 },
  { value: 2, weight: 1 },
] as const;

export function getGenreDefinition(genre: Genre): GenreDefinition {
  const definition = GENRE_DEFINITIONS.find((entry) => entry.id === genre);
  /* v8 ignore next -- Genre is a closed union and every member has a definition. */
  if (!definition) throw new Error(`Unknown genre: ${genre}`);
  return definition;
}

/** Whether `flavor` is `any` or one of the genre's flavor ids. */
export function isFlavorForGenre(genre: Genre, flavor: string): boolean {
  return (
    flavor === ANY_FLAVOR || getGenreDefinition(genre).flavors.some((entry) => entry.id === flavor)
  );
}

function resolveGender(rng: Rng, gender: GenderPresentation): ConcreteGender {
  return gender === "any" ? pickWeighted(rng, ANY_GENDER_WEIGHTS) : gender;
}

function resolveFlavor(rng: Rng, definition: GenreDefinition, flavor: string): Flavor {
  const match = definition.flavors.find((entry) => entry.id === flavor);
  return match ?? pickRanked(rng, definition.flavors);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Collapses runs of three or more identical letters to two ("Aaa" → "Aa"). */
function tidy(value: string): string {
  return value.replace(/(\p{L})\1{2,}/giu, "$1$1");
}

const LINKING_VOWELS = ["a", "e", "i", "o", "u"] as const;
const isVowel = (char: string | undefined): boolean =>
  char !== undefined && /[aeiouy']/i.test(char);

/**
 * Joins two syllables so the result stays pronounceable: a linking vowel goes
 * between a vowelless head ("Thr") or a consonant meeting a consonant cluster,
 * and a repeated boundary vowel ("ae" + "elle") is written once.
 */
export function joinSyllables(rng: Rng, head: string, tail: string): string {
  if (!tail) return head;
  const last = head.at(-1);
  if (isVowel(last) && last?.toLowerCase() === tail[0].toLowerCase()) return head + tail.slice(1);
  const vowelless = !/[aeiouy']/i.test(head);
  const clusterAhead = !isVowel(tail[0]) && !isVowel(tail[1]);
  if (!isVowel(last) && !isVowel(tail[0]) && (vowelless || clusterAhead)) {
    return head + pickRanked(rng, LINKING_VOWELS) + tail;
  }
  return head + tail;
}

export function buildSyllableName(
  rng: Rng,
  syllables: SyllableSet,
  gender: ConcreteGender,
): string {
  const middleCount = pickWeighted(rng, SYLLABLE_COUNT_WEIGHTS);
  let name = pickRanked(rng, syllables.onsets);
  for (let i = 0; i < middleCount; i += 1) {
    name = joinSyllables(rng, name, pickRanked(rng, syllables.middles));
  }
  name = joinSyllables(rng, name, pickRanked(rng, syllables.endings[gender]));
  name = tidy(name);
  if (name.length > MAX_SYLLABLE_NAME_LENGTH) name = name.slice(0, MAX_SYLLABLE_NAME_LENGTH);
  return capitalize(name.toLowerCase());
}

function buildFirstName(rng: Rng, flavor: Flavor, gender: ConcreteGender): string {
  if (flavor.syllables && rng() < (flavor.syllableShare ?? 0)) {
    return buildSyllableName(rng, flavor.syllables, gender);
  }
  return pickRanked(rng, flavor.firstNames[gender]);
}

function buildLastName(rng: Rng, flavor: Flavor): string {
  const parts = flavor.compoundSurnames;
  if (parts && rng() < (flavor.compoundShare ?? 0)) {
    return tidy(pickRanked(rng, parts.heads) + pickRanked(rng, parts.tails));
  }
  return pickRanked(rng, flavor.surnames);
}

export function clampCount(count: number): number {
  if (!Number.isFinite(count)) return DEFAULT_COUNT;
  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.trunc(count)));
}

/** Seed string mixed with every filter, so each filter set has its own stream. */
export function rngKey(options: NameGeneratorOptions): string {
  return [options.seed, options.genre, options.gender, options.flavor, options.type].join("|");
}

/**
 * Generates up to `count` unique names. The result is a pure function of the
 * options: same seed + filters ⇒ same names in the same order.
 */
export function generateNames(options: NameGeneratorOptions): GeneratedName[] {
  const definition = getGenreDefinition(options.genre);
  const rng = createRng(rngKey(options));
  const count = clampCount(options.count);
  const seen = new Set<string>();
  const names: GeneratedName[] = [];

  for (let attempt = 0; attempt < count * ATTEMPTS_PER_NAME && names.length < count; attempt += 1) {
    const flavor = resolveFlavor(rng, definition, options.flavor);
    const gender = resolveGender(rng, options.gender);
    const first = options.type === "last" ? null : buildFirstName(rng, flavor, gender);
    const last = options.type === "first" ? null : buildLastName(rng, flavor);
    const name = [first, last].filter(Boolean).join(" ");
    const key = name.toLocaleLowerCase("en");
    if (seen.has(key)) continue;
    seen.add(key);
    names.push({ name, first, last, gender, flavor: flavor.id });
  }

  return names;
}
