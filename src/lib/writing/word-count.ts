/**
 * Word counting for the scene editor. The server recomputes this on every
 * content save so `scenes.word_count` stays authoritative; the client uses the
 * same function for a live counter that matches exactly.
 */
export function countWords(text: string): number {
  if (typeof text !== "string") {
    return 0;
  }
  const matches = text.match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * Formatting helper for the editor status bar: `0`, `1,234` words, and the
 * singular/plural form.
 */
export function formatWordCount(count: number): string {
  const safe = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const formatted = safe.toLocaleString("en-US");
  return `${formatted} ${safe === 1 ? "word" : "words"}`;
}
