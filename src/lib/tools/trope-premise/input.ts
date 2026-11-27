/**
 * Validation for premise requests. Only catalog trope ids and a known genre
 * are accepted, so nothing a visitor types ever reaches the prompt: the model
 * only sees catalog names and descriptions.
 */
import { MAX_COUNT, findTrope } from "@/lib/tools/story-tropes/engine";
import { ANY, TROPE_GENRES, type GenreFilter, type Trope } from "@/lib/tools/story-tropes/types";
import type { ComboTrope, PremiseInput } from "./types";

/** Upper bound for the JSON request body, in bytes. */
export const PREMISE_BODY_MAX_LENGTH = 1024;

export type ParsedPremiseInput = { ok: true; input: PremiseInput } | { ok: false; error: string };

function parseGenre(value: unknown): GenreFilter {
  const genre = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (TROPE_GENRES as readonly string[]).includes(genre) ? (genre as GenreFilter) : ANY;
}

export function parsePremiseInput(body: unknown): ParsedPremiseInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Expected a JSON object." };
  }
  const record = body as Record<string, unknown>;
  const ids = record.tropes;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_COUNT) {
    return { ok: false, error: `Provide between 1 and ${MAX_COUNT} trope ids.` };
  }
  const tropes: Trope[] = [];
  for (const id of ids) {
    const trope = typeof id === "string" ? findTrope(id.trim()) : undefined;
    if (!trope) return { ok: false, error: "Provide trope ids from the generator." };
    if (!tropes.includes(trope)) tropes.push(trope);
  }
  return { ok: true, input: { tropes, genre: parseGenre(record.genre) } };
}

/** The algorithmic combo: catalog names and short descriptions only. */
export function comboTropes(input: PremiseInput): ComboTrope[] {
  return input.tropes.map(({ id, name, description }) => ({ id, name, description }));
}
