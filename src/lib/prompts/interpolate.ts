import {
  VARIABLE_PATTERN,
  isPromptVariableToken,
  type PromptBindings,
  type PromptVariableToken,
} from "./catalog";
import { CRAFT_INPUT_KEYS, type CraftInputBindings, type CraftInputKey } from "./contracts";

export interface InterpolateOptions {
  /**
   * Validated craft input bindings (STO-1275, from resolveCraftInputs). When
   * omitted, `{{craft.*}}` tokens behave exactly as before (unknown tokens).
   */
  craftInputs?: CraftInputBindings;
}

function isCraftInputKey(value: string): value is CraftInputKey {
  return (CRAFT_INPUT_KEYS as readonly string[]).includes(value);
}

export interface InterpolateResult {
  text: string;
  /** Catalog tokens left as `{{…}}` because the binding was missing (undefined/null). */
  unresolved: PromptVariableToken[];
  /** Non-catalog tokens left in place. */
  unknownTokens: string[];
  /** Craft input tokens without a binding; present only when craftInputs were supplied. */
  unresolvedInputs?: CraftInputKey[];
}

/**
 * Pure string interpolation against the closed variable catalog.
 * - Known token with a defined binding (including "") → substituted.
 * - Known token with undefined/null binding or absent key → left as `{{token}}`.
 * - Unknown token → left as `{{token}}`, listed in unknownTokens.
 * - With `options.craftInputs`, registered `{{craft.*}}` tokens resolve from it.
 *
 * Single pass: substituted values are inserted literally and never re-scanned,
 * so supplied text containing `{{…}}` is not evaluated a second time.
 */
export function interpolate(
  template: string,
  bindings: Partial<PromptBindings> = {},
  options: InterpolateOptions = {},
): InterpolateResult {
  const unresolved = new Set<PromptVariableToken>();
  const unknownTokens = new Set<string>();
  const unresolvedInputs = new Set<CraftInputKey>();
  const craftInputs = options.craftInputs;

  const text = template.replace(VARIABLE_PATTERN, (_match, raw: string) => {
    if (craftInputs && isCraftInputKey(raw)) {
      const value = Object.prototype.hasOwnProperty.call(craftInputs, raw)
        ? craftInputs[raw]
        : undefined;
      if (value === undefined || value === null) {
        unresolvedInputs.add(raw);
        return `{{${raw}}}`;
      }
      return value;
    }
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

  const result: InterpolateResult = {
    text,
    unresolved: [...unresolved],
    unknownTokens: [...unknownTokens],
  };
  if (craftInputs) result.unresolvedInputs = [...unresolvedInputs];
  return result;
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
