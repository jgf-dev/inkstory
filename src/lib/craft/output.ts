/**
 * Craft output shaping (STO-1270). Turns raw model text into the structured
 * result declared by the tool's `output.mode`:
 *
 * - `prose` (and anything else) → `{ kind: "prose", text }`, unchanged.
 * - `diagnosis_and_prose` → `{ kind: "diagnosis_and_prose", diagnosis, text }`,
 *   parsed from the `DIAGNOSIS:` / `REWRITE:` sections the prompt asks for.
 *
 * Providers do not uniformly support JSON schemas, so this is a bounded text
 * parse, not adapter-native structured output. When the sections are missing,
 * duplicated, out of order or empty, parsing fails with a recoverable
 * `AI_INVALID_RESPONSE` (502): the raw text is never returned as applyable
 * prose, so a diagnosis can never be inserted into the manuscript. No repair
 * call is made.
 *
 * Boundary hardening (STO-1298):
 * - Section markers are matched strictly first (upper-case `DIAGNOSIS:` /
 *   `REWRITE:`, as the prompt asks), falling back to case-insensitive matching
 *   only when the strict pass does not find exactly one of each. A wrapped
 *   diagnosis line starting `Rewrite:` or prose starting `Diagnosis:` then no
 *   longer collides with the real headers.
 * - Trailing assistant commentary after the rewrite ("Let me know if…") is
 *   dropped when it forms the final paragraph(s), so it is never applied.
 * - Error messages are generic unless a tool name is supplied.
 */

import { AiError } from "@/lib/ai/generate";
import type { ContractOutput } from "@/lib/prompts/contracts";
import { DIAGNOSIS_MARKER, REWRITE_MARKER } from "./tools";

export type CraftResult =
  | { kind: "prose"; text: string }
  | { kind: "diagnosis_and_prose"; diagnosis: string; text: string };

/** Extra words of completion budget reserved for the diagnosis section. */
export const DIAGNOSIS_WORD_ALLOWANCE = 120;

/** Upper bound on raw output we attempt to parse (characters). */
export const MAX_CRAFT_OUTPUT_CHARS = 60_000;

function markerPattern(marker: string, strict: boolean): RegExp {
  const word = marker.replace(/:$/, "");
  // Line-start marker, tolerating markdown emphasis/headings: "**DIAGNOSIS:**", "## Rewrite:".
  // Strict mode only accepts the upper-case word the prompt asks for.
  return new RegExp(
    `^[ \\t]*(?:#{1,6}[ \\t]*)?(?:\\*\\*|__)?${word}(?:\\*\\*|__)?[ \\t]*:(?:\\*\\*|__)?`,
    strict ? "gm" : "gim",
  );
}

/**
 * Finds exactly one diagnosis and one rewrite marker: strict (upper-case)
 * first, then case-insensitive. Returns null when neither pass is unambiguous.
 */
function findMarkers(raw: string): [RegExpExecArray, RegExpExecArray] | null {
  for (const strict of [true, false]) {
    const diagnosisHits = [...raw.matchAll(markerPattern(DIAGNOSIS_MARKER, strict))];
    const rewriteHits = [...raw.matchAll(markerPattern(REWRITE_MARKER, strict))];
    if (diagnosisHits.length === 1 && rewriteHits.length === 1) {
      return [diagnosisHits[0], rewriteHits[0]];
    }
  }
  return null;
}

/**
 * Openers that only an assistant addressing the author would use (optionally
 * wrapped in markdown emphasis, e.g. "**Note:**"). Kept narrow
 * on purpose: first-person fiction ("I hope she never comes back.") must
 * never be stripped from the applyable rewrite.
 */
const COMMENTARY_OPENER =
  /^[*_]{0,2}(?:\(?\s*[*_]{0,2}(?:note|notes|changes(?: made)?|what changed)[*_]{0,2}\s*:|let me know\b|feel free to\b|hope (?:this|that) helps\b|i hope (?:this|that) (?:helps|works|captures)\b|would you like me to\b|if you(?:['’]d| would) like(?:,| me to\b| to\b)|happy to (?:adjust|revise|tweak|help)\b)/i;
const SEPARATOR_LINE = /^(?:-{3,}|\*{3,}|_{3,})$/;
const FENCE_LINE = /^```[^\n]*$/;

/**
 * Drops trailing paragraphs that are assistant commentary (and any separator
 * rule or closing fence left before them). Only whole final paragraphs are
 * removed, and never the first one, so the rewrite itself is kept intact.
 */
export function stripTrailingCommentary(section: string): string {
  const paragraphs = section.trim().split(/\n[ \t]*\n/);
  let removed = false;
  while (paragraphs.length > 1) {
    const last = paragraphs[paragraphs.length - 1].trim();
    if (COMMENTARY_OPENER.test(last)) {
      removed = true;
    } else if (!(removed && (SEPARATOR_LINE.test(last) || FENCE_LINE.test(last)))) {
      break;
    }
    paragraphs.pop();
  }
  // A separator glued to the end of the prose paragraph ("Shown.\n---").
  const text = paragraphs.join("\n\n");
  return removed ? text.replace(/\n[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/, "") : text;
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

function malformed(reason: string, toolName?: string): AiError {
  // Generic by default: this parser serves every diagnosis_and_prose tool.
  const subject = toolName ? `The ${toolName} result` : "The craft result";
  return new AiError(
    `${subject} was not in the expected format (${reason}). Nothing was applied; try again.`,
    "AI_INVALID_RESPONSE",
    502,
  );
}

export function parseDiagnosisAndProse(
  raw: string,
  toolName?: string,
): { diagnosis: string; text: string } {
  if (raw.length > MAX_CRAFT_OUTPUT_CHARS) throw malformed("output too long", toolName);
  const markers = findMarkers(raw);
  if (!markers) throw malformed("expected one diagnosis and one rewrite section", toolName);
  const [d, r] = markers;
  if (d.index > r.index) throw malformed("diagnosis must come before the rewrite", toolName);
  const diagnosis = unwrap(raw.slice(d.index + d[0].length, r.index));
  // Unwrap first so commentary inside a wrapping fence is stripped without
  // orphaning the opening fence; unwrap again for a fence closed before it.
  const text = unwrap(stripTrailingCommentary(unwrap(raw.slice(r.index + r[0].length))));
  if (!diagnosis) throw malformed("empty diagnosis", toolName);
  if (!text) throw malformed("empty rewrite", toolName);
  return { diagnosis, text };
}

/** Shapes raw model text per the tool's declared output mode. */
export function shapeCraftResult(output: ContractOutput | null, raw: string): CraftResult {
  if (output?.mode === "diagnosis_and_prose") {
    return { kind: "diagnosis_and_prose", ...parseDiagnosisAndProse(raw) };
  }
  return { kind: "prose", text: raw };
}
