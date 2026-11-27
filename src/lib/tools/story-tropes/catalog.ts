/**
 * Curated trope catalog for the public story trope generator (STO-1312).
 *
 * The data lives in `catalog.json`. Names are common genre vocabulary and
 * every description was written for this repo in plain words (nothing is
 * copied from trope wikis). `exclusions` lists pairs that contradict each
 * other (clashing settings, tones or romance setups) and are never combined.
 * Tests check ids are unique, tags are valid and every exclusion points at a
 * real trope, which is why the JSON can be cast to the catalog type.
 */
import data from "./catalog.json" with { type: "json" };
import type { TropeCatalog } from "./types";

export const TROPE_CATALOG: TropeCatalog = data as unknown as TropeCatalog;
