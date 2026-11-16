/**
 * Code-owned Craft Studio tool registry (STO-1266 scaffold, STO-1267 Describe,
 * STO-1268 Expand, STO-1269 Rewrite).
 *
 * Each tool is a built-in reusable Prompt Component: a validated STO-1275
 * contract (declared craft inputs, context slices, output behavior) plus
 * system/user bodies rendered through the same closed-catalog interpolation
 * as scene Generate. No tables: tools live in code. The remaining v1 tools
 * (Show Don't Tell, Transition, Brainstorm) register here in EL build order.
 */

import {
  REWRITE_PRESETS,
  validatePromptContract,
  type ContextSlice,
  type CraftInputKey,
  type PromptComponentContract,
} from "@/lib/prompts/contracts";
import { PromptError } from "@/lib/prompts/errors";
import type { PromptPart } from "@/lib/prompts/types";

export const CRAFT_TOOL_IDS = ["describe", "expand", "rewrite"] as const;
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

/** Default output-length target for Expand (words). Expansion runs longer than Describe. */
export const EXPAND_DEFAULT_TARGET_WORDS = 300;

/** Default output-length target for Rewrite (words). */
export const REWRITE_DEFAULT_TARGET_WORDS = 200;

/** Preset applied when the author picks none (code-owned, EL 2026-11-08 registry). */
export const REWRITE_DEFAULT_PRESET: (typeof REWRITE_PRESETS)[number] = "more_vivid";

/** Prompt guidance per code-owned rewrite preset. */
export const REWRITE_PRESET_GUIDANCE: Record<(typeof REWRITE_PRESETS)[number], string> = {
  more_vivid: "make the prose more vivid: sharper verbs, concrete specific detail, stronger images",
  more_concise: "make the prose more concise: cut redundancy, filler and over-explanation",
  simpler: "make the prose simpler and clearer: plainer words, shorter sentences, easy flow",
  stronger_voice:
    "strengthen the voice: give the narration and point-of-view character more personality and distinct diction",
};

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

const EXPAND_USER_BODY = [
  "Expand the selected passage by deepening its atmosphere and the point-of-view character's inner monologue.",
  "Slow the moment down: layer in mood, setting and sensory atmosphere, and the viewpoint character's thoughts, feelings, memories and reactions, rendered in the scene's point of view.",
  "Keep every event, action, line of dialogue and story fact from the selection, in the same order. Expand what is there, not the plot: do not introduce new characters, events or revelations, and do not move the story past the end of the selection.",
  "Aim for roughly {{craft.target_words}} words in total.",
  "",
  'Author guidance:\n"""\n{{craft.instructions}}\n"""',
  "",
  "Surrounding scene, for continuity only (do not rewrite it):",
  '"""',
  "{{scene.content}}",
  '"""',
  "",
  "Selected passage to expand:",
  '"""',
  "{{craft.selection}}",
  '"""',
].join("\n");

const REWRITE_USER_BODY = [
  "Rewrite the selected passage according to the chosen preset and the author's guidance.",
  "Rewrite preset: {{craft.rewrite_preset}}. Preset meanings:",
  ...REWRITE_PRESETS.map((preset) => `- ${preset}: ${REWRITE_PRESET_GUIDANCE[preset]}.`),
  "When the author's guidance below asks for something specific, follow it; it takes priority over the preset.",
  "Keep every event, action, line of dialogue and story fact from the selection, in the same order. Change how it is told, not what happens: do not introduce new characters, events or revelations.",
  "Aim for roughly {{craft.target_words}} words.",
  "",
  'Author guidance:\n"""\n{{craft.instructions}}\n"""',
  "",
  "Surrounding scene, for continuity only (do not rewrite it):",
  '"""',
  "{{scene.content}}",
  '"""',
  "",
  "Selected passage to rewrite:",
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

const EXPAND = defineTool({
  id: "expand",
  name: "Expand",
  summary:
    "Deepen the selected prose with atmosphere and inner monologue without changing what happens.",
  contract: {
    schemaVersion: 1,
    inputs: [
      { key: "craft.selection", type: "text", required: true, label: "Selected prose" },
      {
        key: "craft.target_words",
        type: "integer",
        required: false,
        label: "Target length (words)",
        min: 20,
        max: 2000,
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
    { role: "system", body: CRAFT_SYSTEM_BODY, name: "craft-expand-system" },
    { role: "user", body: EXPAND_USER_BODY, name: "craft-expand-user" },
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
    "craft.target_words": EXPAND_DEFAULT_TARGET_WORDS,
    "craft.instructions": "None.",
  },
});

const REWRITE = defineTool({
  id: "rewrite",
  name: "Rewrite",
  summary:
    "Rewrite the selected prose with a preset or your own instructions without changing what happens.",
  contract: {
    schemaVersion: 1,
    inputs: [
      { key: "craft.selection", type: "text", required: true, label: "Selected prose" },
      {
        key: "craft.rewrite_preset",
        type: "enum",
        required: false,
        label: "Preset",
        options: [...REWRITE_PRESETS],
      },
      {
        key: "craft.target_words",
        type: "integer",
        required: false,
        label: "Target length (words)",
        min: 10,
        max: 2000,
      },
      {
        key: "craft.instructions",
        type: "text",
        required: false,
        label: "Custom instructions",
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
    { role: "system", body: CRAFT_SYSTEM_BODY, name: "craft-rewrite-system" },
    { role: "user", body: REWRITE_USER_BODY, name: "craft-rewrite-user" },
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
    "craft.rewrite_preset": REWRITE_DEFAULT_PRESET,
    "craft.target_words": REWRITE_DEFAULT_TARGET_WORDS,
    "craft.instructions": "None.",
  },
});

const CRAFT_TOOLS: Record<CraftToolId, CraftToolDefinition> = {
  describe: DESCRIBE,
  expand: EXPAND,
  rewrite: REWRITE,
};

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
