export const TROPE_GENRES = [
  "fantasy",
  "sci-fi",
  "romance",
  "mystery",
  "thriller",
  "horror",
  "contemporary",
  "historical",
] as const;
export type TropeGenre = (typeof TROPE_GENRES)[number];

export const TROPE_CATEGORIES = ["romance", "plot", "character", "setting", "tone"] as const;
export type TropeCategory = (typeof TROPE_CATEGORIES)[number];

/** Filter value meaning "no filter" for genre or category. */
export const ANY = "any";
export type GenreFilter = TropeGenre | typeof ANY;
export type CategoryFilter = TropeCategory | typeof ANY;

export interface Trope {
  id: string;
  name: string;
  /** Short original description written for this catalog. */
  description: string;
  category: TropeCategory;
  /** Genres the trope suits; an empty list means it fits any genre. */
  genres: readonly TropeGenre[];
  /** Relative pick weight; common tropes weigh more. */
  weight: number;
}

export interface TropeCatalog {
  tropes: readonly Trope[];
  /** Pairs of trope ids that must never appear in the same combo. */
  exclusions: readonly (readonly [string, string])[];
}

export interface TropeFilters {
  genre: GenreFilter;
  category: CategoryFilter;
  count: number;
}

export interface TropeGeneratorOptions extends TropeFilters {
  seed: string;
  /** Trope ids the user locked; kept in the combo across rerolls. */
  locked: readonly string[];
}

export interface GeneratedTrope {
  trope: Trope;
  locked: boolean;
}
