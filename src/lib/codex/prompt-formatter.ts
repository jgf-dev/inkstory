/**
 * Prompt formatter (STO-1172): renders an `AssembledContext` as an XML prompt
 * block (`<codex_context>`) optimized for Claude 3.5 Sonnet / GPT-4o class
 * models.
 *
 * The output is deterministic for a given context. Every entity block is
 * terminated by a newline so the token budgeter can account for each entry
 * independently: `estimateTokens(prompt)` never exceeds
 * `estimateWrapperTokens() + sum(estimateFormattedEntryTokens(entry))`
 * because `estimateTokens` is subadditive under concatenation.
 */

import type { AssembledContext, AssembledContextEntry } from "./context-assembler";
import { estimateTokens } from "./tokens";

const CONTEXT_NOTE =
  "The following story bible is canonical reference for the current scene. " +
  "Honor entry names, aliases, descriptions, and relationships exactly as written.";

const HEADER = `<codex_context>\n${CONTEXT_NOTE}\n<story_bible>\n`;
const FOOTER = "</story_bible>\n</codex_context>";

/** XML-escapes a value embedded in element text or an attribute. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Serializes one assembled entry as an `<entity>` block terminated by a
 * newline. Attributes render in a fixed order (id, type, name, source,
 * tracking, depth) for deterministic output.
 */
function serializeEntry(entry: AssembledContextEntry): string {
  const attrs = [
    `id="${escapeXml(entry.id)}"`,
    `type="${escapeXml(entry.type)}"`,
    `name="${escapeXml(entry.name)}"`,
    `source="${escapeXml(entry.source)}"`,
    `tracking="${escapeXml(entry.trackingMode)}"`,
  ];
  if (entry.relationDepth !== undefined) {
    attrs.push(`depth="${entry.relationDepth}"`);
  }

  let block = `<entity ${attrs.join(" ")}>\n`;
  if (entry.aliases.length > 0) {
    block += `<aliases>${escapeXml(entry.aliases.join(", "))}</aliases>\n`;
  }
  if (entry.description.length > 0) {
    block += `<description>${escapeXml(entry.description)}</description>\n`;
  }
  return `${block}</entity>\n`;
}

/**
 * Formats an assembled context as the `<codex_context>` XML prompt block.
 * Entries render in their ranked order (highest priority first).
 */
export function formatAssembledContext(context: AssembledContext): string {
  const blocks = context.entries.map(serializeEntry).join("");
  return `${HEADER}${blocks}${FOOTER}`;
}

/** Estimated token cost of the fixed header/footer around the entity blocks. */
export function estimateWrapperTokens(): number {
  return estimateTokens(HEADER) + estimateTokens(FOOTER);
}

/**
 * Estimated token cost of one entry block as the formatter will emit it,
 * including its terminating newline.
 */
export function estimateFormattedEntryTokens(entry: AssembledContextEntry): number {
  return estimateTokens(serializeEntry(entry));
}

/** Estimated token cost of the fully formatted prompt for a context. */
export function estimateFormattedContextTokens(context: AssembledContext): number {
  return estimateTokens(formatAssembledContext(context));
}
