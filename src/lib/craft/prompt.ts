/**
 * Pure Craft prompt building (STO-1266): input defaults, context-slice
 * filtering and output-length → token budget. No DB or network.
 */

import { MAX_OUTPUT_TOKENS } from "@/lib/ai/generate";
import type { PromptBindings, PromptVariableToken } from "@/lib/prompts/catalog";
import {
  assertContextSlicesAllowed,
  resolveCraftInputs,
  type ContextSlice,
  type CraftInputBindings,
  type PromptComponentContract,
} from "@/lib/prompts/contracts";
import { PromptError } from "@/lib/prompts/errors";
import { renderPrompt } from "@/lib/prompts/render";
import type { RenderedPrompt } from "@/lib/prompts/types";
import type { CraftToolDefinition } from "./tools";

/** Smallest completion budget a craft call requests, even for tiny targets. */
export const MIN_CRAFT_OUTPUT_TOKENS = 128;
/** Rough tokens-per-word allowance (English prose ≈ 1.3) with headroom. */
export const CRAFT_TOKENS_PER_WORD = 2;

/**
 * Fills blank declared inputs from the tool defaults. Undeclared keys are left
 * in place so resolveCraftInputs still rejects them.
 */
export function applyCraftDefaults(tool: CraftToolDefinition, values: unknown): unknown {
  if (values !== undefined && values !== null) {
    if (typeof values !== "object" || Array.isArray(values)) return values;
  }
  const supplied = { ...(values as Record<string, unknown> | null | undefined) };
  for (const input of tool.contract.inputs) {
    const current = supplied[input.key];
    const blank =
      current === undefined || current === null || (typeof current === "string" && !current.trim());
    const fallback = tool.defaults[input.key];
    if (blank && fallback !== undefined) supplied[input.key] = fallback;
  }
  return supplied;
}

/** Validates inputs against the tool's contract and policy ceiling. */
export function resolveToolInputs(tool: CraftToolDefinition, values: unknown): CraftInputBindings {
  assertContextSlicesAllowed(tool.contract, tool.allowedContextSlices);
  return resolveCraftInputs(tool.contract, applyCraftDefaults(tool, values));
}

const SLICE_TOKENS: Partial<Record<ContextSlice, PromptVariableToken>> = {
  "scene.summary": "scene.summary",
  "scene.content": "scene.content",
  "scene.title": "scene.title",
  "scene.pov": "scene.pov",
  "scene.tense": "scene.tense",
  "chapter.title": "chapter.title",
  "novel.title": "novel.title",
  "codex.context": "codex.context",
};

/**
 * Keeps only catalog bindings for slices the contract declares. Anything else
 * (including beat/mode) is dropped, so a body that references an undeclared
 * slice renders as unresolved and is rejected before any provider call.
 */
export function filterBindingsBySlices(
  bindings: PromptBindings,
  slices: readonly ContextSlice[],
): Partial<PromptBindings> {
  const out: Partial<PromptBindings> = {};
  for (const slice of slices) {
    const token = SLICE_TOKENS[slice];
    if (token) out[token] = bindings[token];
  }
  return out;
}

export function contractReadsSlice(
  contract: PromptComponentContract,
  slice: ContextSlice,
): boolean {
  return contract.contextSlices.includes(slice);
}

/** Completion budget for an output-length target, clamped to the platform cap. */
export function maxTokensForTargetWords(targetWords: number | undefined): number | undefined {
  if (targetWords === undefined || !Number.isFinite(targetWords) || targetWords <= 0) {
    return undefined;
  }
  return Math.min(
    MAX_OUTPUT_TOKENS,
    Math.max(MIN_CRAFT_OUTPUT_TOKENS, Math.ceil(targetWords * CRAFT_TOKENS_PER_WORD)),
  );
}

/** Renders a tool's parts and rejects anything left unresolved (422). */
export function renderCraftPrompt(
  tool: CraftToolDefinition,
  bindings: Partial<PromptBindings>,
  craftInputs: CraftInputBindings,
): RenderedPrompt {
  // Absent keys stay unresolved by design (see filterBindingsBySlices).
  const rendered = renderPrompt(tool.parts, bindings as PromptBindings, { craftInputs });
  const leftovers = [
    ...rendered.unresolved,
    ...rendered.unknownTokens,
    ...(rendered.unresolvedInputs ?? []),
  ];
  if (leftovers.length) {
    throw new PromptError(
      `Prompt has unresolved variables: ${leftovers.join(", ")}`,
      "UNRESOLVED_VARS",
      422,
    );
  }
  return rendered;
}
