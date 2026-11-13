/**
 * Code-owned Craft Studio tool registry (STO-1266 scaffold, STO-1267 Describe).
 *
 * Each tool is a built-in reusable Prompt Component: a validated STO-1275
 * contract (declared craft inputs, context slices, output behavior) plus
 * system/user bodies rendered through the same closed-catalog interpolation
 * as scene Generate. No tables: tools live in code. The remaining v1 tools
 * (Expand, Rewrite, Show Don't Tell, Transition, Brainstorm) register here in
 * EL build order.
 */

import {
  validatePromptContract,
  type ContextSlice,
  type CraftInputKey,
  type PromptComponentContract,
} from "@/lib/prompts/contracts";
import { PromptError } from "@/lib/prompts/errors";
import type { PromptPart } from "@/lib/prompts/types";

export const CRAFT_TOOL_IDS = ["describe"] as const;
export type CraftToolId = (typeof CRAFT_TOOL_IDS)[number];

/** Default raw value per craft input, applied when the author leaves it blank. */
export type CraftInputDefaults = Partial<Record<CraftInputKey, string | number | boolean>>;

export interface CraftToolDefinition {
  id: CraftToolId;
  name: string;
  summary: string;
  /** Built-in component contract (validated at module load). */
  contract: PromptComponentContract;
  parts: PromptPart[];
  /**
   * Tool policy ceiling: the most context a component running under this tool
   * may read. The built-in contract must stay within it.
   */
  allowedContextSlices: readonly ContextSlice[];
  defaults: CraftInputDefaults;
}

export const SENSORY_FOCUS_OPTIONS = ["any", "sight", "sound", "smell", "touch", "taste"] as const;

/** Default output-length target for Describe (words). */
export const DESCRIBE_DEFAULT_TARGET_WORDS = 150;

const CRAFT_SYSTEM_BODY = [
  "You are a skilled fiction craft assistant embedded in InkStory, a novel-writing workspace.",
  "Story: {{novel.title}} — {{chapter.title}} / {{scene.title}}.",
  "Write in {{scene.pov}} and {{scene.tense}} tense, matching the author's established voice, diction and pacing.",
  "Story bible entries that apply to this scene are provided below. Respect their facts and current state; never contradict them.",
  "Return prose only — no headings, no commentary, no markdown fences.",
  "",
  "{{codex.context}}",
].join("\n");

const DESCRIBE_USER_BODY = [
  "Rewrite the selected passage so it is rich in concrete sensory description.",
  'Sensory focus: {{craft.sensory_focus}} ("any" means choose the senses that best serve the moment).',
  "Keep every event, action, line of dialogue and story fact from the selection. Add texture, not plot: do not introduce new characters, events or revelations.",
  "Aim for roughly {{craft.target_words}} words.",
  "",
  'Author guidance:\n"""\n{{craft.instructions}}\n"""',
  "",
  "Surrounding scene, for continuity only (do not rewrite it):",
  '"""',
  "{{scene.content}}",
  '"""',
  "",
  "Selected passage to describe:",
  '"""',
  "{{craft.selection}}",
  '"""',
].join("\n");

function defineTool(
  tool: Omit<CraftToolDefinition, "contract"> & { contract: unknown },
): CraftToolDefinition {
  return { ...tool, contract: validatePromptContract(tool.contract) };
}

const DESCRIBE = defineTool({
  id: "describe",
  name: "Describe",
  summary: "Enrich the selected prose with sensory description without changing what happens.",
  contract: {
    schemaVersion: 1,
    inputs: [
      { key: "craft.selection", type: "text", required: true, label: "Selected prose" },
      {
        key: "craft.sensory_focus",
        type: "enum",
        required: false,
        label: "Sensory focus",
        options: [...SENSORY_FOCUS_OPTIONS],
      },
      {
        key: "craft.target_words",
        type: "integer",
        required: false,
        label: "Target length (words)",
        min: 10,
        max: 1000,
      },
      {
        key: "craft.instructions",
        type: "text",
        required: false,
        label: "Extra guidance",
        maxLength: 1000,
      },
    ],
    contextSlices: [
      "selection",
      "scene.content",
      "scene.title",
      "scene.pov",
      "scene.tense",
      "chapter.title",
      "novel.title",
      "codex.context",
    ],
    output: { mode: "prose", suggestedAction: "replace_selection" },
    attribution: null,
  },
  parts: [
    { role: "system", body: CRAFT_SYSTEM_BODY, name: "craft-describe-system" },
    { role: "user", body: DESCRIBE_USER_BODY, name: "craft-describe-user" },
  ],
  allowedContextSlices: [
    "selection",
    "scene.content",
    "scene.summary",
    "scene.title",
    "scene.pov",
    "scene.tense",
    "chapter.title",
    "novel.title",
    "codex.context",
  ],
  defaults: {
    "craft.sensory_focus": "any",
    "craft.target_words": DESCRIBE_DEFAULT_TARGET_WORDS,
    "craft.instructions": "None.",
  },
});

const CRAFT_TOOLS: Record<CraftToolId, CraftToolDefinition> = { describe: DESCRIBE };

export function isCraftToolId(value: unknown): value is CraftToolId {
  return typeof value === "string" && (CRAFT_TOOL_IDS as readonly string[]).includes(value);
}

export function getCraftTool(id: unknown): CraftToolDefinition {
  if (!isCraftToolId(id)) {
    throw new PromptError(`Unknown craft tool: ${String(id)}`, "NOT_FOUND", 404);
  }
  return CRAFT_TOOLS[id];
}

export function listCraftTools(): CraftToolDefinition[] {
  return CRAFT_TOOL_IDS.map((id) => CRAFT_TOOLS[id]);
}

/** Public catalog shape for the editor (no prompt bodies needed to render the form). */
export function toCraftToolDto(tool: CraftToolDefinition) {
  return {
    id: tool.id,
    name: tool.name,
    summary: tool.summary,
    contract: tool.contract,
    defaults: tool.defaults,
    allowedContextSlices: [...tool.allowedContextSlices],
  };
}
