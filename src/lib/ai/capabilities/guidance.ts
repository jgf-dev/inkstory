/**
 * Avoidance / anti-trope guidance (STO-1265). Instruction-only: appended as a
 * delimited block of ordinary prompt text, identically for Preview and
 * Generate. It is applied after template rendering, so author text is never
 * interpreted as template macros, and `<`/`>`/`&` are escaped so the text
 * cannot close the delimiter. Advisory — "included", never "enforced".
 */

export const MAX_AVOIDANCE_GUIDANCE_CHARS = 4000;

export const AVOIDANCE_GUIDANCE_OPEN = "<avoidance_guidance>";
export const AVOIDANCE_GUIDANCE_CLOSE = "</avoidance_guidance>";

const PREAMBLE =
  "The author asked you to avoid the following where possible. Treat these as style preferences, not hard rules:";

export function escapeGuidanceText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderAvoidanceGuidanceBlock(guidance: string): string {
  return `${AVOIDANCE_GUIDANCE_OPEN}\n${PREAMBLE}\n${escapeGuidanceText(guidance)}\n${AVOIDANCE_GUIDANCE_CLOSE}`;
}

export interface GuidanceMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Returns a new message list with the guidance block appended to the last
 * system message (or a new leading system message when there is none).
 * Returns an equal copy when no guidance is given.
 */
export function applyAvoidanceGuidance<M extends GuidanceMessage>(
  messages: M[],
  guidance: string | undefined,
): M[] {
  const copy = messages.map((m) => ({ ...m }));
  if (!guidance) return copy;
  const block = renderAvoidanceGuidanceBlock(guidance);
  let idx = -1;
  for (let i = copy.length - 1; i >= 0; i--) {
    if (copy[i].role === "system") {
      idx = i;
      break;
    }
  }
  if (idx >= 0) {
    const existing = copy[idx].content;
    copy[idx] = { ...copy[idx], content: existing ? `${existing}\n\n${block}` : block };
    return copy;
  }
  return [{ role: "system", content: block } as M, ...copy];
}

/** Debug string in the same `--- role ---` format as the prompt renderer. */
export function joinPromptMessages(messages: GuidanceMessage[]): string {
  return messages.map((m) => `--- ${m.role} ---\n${m.content}`).join("\n\n");
}
