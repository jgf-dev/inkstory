/** Filter value meaning "no filter". */
export const ANY = "any";

export const PROMPT_SLOTS = ["setup", "pairing", "setting", "tension", "tone"] as const;
export type PromptSlot = (typeof PROMPT_SLOTS)[number];

/** How many fragments each slot contributes to one prompt. */
export const SLOT_SIZES: Record<PromptSlot, number> = {
  setup: 1,
  pairing: 1,
  setting: 1,
  tension: 2,
  tone: 1,
};

export const PAIRINGS = ["mf", "mm", "ff"] as const;
export type Pairing = (typeof PAIRINGS)[number];

/** Tool-page filter only; not a manuscript setting. */
export const HEAT_LEVELS = ["sweet", "steamy", "spicy"] as const;
export type HeatLevel = (typeof HEAT_LEVELS)[number];

export const PROMPT_GENRES = [
  "romance",
  "dark-romance",
  "fantasy",
  "contemporary",
  "historical",
] as const;
export type PromptGenre = (typeof PROMPT_GENRES)[number];

export const PROMPT_TROPES = [
  "enemies-to-lovers",
  "friends-to-lovers",
  "fake-relationship",
  "forced-proximity",
  "second-chance",
  "forbidden-love",
  "grumpy-sunshine",
  "rivals",
  "secret-identity",
  "marriage-of-convenience",
  "slow-burn",
] as const;
export type PromptTrope = (typeof PROMPT_TROPES)[number];

export type PairingFilter = Pairing | typeof ANY;
export type HeatFilter = HeatLevel | typeof ANY;
export type GenreFilter = PromptGenre | typeof ANY;
export type TropeFilter = PromptTrope | typeof ANY;

export interface PromptFragment {
  /** Unique across the whole catalog. */
  id: string;
  slot: PromptSlot;
  /** Original text written for this catalog; adults only, no explicit content. */
  text: string;
  /** Pairings this fragment fits; empty means any. Pairing fragments name exactly one. */
  pairings: readonly Pairing[];
  /** Heat levels this fragment fits; empty means any. */
  heats: readonly HeatLevel[];
  /** Genres this fragment fits; empty means any. */
  genres: readonly PromptGenre[];
  /** Trope tags (used by the trope filter on the setup slot). */
  tropes: readonly PromptTrope[];
  /** Relative pick weight. */
  weight: number;
}

export interface PromptCatalog {
  fragments: readonly PromptFragment[];
}

export interface PromptFilters {
  pairing: PairingFilter;
  heat: HeatFilter;
  genre: GenreFilter;
  trope: TropeFilter;
}

export interface PromptGeneratorOptions extends PromptFilters {
  seed: string;
  /** Fragment ids the user locked; each keeps its slot across rerolls. */
  locked: readonly string[];
}

export interface GeneratedFragment {
  fragment: PromptFragment;
  locked: boolean;
}

export interface GeneratedSlot {
  slot: PromptSlot;
  fragments: GeneratedFragment[];
}

export interface GeneratedPrompt {
  slots: GeneratedSlot[];
  /** The assembled prompt, ready to copy. */
  text: string;
}
