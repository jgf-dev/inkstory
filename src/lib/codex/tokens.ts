/**
 * Approximate token counting shared by the token budgeter and prompt
 * formatter (STO-1172).
 *
 * Real tokenizers are model-specific, so the budget uses a deterministic,
 * model-agnostic approximation:
 * - CJK characters (hiragana/katakana, CJK ideographs, and compat ideographs)
 *   count as ~1 token each because they do not compress 4:1 in BPE vocabularies.
 * - Every other character pools into groups of `CHARS_PER_TOKEN`.
 *
 * `estimateTokens` is subadditive under concatenation
 * (`estimateTokens(a + b) <= estimateTokens(a) + estimateTokens(b)`), which the
 * token budgeter relies on to bound the fully formatted prompt.
 */

const CHARS_PER_TOKEN = 4;

const CJK_PATTERN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;

export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }

  const cjkCount = text.match(CJK_PATTERN)?.length ?? 0;
  const otherCount = text.length - cjkCount;
  return cjkCount + Math.ceil(otherCount / CHARS_PER_TOKEN);
}
