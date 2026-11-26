/**
 * Browser-safe Craft Studio helpers for the editor panel (STO-1290).
 *
 * The panel renders each tool's form from the `GET /api/craft/tools` contract,
 * so a new tool (STO-1268 Expand onward) needs no panel change. These helpers
 * are pure: form defaults, request input building and the client-side checks
 * that mirror the server's 422 contract validation. The server stays the
 * authority; these only save a round trip and explain problems early.
 */

import {
  CRAFT_INPUT_REGISTRY,
  type ContextSlice,
  type ContractInput,
  type ContractOutput,
  type CraftInputKey,
  type PromptComponentContract,
} from "@/lib/prompts/contracts";

/** `toCraftToolDto` shape as served by `GET /api/craft/tools`. */
export interface CraftToolDto {
  id: string;
  name: string;
  summary: string;
  contract: PromptComponentContract;
  defaults: Partial<Record<CraftInputKey, string | number | boolean>>;
  allowedContextSlices: ContextSlice[];
}

/** The input every selection-based tool binds to the editor selection. */
export const SELECTION_INPUT_KEY = "craft.selection" satisfies CraftInputKey;

/** Form state: one raw value per declared (non-selection) input. */
export type CraftFormValues = Partial<Record<CraftInputKey, string | boolean>>;

/** Inputs the author fills in the form (the selection comes from the editor). */
export function formInputs(tool: CraftToolDto): ContractInput[] {
  return tool.contract.inputs.filter((input) => input.key !== SELECTION_INPUT_KEY);
}

/** Whether the tool reads the editor selection. */
export function usesSelection(tool: CraftToolDto): boolean {
  return tool.contract.inputs.some((input) => input.key === SELECTION_INPUT_KEY);
}

/**
 * Initial form values. Enum, integer and boolean inputs start at the tool
 * default so the author sees what will be sent. Free-text inputs start blank:
 * their default (e.g. Describe's "None." guidance) is a server-side filler, not
 * something to prefill.
 */
export function initialFormValues(tool: CraftToolDto): CraftFormValues {
  const values: CraftFormValues = {};
  for (const input of formInputs(tool)) {
    const fallback = tool.defaults[input.key];
    if (input.type === "boolean") {
      values[input.key] = fallback === true;
    } else if (input.type === "text") {
      values[input.key] = "";
    } else if (input.type === "enum") {
      values[input.key] =
        typeof fallback === "string" && input.options.includes(fallback)
          ? fallback
          : (input.options[0] ?? "");
    } else {
      values[input.key] = fallback === undefined ? "" : String(fallback);
    }
  }
  return values;
}

/** The target-length input shared by the length-aware Craft tools. */
export const TARGET_WORDS_KEY = "craft.target_words" satisfies CraftInputKey;

/** The Rewrite preset input; its value changes how the target follows the selection. */
export const REWRITE_PRESET_KEY = "craft.rewrite_preset" satisfies CraftInputKey;

/**
 * How a length-aware tool's target follows the selection (STO-1295, STO-1299,
 * STO-1294). `lengthens` tools (Expand) must come out longer than the
 * selection; the others (Show Don't Tell, Rewrite) rewrite at about the
 * selection's length and only warn when the target would condense it below
 * `condenseRatio` of the suggestion's growth.
 */
interface AdaptiveTargetRule {
  /** Suggested target = selection words × growth. */
  growth: number;
  /**
   * Growth overrides keyed by the value of an enum input (Rewrite's
   * `more_concise` preset aims shorter). Values not listed use `growth`.
   */
  growthBy?: { key: CraftInputKey; values: ReadonlyMap<string, number> };
  /** Lowest suggestion: the tool default, or a fixed word count. */
  floor: "default" | number;
  lengthens: boolean;
  /** Non-lengthening tools warn when the target is below selection × growth × ratio. */
  condenseRatio: number;
}

/** Expand's adaptive target: this many times the selection, at least the tool default. */
export const EXPAND_TARGET_GROWTH = 1.5;

/** Show Don't Tell rewrites at about the selection's length (STO-1299). */
export const SHOW_DONT_TELL_TARGET_GROWTH = 1;
/** Showing a one-line tell needs a few sentences, so short selections get at least this. */
export const SHOW_DONT_TELL_MIN_TARGET_WORDS = 50;
/** Show Don't Tell warns when the target is under this share of the selection. */
export const SHOW_DONT_TELL_CONDENSE_RATIO = 0.5;

/** Rewrite keeps about the selection's length for every preset but `more_concise` (STO-1294). */
export const REWRITE_TARGET_GROWTH = 1;
/** `more_concise` aims for this share of the selection instead of the fixed default. */
export const REWRITE_CONCISE_TARGET_GROWTH = 0.6;
/** Rewriting a fragment still needs a sentence or two, so short selections get at least this. */
export const REWRITE_MIN_TARGET_WORDS = 20;
/** Rewrite warns when the target is under this share of the preset's suggested length. */
export const REWRITE_CONDENSE_RATIO = 0.5;

const ADAPTIVE_TARGET_RULES: ReadonlyMap<string, AdaptiveTargetRule> = new Map([
  ["expand", { growth: EXPAND_TARGET_GROWTH, floor: "default", lengthens: true, condenseRatio: 1 }],
  [
    "show_dont_tell",
    {
      growth: SHOW_DONT_TELL_TARGET_GROWTH,
      floor: SHOW_DONT_TELL_MIN_TARGET_WORDS,
      lengthens: false,
      condenseRatio: SHOW_DONT_TELL_CONDENSE_RATIO,
    },
  ],
  [
    "rewrite",
    {
      growth: REWRITE_TARGET_GROWTH,
      growthBy: {
        key: REWRITE_PRESET_KEY,
        values: new Map([["more_concise", REWRITE_CONCISE_TARGET_GROWTH]]),
      },
      floor: REWRITE_MIN_TARGET_WORDS,
      lengthens: false,
      condenseRatio: REWRITE_CONDENSE_RATIO,
    },
  ],
]);

/** The rule's growth for the current form values (the input's value, else the tool default). */
function growthFor(tool: CraftToolDto, rule: AdaptiveTargetRule, values?: CraftFormValues): number {
  if (!rule.growthBy) return rule.growth;
  const { key, values: byValue } = rule.growthBy;
  const raw = values?.[key];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  const chosen = trimmed || tool.defaults[key];
  return typeof chosen === "string" ? (byValue.get(chosen) ?? rule.growth) : rule.growth;
}

function adaptiveTarget(
  tool: CraftToolDto,
): { rule: AdaptiveTargetRule; input: ContractInput } | null {
  const rule = ADAPTIVE_TARGET_RULES.get(tool.id);
  const input = rule
    ? formInputs(tool).find((i) => i.key === TARGET_WORDS_KEY && i.type === "integer")
    : undefined;
  return rule && input ? { rule, input } : null;
}

/**
 * Selection-aware target for length-aware tools: the selection times the
 * tool's growth (1.5× for Expand, 1× for Show Don't Tell and Rewrite, 0.6× for
 * Rewrite's `more_concise` preset), never below the tool's floor and always
 * inside the contract bounds. `null` when the tool has no adaptive target or
 * nothing is selected, so the static default (`EXPAND_DEFAULT_TARGET_WORDS`,
 * `SHOW_DONT_TELL_DEFAULT_TARGET_WORDS`, `REWRITE_DEFAULT_TARGET_WORDS`) stays
 * the API fallback. `values` picks a per-option growth (Rewrite preset).
 */
export function suggestedTargetWords(
  tool: CraftToolDto,
  selectionWords: number,
  values?: CraftFormValues,
): number | null {
  const adaptive = adaptiveTarget(tool);
  if (!adaptive || selectionWords <= 0) return null;
  const { rule, input } = adaptive;
  const { min, max } = integerBounds(input);
  const fallback = Number(tool.defaults[TARGET_WORDS_KEY]);
  const floor =
    rule.floor === "default" ? (Number.isFinite(fallback) ? fallback : min) : rule.floor;
  const grown = Math.ceil(selectionWords * growthFor(tool, rule, values));
  return Math.min(max, Math.max(min, floor, grown));
}

/**
 * Form values with the target length following the selection until the author
 * edits it (`touched`). Without a selection the untouched target reverts to the
 * tool default. Tools without an adaptive target are returned unchanged.
 */
export function withAdaptiveTarget(
  tool: CraftToolDto,
  values: CraftFormValues,
  selectionWords: number,
  touched: boolean,
): CraftFormValues {
  if (touched || !adaptiveTarget(tool)) return values;
  const suggestion = suggestedTargetWords(tool, selectionWords, values);
  const target =
    suggestion === null ? initialFormValues(tool)[TARGET_WORDS_KEY] : String(suggestion);
  return values[TARGET_WORDS_KEY] === target ? values : { ...values, [TARGET_WORDS_KEY]: target };
}

const formatWords = (words: number) => words.toLocaleString("en-US");

function lengtheningWarning(
  tool: CraftToolDto,
  target: number,
  selectionWords: number,
  max: number,
): string | null {
  if (selectionWords >= max) {
    return `The selection is ${formatWords(selectionWords)} words, at or above the ${formatWords(max)}-word maximum, so ${tool.name} can't lengthen it. Select a shorter passage.`;
  }
  if (target > selectionWords) return null;
  const suggestion = suggestedTargetWords(tool, selectionWords) ?? max;
  const hint = suggestion >= max ? "" : " or more";
  return `${tool.name} would shorten this: the target is at or below the selection's ${formatWords(selectionWords)} words. Try ${formatWords(suggestion)}${hint}.`;
}

function condensingWarning(
  tool: CraftToolDto,
  rule: AdaptiveTargetRule,
  values: CraftFormValues,
  target: number,
  selectionWords: number,
  max: number,
): string | null {
  const growth = growthFor(tool, rule, values);
  if (Math.ceil(selectionWords * growth) > max) {
    return growth < 1
      ? `The selection is ${formatWords(selectionWords)} words, so even the suggested target exceeds the ${formatWords(max)}-word maximum and ${tool.name} will condense it further. Select a shorter passage.`
      : `The selection is ${formatWords(selectionWords)} words, above the ${formatWords(max)}-word maximum, so ${tool.name} will condense it. Select a shorter passage.`;
  }
  if (target >= selectionWords * growth * rule.condenseRatio) return null;
  const suggestion = suggestedTargetWords(tool, selectionWords, values) ?? max;
  if (growth < 1) {
    return `${tool.name} would heavily condense this: the target is well below the suggested ${formatWords(suggestion)} words for a ${formatWords(selectionWords)}-word selection.`;
  }
  return `${tool.name} would condense this: the target is well below the selection's ${formatWords(selectionWords)} words. Try about ${formatWords(suggestion)}.`;
}

/**
 * Inline warning when a length-aware tool's target is in tension with the
 * selection. Expand warns when it would not lengthen (target at or below the
 * selection, or the selection already at the ceiling); Show Don't Tell and
 * Rewrite warn when the result would condense the selection (target under half
 * of the suggested length, or the suggested length above the ceiling). Invalid
 * targets are left to {@link validateCraftForm}.
 */
export function targetWordsWarning(
  tool: CraftToolDto,
  values: CraftFormValues,
  selectionWords: number,
): string | null {
  const adaptive = adaptiveTarget(tool);
  if (!adaptive || selectionWords <= 0) return null;
  const { rule, input } = adaptive;
  const { min, max } = integerBounds(input);
  const raw = values[TARGET_WORDS_KEY];
  const target =
    typeof raw === "string" && raw.trim()
      ? Number(raw.trim())
      : Number(tool.defaults[TARGET_WORDS_KEY]);
  if (!Number.isInteger(target) || target < min || target > max) return null;
  return rule.lengthens
    ? lengtheningWarning(tool, target, selectionWords, max)
    : condensingWarning(tool, rule, values, target, selectionWords, max);
}

/** Effective bounds for an integer input: the contract's, inside the registry ceiling. */
export function integerBounds(input: ContractInput): { min: number; max: number } {
  const spec = CRAFT_INPUT_REGISTRY[input.key] as { min?: number; max?: number };
  const min = input.type === "integer" && input.min !== undefined ? input.min : (spec.min ?? 0);
  const max =
    input.type === "integer" && input.max !== undefined
      ? input.max
      : (spec.max ?? Number.MAX_SAFE_INTEGER);
  return { min, max };
}

/** Effective max length for a text input: the contract's, inside the registry ceiling. */
export function textMaxLength(input: ContractInput): number | undefined {
  const spec = CRAFT_INPUT_REGISTRY[input.key] as { maxLength?: number };
  const own = input.type === "text" ? input.maxLength : undefined;
  if (own !== undefined && spec.maxLength !== undefined) return Math.min(own, spec.maxLength);
  return own ?? spec.maxLength;
}

export interface CraftInputProblem {
  key: CraftInputKey;
  message: string;
}

function labelOf(input: ContractInput): string {
  return input.label ?? input.key;
}

/**
 * Client-side mirror of the contract checks (required, integer bounds, text
 * length, enum membership). Returns problems keyed by input; empty = sendable.
 */
export function validateCraftForm(
  tool: CraftToolDto,
  values: CraftFormValues,
  selection: string,
): CraftInputProblem[] {
  const problems: CraftInputProblem[] = [];
  for (const input of tool.contract.inputs) {
    const raw = input.key === SELECTION_INPUT_KEY ? selection : values[input.key];
    if (input.type === "boolean") continue;
    const text = typeof raw === "string" ? raw.trim() : "";
    if (!text) {
      const hasDefault = tool.defaults[input.key] !== undefined;
      if (input.required && !hasDefault) {
        problems.push({
          key: input.key,
          message:
            input.key === SELECTION_INPUT_KEY
              ? "Select some prose in the scene first."
              : `${labelOf(input)} is required.`,
        });
      }
      continue;
    }
    if (input.type === "integer") {
      const { min, max } = integerBounds(input);
      const n = Number(text);
      if (!Number.isInteger(n) || n < min || n > max) {
        problems.push({
          key: input.key,
          message: `${labelOf(input)} must be a whole number from ${min.toLocaleString("en-US")} to ${max.toLocaleString("en-US")}.`,
        });
      }
    } else if (input.type === "enum") {
      if (!input.options.includes(text)) {
        problems.push({ key: input.key, message: `${labelOf(input)} has an unknown option.` });
      }
    } else {
      const max = textMaxLength(input);
      // Selection is sent verbatim, so validate raw character length to match the server.
      const length =
        input.key === SELECTION_INPUT_KEY && typeof raw === "string" ? raw.length : text.length;
      if (max !== undefined && length > max) {
        problems.push({
          key: input.key,
          message: `${labelOf(input)} is too long (${length.toLocaleString("en-US")} / ${max.toLocaleString("en-US")} characters).`,
        });
      }
    }
  }
  return problems;
}

/**
 * Request `inputs` for `POST /api/craft/:tool`. Blank optional values are
 * omitted so the server applies the tool default; integers are sent as numbers.
 */
export function buildCraftInputs(
  tool: CraftToolDto,
  values: CraftFormValues,
  selection: string,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const input of tool.contract.inputs) {
    const raw = input.key === SELECTION_INPUT_KEY ? selection : values[input.key];
    if (input.type === "boolean") {
      if (typeof raw === "boolean") out[input.key] = raw;
      continue;
    }
    if (typeof raw !== "string" || !raw.trim()) continue;
    // Selection is sent verbatim (whitespace is part of the prose); other text is trimmed.
    if (input.key === SELECTION_INPUT_KEY) out[input.key] = raw;
    else if (input.type === "integer") out[input.key] = Number(raw.trim());
    else out[input.key] = raw.trim();
  }
  return out;
}

/** Labels for the result actions a contract may suggest (hints only, never auto-applied). */
export const SUGGESTED_ACTION_LABELS: Record<
  NonNullable<ContractOutput["suggestedAction"]>,
  string
> = {
  replace_selection: "Replace selection",
  insert_at_cursor: "Insert at cursor",
  insert_between: "Insert between",
  copy_only: "Copy",
};

/** Human labels for enum options (`sight` → `Sight`, `more_vivid` → `More vivid`). */
export function optionLabel(option: string): string {
  const words = option.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : option;
}
