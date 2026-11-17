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

/** Tools whose output should come out longer than the selection (STO-1295). */
const LENGTHENING_TOOL_IDS: ReadonlySet<string> = new Set(["expand"]);

/** Expand's adaptive target: this many times the selection, at least the tool default. */
export const EXPAND_TARGET_GROWTH = 1.5;

function lengtheningTarget(tool: CraftToolDto): ContractInput | null {
  if (!LENGTHENING_TOOL_IDS.has(tool.id)) return null;
  return (
    formInputs(tool).find((input) => input.key === TARGET_WORDS_KEY && input.type === "integer") ??
    null
  );
}

/**
 * Selection-aware target for lengthening tools (Expand): grow the selection by
 * {@link EXPAND_TARGET_GROWTH}, never below the tool default and never above the
 * contract ceiling. `null` when the tool isn't lengthening or nothing is selected,
 * so the static default (`EXPAND_DEFAULT_TARGET_WORDS`) stays the API fallback.
 */
export function suggestedTargetWords(tool: CraftToolDto, selectionWords: number): number | null {
  const input = lengtheningTarget(tool);
  if (!input || selectionWords <= 0) return null;
  const { min, max } = integerBounds(input);
  const fallback = Number(tool.defaults[TARGET_WORDS_KEY]);
  const floor = Number.isFinite(fallback) ? fallback : min;
  return Math.min(max, Math.max(floor, Math.ceil(selectionWords * EXPAND_TARGET_GROWTH)));
}

/**
 * Form values with the target length following the selection until the author
 * edits it (`touched`). Without a selection the untouched target reverts to the
 * tool default. Tools without a lengthening target are returned unchanged.
 */
export function withAdaptiveTarget(
  tool: CraftToolDto,
  values: CraftFormValues,
  selectionWords: number,
  touched: boolean,
): CraftFormValues {
  if (touched || !lengtheningTarget(tool)) return values;
  const suggestion = suggestedTargetWords(tool, selectionWords);
  const target =
    suggestion === null ? initialFormValues(tool)[TARGET_WORDS_KEY] : String(suggestion);
  return values[TARGET_WORDS_KEY] === target ? values : { ...values, [TARGET_WORDS_KEY]: target };
}

/**
 * Inline warning when a lengthening tool's target would not lengthen the
 * selection: the target is at or below the selection's word count, or the
 * selection already meets the contract ceiling. Invalid targets are left to
 * {@link validateCraftForm}.
 */
export function targetWordsWarning(
  tool: CraftToolDto,
  values: CraftFormValues,
  selectionWords: number,
): string | null {
  const input = lengtheningTarget(tool);
  if (!input || selectionWords <= 0) return null;
  const { min, max } = integerBounds(input);
  const raw = values[TARGET_WORDS_KEY];
  const target =
    typeof raw === "string" && raw.trim()
      ? Number(raw.trim())
      : Number(tool.defaults[TARGET_WORDS_KEY]);
  if (!Number.isInteger(target) || target < min || target > max) return null;
  const words = selectionWords.toLocaleString("en-US");
  if (selectionWords >= max) {
    return `The selection is ${words} words, at or above the ${max.toLocaleString("en-US")}-word maximum, so ${tool.name} can't lengthen it. Select a shorter passage.`;
  }
  if (target <= selectionWords) {
    const suggestion = suggestedTargetWords(tool, selectionWords) ?? max;
    return `${tool.name} would shorten this: the target is at or below the selection's ${words} words. Try ${suggestion.toLocaleString("en-US")} or more.`;
  }
  return null;
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
