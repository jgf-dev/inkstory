export const GENRES = ["fantasy", "sci-fi", "modern", "historical"] as const;
export type Genre = (typeof GENRES)[number];

export const GENDERS = ["any", "feminine", "masculine", "neutral"] as const;
export type GenderPresentation = (typeof GENDERS)[number];
/** A concrete presentation; `any` resolves to one of these per name. */
export type ConcreteGender = Exclude<GenderPresentation, "any">;

export const NAME_TYPES = ["full", "first", "last"] as const;
export type NameType = (typeof NAME_TYPES)[number];

/** Flavor id, or `any` to mix every flavor of the chosen genre. */
export type FlavorId = string;
export const ANY_FLAVOR = "any";

export interface SyllableSet {
  onsets: readonly string[];
  middles: readonly string[];
  endings: Readonly<Record<ConcreteGender, readonly string[]>>;
}

export interface CompoundSurnameParts {
  heads: readonly string[];
  tails: readonly string[];
}

export interface Flavor {
  id: FlavorId;
  label: string;
  firstNames: Readonly<Record<ConcreteGender, readonly string[]>>;
  surnames: readonly string[];
  /** When present, given names are sometimes built from syllables. */
  syllables?: SyllableSet;
  /** Share of given names built from syllables (0–1). */
  syllableShare?: number;
  /** When present, surnames are sometimes built as two-part compounds. */
  compoundSurnames?: CompoundSurnameParts;
  /** Share of surnames built as compounds (0–1). */
  compoundShare?: number;
}

export interface GenreDefinition {
  id: Genre;
  label: string;
  flavors: readonly Flavor[];
}

export interface NameGeneratorFilters {
  genre: Genre;
  gender: GenderPresentation;
  flavor: FlavorId;
  type: NameType;
  count: number;
}

export interface NameGeneratorOptions extends NameGeneratorFilters {
  seed: string;
}

export interface GeneratedName {
  name: string;
  first: string | null;
  last: string | null;
  gender: ConcreteGender;
  flavor: FlavorId;
}
