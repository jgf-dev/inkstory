import type { GenreFilter, Trope } from "@/lib/tools/story-tropes/types";

/** Validated request: catalog tropes from the current combo plus the genre filter. */
export interface PremiseInput {
  tropes: readonly Trope[];
  genre: GenreFilter;
}

/** A combo trope as returned to the client: catalog name and description only. */
export interface ComboTrope {
  id: string;
  name: string;
  description: string;
}

/** `ai` when the model wrote a valid blurb, otherwise `combo` (algorithmic fallback). */
export type PremiseSource = "ai" | "combo";

export interface PremiseResult {
  source: PremiseSource;
  /** AI premise blurb; `null` when falling back to the combo. */
  premise: string | null;
  tropes: readonly ComboTrope[];
}
