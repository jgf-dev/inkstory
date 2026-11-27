/**
 * Validation for backstory requests. Anything outside the generator's own
 * vocabulary is rejected or normalized so arbitrary text never reaches the
 * prompt beyond a short, letters-only name.
 */
import { isFlavorForGenre } from "../name-generator/engine";
import { ANY_FLAVOR, GENRES, type ConcreteGender, type Genre } from "../name-generator/types";
import type { BackstoryInput } from "./types";

export const BACKSTORY_NAME_MAX_LENGTH = 60;
/** Upper bound for the JSON request body, in bytes. */
export const BACKSTORY_BODY_MAX_LENGTH = 1024;

const CONCRETE_GENDERS: readonly ConcreteGender[] = ["feminine", "masculine", "neutral"];
/** Letters (any script) plus spaces, apostrophes, hyphens and periods. */
const NAME_CHARS = /^\p{L}[\p{L}\p{M} '’.-]*$/u;
/** Two separators in a row (e.g. "--" or "' "), except an initial's ". ". */
const REPEATED_SEPARATOR = /[ '’-][ '’.-]|\.[.'’-]/;

/** Linear-time check that `name` looks like a generated character name. */
export function isPlausibleName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= BACKSTORY_NAME_MAX_LENGTH &&
    NAME_CHARS.test(name) &&
    !REPEATED_SEPARATOR.test(name)
  );
}

export type ParsedBackstoryInput =
  | { ok: true; input: BackstoryInput }
  | { ok: false; error: string };

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseBackstoryInput(body: unknown): ParsedBackstoryInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Expected a JSON object." };
  }
  const record = body as Record<string, unknown>;
  const name = asTrimmedString(record.name).replace(/\s+/g, " ");
  if (!isPlausibleName(name)) {
    return { ok: false, error: "Provide a generated character name." };
  }

  const genreValue = asTrimmedString(record.genre).toLowerCase();
  const genre: Genre = (GENRES as readonly string[]).includes(genreValue)
    ? (genreValue as Genre)
    : "fantasy";
  const flavorValue = asTrimmedString(record.flavor).toLowerCase();
  const flavor = flavorValue && isFlavorForGenre(genre, flavorValue) ? flavorValue : ANY_FLAVOR;
  const genderValue = asTrimmedString(record.gender).toLowerCase();
  const gender = (CONCRETE_GENDERS as readonly string[]).includes(genderValue)
    ? (genderValue as ConcreteGender)
    : "neutral";

  return { ok: true, input: { name, genre, flavor, gender } };
}
