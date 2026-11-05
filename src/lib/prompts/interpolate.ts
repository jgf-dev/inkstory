import {
  VARIABLE_PATTERN,
  isPromptVariableToken,
  type PromptBindings,
  type PromptVariableToken,
} from "./catalog";

export interface InterpolateResult {
  text: string;
  /** Catalog tokens left as `{{…}}` because the binding was missing (undefined/null). */
  unresolved: PromptVariableToken[];
  /** Non-catalog tokens left in place. */
  unknownTokens: string[];
}

/**
 * Pure string interpolation against the closed variable catalog.
 * - Known token with a defined binding (including "") → substituted.
 * - Known token with undefined/null binding or absent key → left as `{{token}}`.
 * - Unknown token → left as `{{token}}`, listed in unknownTokens.
 */
export function interpolate(
  template: string,
  bindings: Partial<PromptBindings> = {},
): InterpolateResult {
  const unresolved = new Set<PromptVariableToken>();
  const unknownTokens = new Set<string>();

  const text = template.replace(VARIABLE_PATTERN, (_match, raw: string) => {
    if (!isPromptVariableToken(raw)) {
      unknownTokens.add(raw);
      return `{{${raw}}}`;
    }
    if (!Object.prototype.hasOwnProperty.call(bindings, raw)) {
      unresolved.add(raw);
      return `{{${raw}}}`;
    }
    const value = bindings[raw];
    if (value === undefined || value === null) {
      unresolved.add(raw);
      return `{{${raw}}}`;
    }
    return value;
  });

  return {
    text,
    unresolved: [...unresolved],
    unknownTokens: [...unknownTokens],
  };
}

/**
 * Removes empty optional blocks that SYSTEM_DEFAULT templates leave behind
 * when beat/summary/prose vars are blank — keeps Preview/Generate aligned
 * with the historical buildSceneMessages conditionals.
 */
export function tidyInterpolatedText(text: string): string {
  return text
    .replace(/Beat to realize:\n"""\n\s*"""\n?/g, "")
    .replace(/Scene summary:\n"""\n\s*"""\n?/g, "")
    .replace(/Existing scene prose:\n"""\n\s*"""\n?/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trimEnd();
}
