/**
 * Curated prompt-fragment catalog for the public adult writing prompt
 * generator (STO-1315).
 *
 * The data lives in `catalog.json`. Every fragment was written for this repo.
 * Content rules, enforced by tests over the whole catalog: fictional adults
 * only (pairing fragments state both characters' adult ages), no minors or
 * age-ambiguous framing, no non-consent themes, kink-neutral labels and no
 * explicit text. Tests also check ids are unique and tags are valid, which is
 * why the JSON can be cast to the catalog type.
 */
import data from "./catalog.json" with { type: "json" };
import type { PromptCatalog } from "./types";

export const PROMPT_CATALOG: PromptCatalog = data as unknown as PromptCatalog;
