/**
 * Versioned Prompt Component contracts (STO-1275).
 *
 * A contract declares which code-owned craft inputs a component needs, which
 * allowlisted context slices it may read, and how output should be presented.
 * Contracts are pure data: no expressions, paths, URLs, secrets or code. They
 * are validated before persistence and again before use.
 *
 * `null` means the legacy STO-1158 behavior (no contract) and is never invalid.
 */

import { PromptError } from "./errors";

export const PROMPT_CONTRACT_SCHEMA_VERSION = 1 as const;
/** Serialized contract JSON cap (EL approval 2026-11-08). */
export const PROMPT_CONTRACT_MAX_BYTES = 64 * 1024;
/** Max nesting depth of a contract value (root object = depth 1). */
export const PROMPT_CONTRACT_MAX_DEPTH = 8;

export const CONTRACT_INPUT_TYPES = ["text", "integer", "boolean", "enum"] as const;
export type ContractInputType = (typeof CONTRACT_INPUT_TYPES)[number];

/** Code-owned rewrite presets (EL approval 2026-11-08). */
export const REWRITE_PRESETS = ["more_vivid", "more_concise", "simpler", "stronger_voice"] as const;

interface CraftInputSpec {
  /** Types a contract may declare for this key. */
  types: readonly ContractInputType[];
  /** Hard ceiling for text length (characters). */
  maxLength?: number;
  /** Hard integer bounds. */
  min?: number;
  max?: number;
  /** When set, enum options must be a subset of these code-owned values. */
  options?: readonly string[];
}

/**
 * Approved craft input registry (EL 2026-11-08). Contracts may only declare
 * these keys; imported contracts cannot invent new bindings or path lookups.
 */
export const CRAFT_INPUT_REGISTRY = {
  "craft.selection": { types: ["text"], maxLength: 20_000 },
  "craft.instructions": { types: ["text"], maxLength: 2_000 },
  "craft.target_words": { types: ["integer"], min: 1, max: 5_000 },
  "craft.sensory_focus": { types: ["text", "enum"], maxLength: 200 },
  "craft.rewrite_preset": { types: ["enum"], options: REWRITE_PRESETS },
  "craft.before_passage": { types: ["text"], maxLength: 20_000 },
  "craft.after_passage": { types: ["text"], maxLength: 20_000 },
  "craft.brainstorm_kind": { types: ["text", "enum"], maxLength: 200 },
  "craft.brainstorm_count": { types: ["integer"], min: 1, max: 20 },
} as const satisfies Record<string, CraftInputSpec>;

export type CraftInputKey = keyof typeof CRAFT_INPUT_REGISTRY;
export const CRAFT_INPUT_KEYS = Object.keys(CRAFT_INPUT_REGISTRY) as CraftInputKey[];

/** Approved context slices. No semantic-retrieval slice in v1. */
export const CONTEXT_SLICES = [
  "selection",
  "scene.summary",
  "scene.content",
  "scene.title",
  "scene.pov",
  "scene.tense",
  "chapter.title",
  "novel.title",
  "codex.context",
] as const;
export type ContextSlice = (typeof CONTEXT_SLICES)[number];

/** UI presentation hints only — never write authority. */
export const OUTPUT_MODES = ["prose", "diagnosis_and_prose", "options"] as const;
export type OutputMode = (typeof OUTPUT_MODES)[number];
export const SUGGESTED_ACTIONS = [
  "replace_selection",
  "insert_at_cursor",
  "insert_between",
  "copy_only",
] as const;
export type SuggestedAction = (typeof SUGGESTED_ACTIONS)[number];

const MAX_LABEL_LENGTH = 120;
const MAX_INPUT_DESCRIPTION_LENGTH = 500;
const MAX_ENUM_OPTIONS = 32;
const MAX_ENUM_OPTION_LENGTH = 64;
const ENUM_OPTION_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const MAX_ATTRIBUTION_LENGTH = { author: 200, license: 200, source: 500 } as const;

interface ContractInputBase {
  key: CraftInputKey;
  required: boolean;
  label?: string;
  description?: string;
}

export interface TextContractInput extends ContractInputBase {
  type: "text";
  maxLength?: number;
}

export interface IntegerContractInput extends ContractInputBase {
  type: "integer";
  min?: number;
  max?: number;
}

export interface BooleanContractInput extends ContractInputBase {
  type: "boolean";
}

export interface EnumContractInput extends ContractInputBase {
  type: "enum";
  options: string[];
}

export type ContractInput =
  | TextContractInput
  | IntegerContractInput
  | BooleanContractInput
  | EnumContractInput;

export interface ContractOutput {
  mode: OutputMode;
  suggestedAction: SuggestedAction | null;
}

/** Optional, unverified display metadata. Not authorization; no license enforcement. */
export interface ContractAttribution {
  author: string | null;
  license: string | null;
  source: string | null;
}

export interface PromptComponentContract {
  schemaVersion: typeof PROMPT_CONTRACT_SCHEMA_VERSION;
  inputs: ContractInput[];
  contextSlices: ContextSlice[];
  output: ContractOutput | null;
  attribution: ContractAttribution | null;
}

function invalid(path: string, message: string): PromptError {
  return new PromptError(`Invalid contract at ${path}: ${message}`, "INVALID_CONTRACT", 422);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function assertOnlyKeys(obj: Record<string, unknown>, allowed: readonly string[], path: string) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      throw invalid(`${path}.${key}`, "unsupported field (unknown capabilities are rejected)");
    }
  }
}

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

/** Iterative depth measurement so hostile nesting cannot blow the stack. */
export function jsonDepth(value: unknown): number {
  let max = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 1 }];
  while (stack.length) {
    const { value: current, depth } = stack.pop()!;
    if (current === null || typeof current !== "object") continue;
    max = Math.max(max, depth);
    if (depth > PROMPT_CONTRACT_MAX_DEPTH) return depth;
    const children = Array.isArray(current) ? current : Object.values(current);
    for (const child of children) stack.push({ value: child, depth: depth + 1 });
  }
  return max;
}

/** UTF-8 byte length of the serialized value. */
export function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Throws PAYLOAD_TOO_LARGE when the raw contract exceeds the depth or size caps. */
export function assertContractWithinLimits(raw: unknown): void {
  const depth = jsonDepth(raw);
  if (depth > PROMPT_CONTRACT_MAX_DEPTH) {
    throw new PromptError(
      `Contract nesting exceeds the maximum depth of ${PROMPT_CONTRACT_MAX_DEPTH}`,
      "PAYLOAD_TOO_LARGE",
      413,
    );
  }
  let bytes: number;
  try {
    bytes = jsonByteLength(raw);
  } catch {
    throw invalid("contract", "must be JSON-serializable");
  }
  if (bytes > PROMPT_CONTRACT_MAX_BYTES) {
    throw new PromptError(
      `Contract JSON is ${bytes} bytes; the maximum is ${PROMPT_CONTRACT_MAX_BYTES} bytes`,
      "PAYLOAD_TOO_LARGE",
      413,
    );
  }
}

function optionalBoundedString(
  value: unknown,
  path: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw invalid(path, "must be a string");
  const trimmed = stripControlChars(value).trim();
  if (trimmed.length > maxLength) throw invalid(path, `must be at most ${maxLength} characters`);
  return trimmed || undefined;
}

function optionalInteger(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw invalid(path, "must be an integer");
  }
  return value;
}

/** Removes C0/C1 control characters except tab/newline (inert display text). */
export function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
}

const BASE_INPUT_FIELDS = ["key", "type", "required", "label", "description"] as const;
const INPUT_FIELDS_BY_TYPE: Record<ContractInputType, readonly string[]> = {
  text: [...BASE_INPUT_FIELDS, "maxLength"],
  integer: [...BASE_INPUT_FIELDS, "min", "max"],
  boolean: [...BASE_INPUT_FIELDS],
  enum: [...BASE_INPUT_FIELDS, "options"],
};

function validateInput(raw: unknown, path: string): ContractInput {
  if (!isPlainObject(raw)) throw invalid(path, "must be an object");
  if (!includes(CRAFT_INPUT_KEYS, raw.key)) {
    throw invalid(
      `${path}.key`,
      `must be one of the registered craft inputs: ${CRAFT_INPUT_KEYS.join(", ")}`,
    );
  }
  const key = raw.key;
  const spec: CraftInputSpec = CRAFT_INPUT_REGISTRY[key];
  if (!includes(CONTRACT_INPUT_TYPES, raw.type)) {
    throw invalid(`${path}.type`, `must be one of: ${CONTRACT_INPUT_TYPES.join(", ")}`);
  }
  const type = raw.type;
  if (!spec.types.includes(type)) {
    throw invalid(`${path}.type`, `${key} must be declared as: ${spec.types.join(" or ")}`);
  }
  assertOnlyKeys(raw, INPUT_FIELDS_BY_TYPE[type], path);
  if (raw.required !== undefined && typeof raw.required !== "boolean") {
    throw invalid(`${path}.required`, "must be a boolean");
  }
  const base: ContractInputBase = { key, required: raw.required === true };
  const label = optionalBoundedString(raw.label, `${path}.label`, MAX_LABEL_LENGTH);
  if (label) base.label = label;
  const description = optionalBoundedString(
    raw.description,
    `${path}.description`,
    MAX_INPUT_DESCRIPTION_LENGTH,
  );
  if (description) base.description = description;

  switch (type) {
    case "text": {
      const cap = spec.maxLength ?? MAX_INPUT_DESCRIPTION_LENGTH;
      const maxLength = optionalInteger(raw.maxLength, `${path}.maxLength`);
      if (maxLength !== undefined && (maxLength < 1 || maxLength > cap)) {
        throw invalid(`${path}.maxLength`, `must be between 1 and ${cap}`);
      }
      return maxLength === undefined ? { ...base, type } : { ...base, type, maxLength };
    }
    case "integer": {
      const floor = spec.min ?? 0;
      const ceiling = spec.max ?? Number.MAX_SAFE_INTEGER;
      const min = optionalInteger(raw.min, `${path}.min`);
      const max = optionalInteger(raw.max, `${path}.max`);
      for (const [name, value] of [
        ["min", min],
        ["max", max],
      ] as const) {
        if (value !== undefined && (value < floor || value > ceiling)) {
          throw invalid(`${path}.${name}`, `must be between ${floor} and ${ceiling}`);
        }
      }
      if (min !== undefined && max !== undefined && min > max) {
        throw invalid(`${path}.min`, "must not exceed max");
      }
      const input: IntegerContractInput = { ...base, type };
      if (min !== undefined) input.min = min;
      if (max !== undefined) input.max = max;
      return input;
    }
    case "boolean":
      return { ...base, type };
    case "enum": {
      if (!Array.isArray(raw.options) || raw.options.length === 0) {
        throw invalid(`${path}.options`, "must be a non-empty array");
      }
      if (raw.options.length > MAX_ENUM_OPTIONS) {
        throw invalid(`${path}.options`, `must have at most ${MAX_ENUM_OPTIONS} options`);
      }
      const seen = new Set<string>();
      raw.options.forEach((option, i) => {
        const optionPath = `${path}.options[${i}]`;
        if (
          typeof option !== "string" ||
          option.length > MAX_ENUM_OPTION_LENGTH ||
          !ENUM_OPTION_PATTERN.test(option)
        ) {
          throw invalid(
            optionPath,
            `must be a lowercase identifier (a-z, 0-9, _ or -) of at most ${MAX_ENUM_OPTION_LENGTH} characters`,
          );
        }
        if (spec.options && !spec.options.includes(option)) {
          throw invalid(optionPath, `${key} options must be from: ${spec.options.join(", ")}`);
        }
        if (seen.has(option)) throw invalid(optionPath, "duplicate option");
        seen.add(option);
      });
      return { ...base, type, options: [...seen] };
    }
  }
}

function validateOutput(raw: unknown): ContractOutput | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) throw invalid("output", "must be an object or null");
  assertOnlyKeys(raw, ["mode", "suggestedAction"], "output");
  if (!includes(OUTPUT_MODES, raw.mode)) {
    throw invalid("output.mode", `must be one of: ${OUTPUT_MODES.join(", ")}`);
  }
  let suggestedAction: SuggestedAction | null = null;
  if (raw.suggestedAction !== undefined && raw.suggestedAction !== null) {
    if (!includes(SUGGESTED_ACTIONS, raw.suggestedAction)) {
      throw invalid(
        "output.suggestedAction",
        `must be one of: ${SUGGESTED_ACTIONS.join(", ")} (or null)`,
      );
    }
    suggestedAction = raw.suggestedAction;
  }
  return { mode: raw.mode, suggestedAction };
}

function validateAttribution(raw: unknown): ContractAttribution | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) throw invalid("attribution", "must be an object or null");
  assertOnlyKeys(raw, ["author", "license", "source"], "attribution");
  const out: ContractAttribution = { author: null, license: null, source: null };
  for (const field of ["author", "license", "source"] as const) {
    const value = raw[field];
    if (value === null || value === undefined) continue;
    out[field] =
      optionalBoundedString(value, `attribution.${field}`, MAX_ATTRIBUTION_LENGTH[field]) ?? null;
  }
  if (!out.author && !out.license && !out.source) return null;
  return out;
}

/**
 * Validates a raw contract and returns its canonical form.
 * Rejects (never strips) unknown fields, unknown versions and oversize payloads.
 */
export function validatePromptContract(raw: unknown): PromptComponentContract {
  assertContractWithinLimits(raw);
  if (!isPlainObject(raw)) throw invalid("contract", "must be an object");

  const version = raw.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw invalid("schemaVersion", "must be a positive integer");
  }
  if (version !== PROMPT_CONTRACT_SCHEMA_VERSION) {
    throw new PromptError(
      `Unsupported contract schemaVersion ${version}; this version of InkStory supports schemaVersion ${PROMPT_CONTRACT_SCHEMA_VERSION}`,
      "UNSUPPORTED_VERSION",
      422,
    );
  }
  assertOnlyKeys(
    raw,
    ["schemaVersion", "inputs", "contextSlices", "output", "attribution"],
    "contract",
  );

  const inputs: ContractInput[] = [];
  if (raw.inputs !== undefined) {
    if (!Array.isArray(raw.inputs)) throw invalid("inputs", "must be an array");
    if (raw.inputs.length > CRAFT_INPUT_KEYS.length) {
      throw invalid("inputs", `must declare at most ${CRAFT_INPUT_KEYS.length} inputs`);
    }
    const keys = new Set<string>();
    raw.inputs.forEach((rawInput, i) => {
      const input = validateInput(rawInput, `inputs[${i}]`);
      if (keys.has(input.key)) throw invalid(`inputs[${i}].key`, `duplicate input ${input.key}`);
      keys.add(input.key);
      inputs.push(input);
    });
  }

  const contextSlices: ContextSlice[] = [];
  if (raw.contextSlices !== undefined) {
    if (!Array.isArray(raw.contextSlices)) throw invalid("contextSlices", "must be an array");
    raw.contextSlices.forEach((slice, i) => {
      if (!includes(CONTEXT_SLICES, slice)) {
        throw invalid(`contextSlices[${i}]`, `must be one of: ${CONTEXT_SLICES.join(", ")}`);
      }
      if (contextSlices.includes(slice)) {
        throw invalid(`contextSlices[${i}]`, `duplicate slice ${slice}`);
      }
      contextSlices.push(slice);
    });
  }

  return {
    schemaVersion: PROMPT_CONTRACT_SCHEMA_VERSION,
    inputs,
    contextSlices,
    output: validateOutput(raw.output),
    attribution: validateAttribution(raw.attribution),
  };
}

/** `undefined`/`null` → `null` (legacy STO-1158 component); otherwise validate. */
export function normalizePromptContract(raw: unknown): PromptComponentContract | null {
  if (raw === undefined || raw === null) return null;
  return validatePromptContract(raw);
}

/**
 * Lenient read of a persisted contract for DTOs. Writes are validated, so an
 * invalid stored value only arises from out-of-band edits; it is treated as
 * "no contract" for display and must be re-validated (and rejected) before use.
 */
export function readStoredContract(raw: unknown): PromptComponentContract | null {
  try {
    return normalizePromptContract(raw);
  } catch {
    return null;
  }
}

export type CraftInputBindings = Partial<Record<CraftInputKey, string>>;

function isEmptyValue(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

function invalidValue(key: string, message: string): PromptError {
  return new PromptError(`Invalid craft input ${key}: ${message}`, "VALIDATION_FAILED", 422);
}

/** Validates one supplied value against its declared input and returns its string binding. */
export function bindCraftInputValue(input: ContractInput, value: unknown): string {
  switch (input.type) {
    case "text": {
      if (typeof value !== "string") throw invalidValue(input.key, "must be a string");
      const spec: CraftInputSpec = CRAFT_INPUT_REGISTRY[input.key];
      const cap = input.maxLength ?? spec.maxLength ?? MAX_INPUT_DESCRIPTION_LENGTH;
      if (value.length > cap) {
        throw invalidValue(input.key, `must be at most ${cap} characters`);
      }
      return value;
    }
    case "integer": {
      if (typeof value !== "number" || !Number.isSafeInteger(value)) {
        throw invalidValue(input.key, "must be an integer");
      }
      const spec: CraftInputSpec = CRAFT_INPUT_REGISTRY[input.key];
      const min = input.min ?? spec.min;
      const max = input.max ?? spec.max;
      if ((min !== undefined && value < min) || (max !== undefined && value > max)) {
        throw invalidValue(input.key, `must be between ${min ?? "-∞"} and ${max ?? "∞"}`);
      }
      return String(value);
    }
    case "boolean":
      if (typeof value !== "boolean") throw invalidValue(input.key, "must be a boolean");
      return value ? "true" : "false";
    case "enum":
      if (typeof value !== "string" || !input.options.includes(value)) {
        throw invalidValue(input.key, `must be one of: ${input.options.join(", ")}`);
      }
      return value;
  }
}

/**
 * Validates supplied craft input values against a contract before any provider
 * call. Unknown/undeclared keys and wrong types → 422 VALIDATION_FAILED; any
 * missing or blank required input → 422 MISSING_INPUT (even though legacy
 * interpolation would treat an empty string as resolved). Optional inputs that
 * are absent bind to "". Values are returned as inert strings and are never
 * themselves interpolated.
 */
export function resolveCraftInputs(
  contract: PromptComponentContract,
  values: unknown,
): CraftInputBindings {
  const supplied = values ?? {};
  if (!isPlainObject(supplied)) {
    throw new PromptError("craft inputs must be an object", "VALIDATION_FAILED", 422);
  }
  const declared = new Map(contract.inputs.map((input) => [input.key as string, input]));
  for (const key of Object.keys(supplied)) {
    if (!declared.has(key)) throw invalidValue(key, "not declared by this component's contract");
  }

  const missing: string[] = [];
  const bindings: CraftInputBindings = {};
  for (const input of contract.inputs) {
    const value = supplied[input.key];
    if (isEmptyValue(value)) {
      if (input.required) missing.push(input.key);
      else bindings[input.key] = "";
      continue;
    }
    bindings[input.key] = bindCraftInputValue(input, value);
  }
  if (missing.length) {
    throw new PromptError(
      `Missing required craft input${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`,
      "MISSING_INPUT",
      422,
    );
  }
  return bindings;
}

/**
 * Tool policy ceiling: a component may only read the context slices the
 * calling craft tool permits. Requesting anything else is rejected.
 */
export function assertContextSlicesAllowed(
  contract: PromptComponentContract,
  allowed: readonly ContextSlice[],
): void {
  const denied = contract.contextSlices.filter((slice) => !allowed.includes(slice));
  if (denied.length) {
    throw new PromptError(
      `Context slice${denied.length > 1 ? "s" : ""} not permitted for this tool: ${denied.join(", ")}`,
      "FORBIDDEN",
      403,
    );
  }
}
