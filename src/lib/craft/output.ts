/**
 * Craft output shaping (STO-1270). Turns raw model text into the structured
 * result declared by the tool's `output.mode`:
 *
 * - `prose` (and anything else) → `{ kind: "prose", text }`, unchanged.
 * - `diagnosis_and_prose` → `{ kind: "diagnosis_and_prose", diagnosis, text }`,
 *   parsed from the `DIAGNOSIS:` / `REWRITE:` sections the prompt asks for.
 * - `options` (STO-1272 Brainstorm) → `{ kind: "options", options, text }`,
 *   parsed from the numbered list the prompt asks for. `text` is the list for
 *   copying; the UI inserts only an option the author explicitly picks.
 *
 * Providers do not uniformly support JSON schemas, so this is a bounded text
 * parse, not adapter-native structured output. When the sections are missing,
 * duplicated, out of order or empty, parsing fails with a recoverable
 * `AI_INVALID_RESPONSE` (502): the raw text is never returned as applyable
 * prose, so a diagnosis can never be inserted into the manuscript. No repair
 * call is made.
 */

import { AiError } from "@/lib/ai/generate";
import type { ContractOutput } from "@/lib/prompts/contracts";
import { DIAGNOSIS_MARKER, REWRITE_MARKER } from "./tools";

export type CraftResult =
  | { kind: "prose"; text: string }
  | { kind: "diagnosis_and_prose"; diagnosis: string; text: string }
  | { kind: "options"; options: string[]; text: string };

/** Extra words of completion budget reserved for the diagnosis section. */
export const DIAGNOSIS_WORD_ALLOWANCE = 120;

/** Upper bound on raw output we attempt to parse (characters). */
export const MAX_CRAFT_OUTPUT_CHARS = 60_000;

function markerPattern(marker: string): RegExp {
  const word = marker.replace(/:$/, "");
  // Line-start marker, tolerating markdown emphasis/headings: "**DIAGNOSIS:**", "## Rewrite:".
  return new RegExp(
    `^[ \\t]*(?:#{1,6}[ \\t]*)?(?:\\*\\*|__)?${word}(?:\\*\\*|__)?[ \\t]*:(?:\\*\\*|__)?`,
    "gim",
  );
}

/** Strips a wrapping markdown fence or triple quotes the model may add. */
function unwrap(section: string): string {
  let text = section.trim();
  const fence = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(text);
  if (fence) {
    text = fence[1].trim();
  } else if ((text.match(/```/g) ?? []).length % 2 === 1) {
    // A whole-reply fence opens before the first marker, leaving only its
    // closing line here; drop that unmatched trailing fence so it is not applied.
    text = text.replace(/\n?[ \t]*```[ \t]*$/, "").trim();
  }
  if (text.startsWith('"""') && text.endsWith('"""') && text.length >= 6) {
    text = text.slice(3, -3).trim();
  }
  return text;
}

function malformed(reason: string, toolName = "Show Don't Tell"): AiError {
  return new AiError(
    `The ${toolName} result was not in the expected format (${reason}). Nothing was applied; try again.`,
    "AI_INVALID_RESPONSE",
    502,
  );
}

export function parseDiagnosisAndProse(raw: string): { diagnosis: string; text: string } {
  if (raw.length > MAX_CRAFT_OUTPUT_CHARS) throw malformed("output too long");
  const diagnosisHits = [...raw.matchAll(markerPattern(DIAGNOSIS_MARKER))];
  const rewriteHits = [...raw.matchAll(markerPattern(REWRITE_MARKER))];
  if (diagnosisHits.length !== 1 || rewriteHits.length !== 1) {
    throw malformed("expected one diagnosis and one rewrite section");
  }
  const d = diagnosisHits[0];
  const r = rewriteHits[0];
  if (d.index > r.index) throw malformed("diagnosis must come before the rewrite");
  const diagnosis = unwrap(raw.slice(d.index + d[0].length, r.index));
  const text = unwrap(raw.slice(r.index + r[0].length));
  if (!diagnosis) throw malformed("empty diagnosis");
  if (!text) throw malformed("empty rewrite");
  return { diagnosis, text };
}

const OPTION_LINE = /^[ \t]*(?:\*\*|__)?(\d{1,2})[.)](?:\*\*|__)?(?:[ \t]+(.*))?$/;

/**
 * Splits a numbered list into options. Lines before the first number (a stray
 * intro) are dropped; unnumbered lines continue the current option. Keeps at
 * most `maxOptions` when given. Fails (502) when no option is found.
 */
export function parseOptions(raw: string, maxOptions?: number): string[] {
  if (raw.length > MAX_CRAFT_OUTPUT_CHARS) throw malformed("output too long", "Brainstorm");
  const options: string[][] = [];
  for (const line of unwrap(raw).split("\n")) {
    const numbered = OPTION_LINE.exec(line);
    if (numbered) options.push([numbered[2] ?? ""]);
    else if (options.length) options[options.length - 1].push(line);
  }
  const cleaned = options.map((lines) => lines.join("\n").trim()).filter(Boolean);
  if (!cleaned.length) throw malformed("expected a numbered list of options", "Brainstorm");
  return maxOptions && maxOptions > 0 ? cleaned.slice(0, maxOptions) : cleaned;
}

/** Shapes raw model text per the tool's declared output mode. */
export function shapeCraftResult(
  output: ContractOutput | null,
  raw: string,
  maxOptions?: number,
): CraftResult {
  if (output?.mode === "diagnosis_and_prose") {
    return { kind: "diagnosis_and_prose", ...parseDiagnosisAndProse(raw) };
  }
  if (output?.mode === "options") {
    const options = parseOptions(raw, maxOptions);
    return {
      kind: "options",
      options,
      text: options.map((option, i) => `${i + 1}. ${option}`).join("\n"),
    };
  }
  return { kind: "prose", text: raw };
}
