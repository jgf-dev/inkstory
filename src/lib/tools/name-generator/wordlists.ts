/**
 * Curated wordlists for the public character name generator (STO-1311).
 *
 * The data lives in `wordlists.json` and was written for this repo: invented
 * names and syllables are original, and the modern/historical lists are
 * generic, widely used given names and surnames chosen by hand — not copied
 * from any name database. Earlier entries in a list are picked slightly more
 * often (see `pickRanked`). Tests check the shape and that lists are non-empty
 * and duplicate-free.
 */
import data from "./wordlists.json" with { type: "json" };
import type { GenreDefinition } from "./types";

export const GENRE_DEFINITIONS: readonly GenreDefinition[] = data as readonly GenreDefinition[];
