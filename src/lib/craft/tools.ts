/**
 * Code-owned Craft Studio tool registry (STO-1266 scaffold, STO-1267 Describe,
 * STO-1268 Expand, STO-1269 Rewrite, STO-1270 Show Don't Tell, STO-1271 Transition,
 * STO-1272 Brainstorm).
 *
 * Each tool is a built-in reusable Prompt Component: a validated STO-1275
 * contract (declared craft inputs, context slices, output behavior) plus
 * system/user bodies rendered through the same closed-catalog interpolation
 * as scene Generate. No tables: tools live in code. The remaining v1 tools
 * (Brainstorm) register here in EL build order.
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

export const CRAFT_TOOL_IDS = [
  "describe",
  "expand",
  "rewrite",
  "show_dont_tell",
  "transition",
  "brainstorm",
] as const;
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

/** Default output-length target for the Show Don't Tell replacement prose (words). */
export const SHOW_DONT_TELL_DEFAULT_TARGET_WORDS = 200;

/**
 * Section markers the Show Don't Tell output must use. The diagnosis is shown
 * to the author; only the text after the rewrite marker is ever applyable.
 */
export const DIAGNOSIS_MARKER = "DIAGNOSIS:";
export const REWRITE_MARKER = "REWRITE:";

/** Code-owned Brainstorm kinds (EL 2026-11-08 registry: names / twists / dialogue). */
export const BRAINSTORM_KINDS = ["names", "plot_twists", "dialogue"] as const;
export type BrainstormKind = (typeof BRAINSTORM_KINDS)[number];

/** Prompt guidance per Brainstorm kind. */
export const BRAINSTORM_KIND_GUIDANCE: Record<BrainstormKind, string> = {
  names:
    "names for the characters, places, ships, organizations or things the brief asks for, fitting the setting's cultures, era and tone",
  plot_twists:
    "plot-twist ideas that grow out of facts and open threads already in the story, each a possibility for the author to consider, not something that has happened",
  dialogue:
    "alternative lines or short exchanges of dialogue for this moment, each in the speaking characters' established voices",
};

export const BRAINSTORM_DEFAULT_KIND: BrainstormKind = "names";
/** Default number of alternatives returned. */
export const BRAINSTORM_DEFAULT_COUNT = 5;
/** Default length target per option (words); total budget scales with the count. */
export const BRAINSTORM_DEFAULT_TARGET_WORDS = 40;
/** Placeholder rendered when the author brainstorms without a selection. */
export const BRAINSTORM_NO_SELECTION = "(No passage selected.)";

const CRAFT_SYSTEM_BODY = [
  "You are a skilled fiction craft assistant embedded in InkStory, a novel-writing workspace.",
  "Story: {{novel.title}} — {{chapter.title}} / {{scene.title}}.",
  "Write in {{scene.pov}} and {{scene.tense}} tense, matching the author's established voice, diction and pacing.",
  "Story bible entries that apply to this scene are provided below. Respect their facts and current state; never contradict them.",
  "Return prose only — no headings, no commentary, no markdown fences.",
  "",
  "{{codex.context}}",
].join("\n");

const CONTINUITY_LINES = [
  'Author guidance:\n"""\n{{craft.instructions}}\n"""',
  "",
  "Surrounding scene, for continuity only (do not rewrite it):",
  '"""',
  "{{scene.content}}",
  '"""',
];

/** A labelled, triple-quoted prompt block for one interpolated value. */
function quoted(label: string, placeholder: string): string[] {
  return ["", label, '"""', placeholder, '"""'];
}

/** Shared optional length-target input; bounds differ per tool. */
function targetWordsInput(min: number, max: number) {
  return {
    key: "craft.target_words",
    type: "integer",
    required: false,
    label: "Target length (words)",
    min,
    max,
  } as const;
}

/** Shared optional free-text guidance input. */
function instructionsInput(label = "Extra guidance") {
  return {
    key: "craft.instructions",
    type: "text",
    required: false,
    label,
    maxLength: 1000,
  } as const;
}

const SELECTION_INPUT = {
  key: "craft.selection",
  type: "text",
  required: true,
  label: "Selected prose",
} as const;

const DESCRIBE_USER_BODY = [
  "Rewrite the selected passage so it is rich in concrete sensory description.",
  'Sensory focus: {{craft.sensory_focus}} ("any" means choose the senses that best serve the moment).',
  "Keep every event, action, line of dialogue and story fact from the selection. Add texture, not plot: do not introduce new characters, events or revelations.",
  "Aim for roughly {{craft.target_words}} words.",
  "",
  ...CONTINUITY_LINES,
  ...quoted("Selected passage to describe:", "{{craft.selection}}"),
].join("\n");

const EXPAND_USER_BODY = [
  "Expand the selected passage by deepening its atmosphere and the point-of-view character's inner monologue.",
  "Slow the moment down: layer in mood, setting and sensory atmosphere, and the viewpoint character's thoughts, feelings, memories and reactions, rendered in the scene's point of view.",
  "Keep every event, action, line of dialogue and story fact from the selection, in the same order. Expand what is there, not the plot: do not introduce new characters, events or revelations, and do not move the story past the end of the selection.",
  "Aim for roughly {{craft.target_words}} words in total.",
  "",
  ...CONTINUITY_LINES,
  ...quoted("Selected passage to expand:", "{{craft.selection}}"),
].join("\n");

const REWRITE_USER_BODY = [
  "Rewrite the selected passage according to the chosen preset and the author's guidance.",
  "Rewrite preset: {{craft.rewrite_preset}}. Preset meanings:",
  ...REWRITE_PRESETS.map((preset) => `- ${preset}: ${REWRITE_PRESET_GUIDANCE[preset]}.`),
  "When the author's guidance below asks for something specific, follow it; it takes priority over the preset.",
  "Keep every event, action, line of dialogue and story fact from the selection, in the same order. Change how it is told, not what happens: do not introduce new characters, events or revelations.",
  "Aim for roughly {{craft.target_words}} words.",
  "",
  ...CONTINUITY_LINES,
  ...quoted("Selected passage to rewrite:", "{{craft.selection}}"),
].join("\n");

const SHOW_DONT_TELL_USER_BODY = [
  "Find where the selected passage tells the reader what a character feels, thinks or is like (named emotions, stated traits, summarized reactions) instead of showing it.",
  "Then rewrite the passage so those moments are shown through observable action, gesture, physical reaction, dialogue or concrete detail filtered through the point-of-view character.",
  "Keep every event, line of dialogue and story fact from the selection, in the same order. Do not introduce new characters, events or revelations. Leave lines that already show untouched.",
  "Aim for roughly {{craft.target_words}} words in the rewrite.",
  "",
  'Author guidance:\n"""\n{{craft.instructions}}\n"""',
  "",
  "For this tool the format below replaces the prose-only rule: the diagnosis is shown to the author and only the rewrite can be applied to the manuscript.",
  "Answer in exactly this format and nothing else:",
  `${DIAGNOSIS_MARKER}`,
  "- One short bullet per instance of telling: quote the telling words, then name what could show it instead. At most five bullets. If nothing is told, write a single bullet saying so.",
  `${REWRITE_MARKER}`,
  "The rewritten passage only, as plain prose, with no commentary, headings or quotation marks around it.",
  "",
  "Surrounding scene, for continuity only (do not rewrite it):",
  '"""',
  "{{scene.content}}",
  '"""',
  "",
  "Selected passage:",
  '"""',
  "{{craft.selection}}",
  '"""',
].join("\n");

const BRAINSTORM_USER_BODY = [
  "Brainstorm distinct alternatives the author can choose from.",
  "Kind: {{craft.brainstorm_kind}}. Kinds:",
  ...BRAINSTORM_KINDS.map((kind) => `- ${kind}: ${BRAINSTORM_KIND_GUIDANCE[kind]}.`),
  "Make every option genuinely different from the others in approach, not a rewording. Stay consistent with the story bible and the scene summary.",
  "Each option is only a suggestion: nothing you propose becomes part of the story unless the author picks it.",
  "Keep each option to roughly {{craft.target_words}} words or fewer.",
  "",
  'Author brief:\n"""\n{{craft.instructions}}\n"""',
  "",
  "For this tool the format below replaces the prose-only rule.",
  "Answer with exactly {{craft.brainstorm_count}} options as a numbered list (1., 2., 3., ...), one option per number, and nothing else: no introduction, no closing remarks, no headings.",
  "",
  "Scene summary:",
  '"""',
  "{{scene.summary}}",
  '"""',
  "",
  "Selected passage the options should fit (may be empty):",
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
      SELECTION_INPUT,
      {
        key: "craft.sensory_focus",
        type: "enum",
        required: false,
        label: "Sensory focus",
        options: [...SENSORY_FOCUS_OPTIONS],
      },
      targetWordsInput(10, 1000),
      instructionsInput(),
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
    inputs: [SELECTION_INPUT, targetWordsInput(20, 2000), instructionsInput()],
    contextSlices: [...DESCRIBE.contract.contextSlices],
    output: { mode: "prose", suggestedAction: "replace_selection" },
    attribution: null,
  },
  parts: [
    { role: "system", body: CRAFT_SYSTEM_BODY, name: "craft-expand-system" },
    { role: "user", body: EXPAND_USER_BODY, name: "craft-expand-user" },
  ],
  allowedContextSlices: DESCRIBE.allowedContextSlices,
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
      SELECTION_INPUT,
      {
        key: "craft.rewrite_preset",
        type: "enum",
        required: false,
        label: "Preset",
        options: [...REWRITE_PRESETS],
      },
      targetWordsInput(10, 2000),
      instructionsInput("Custom instructions"),
    ],
    contextSlices: [...DESCRIBE.contract.contextSlices],
    output: { mode: "prose", suggestedAction: "replace_selection" },
    attribution: null,
  },
  parts: [
    { role: "system", body: CRAFT_SYSTEM_BODY, name: "craft-rewrite-system" },
    { role: "user", body: REWRITE_USER_BODY, name: "craft-rewrite-user" },
  ],
  allowedContextSlices: DESCRIBE.allowedContextSlices,
  defaults: {
    "craft.rewrite_preset": REWRITE_DEFAULT_PRESET,
    "craft.target_words": REWRITE_DEFAULT_TARGET_WORDS,
    "craft.instructions": "None.",
  },
});

const SHOW_DONT_TELL = defineTool({
  id: "show_dont_tell",
  name: "Show Don't Tell",
  summary:
    "Spot where the selected prose tells instead of shows, and propose observable actions or reactions.",
  contract: {
    schemaVersion: 1,
    inputs: [
      { key: "craft.selection", type: "text", required: true, label: "Selected prose" },
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
    output: { mode: "diagnosis_and_prose", suggestedAction: "replace_selection" },
    attribution: null,
  },
  parts: [
    { role: "system", body: CRAFT_SYSTEM_BODY, name: "craft-show-dont-tell-system" },
    { role: "user", body: SHOW_DONT_TELL_USER_BODY, name: "craft-show-dont-tell-user" },
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
    "craft.target_words": SHOW_DONT_TELL_DEFAULT_TARGET_WORDS,
    "craft.instructions": "None.",
  },
});

/** Default output-length target for Transition bridges (words). */
export const TRANSITION_DEFAULT_TARGET_WORDS = 150;

const TRANSITION_USER_BODY = [
  "Write a short bridging passage that connects the end of the BEFORE passage to the start of the AFTER passage, as scene or chapter glue.",
  "Carry any shift in time, place, point of view or mood smoothly so the reader arrives at the AFTER passage oriented and in the right emotional register.",
  "Do not repeat, summarize or rewrite either passage. Do not introduce new plot events, characters or revelations: the bridge only connects what is already there.",
  "Aim for roughly {{craft.target_words}} words.",
  "",
  ...CONTINUITY_LINES,
  ...quoted("BEFORE passage (the bridge starts where this ends):", "{{craft.before_passage}}"),
  ...quoted("AFTER passage (the bridge must lead into this):", "{{craft.after_passage}}"),
].join("\n");

const TRANSITION = defineTool({
  id: "transition",
  name: "Transition",
  summary: "Bridge two passages with connective prose that carries time, place, POV and mood.",
  contract: {
    schemaVersion: 1,
    inputs: [
      { key: "craft.before_passage", type: "text", required: true, label: "Passage before" },
      { key: "craft.after_passage", type: "text", required: true, label: "Passage after" },
      targetWordsInput(10, 1000),
      instructionsInput(),
    ],
    contextSlices: DESCRIBE.contract.contextSlices.filter((slice) => slice !== "selection"),
    output: { mode: "prose", suggestedAction: "insert_between" },
    attribution: null,
  },
  parts: [
    { role: "system", body: CRAFT_SYSTEM_BODY, name: "craft-transition-system" },
    { role: "user", body: TRANSITION_USER_BODY, name: "craft-transition-user" },
  ],
  allowedContextSlices: DESCRIBE.allowedContextSlices,
  defaults: {
    "craft.target_words": TRANSITION_DEFAULT_TARGET_WORDS,
    "craft.instructions": "None.",
  },
});

const BRAINSTORM = defineTool({
  id: "brainstorm",
  name: "Brainstorm",
  summary:
    "Get distinct name, plot-twist or dialogue options to pick from; nothing is applied on its own.",
  contract: {
    schemaVersion: 1,
    inputs: [
      {
        key: "craft.brainstorm_kind",
        type: "enum",
        required: false,
        label: "Brainstorm",
        options: [...BRAINSTORM_KINDS],
      },
      {
        key: "craft.brainstorm_count",
        type: "integer",
        required: false,
        label: "How many",
        min: 2,
        max: 10,
      },
      { key: "craft.instructions", type: "text", required: false, label: "Brief", maxLength: 1000 },
      { key: "craft.selection", type: "text", required: false, label: "Selected prose (optional)" },
      {
        key: "craft.target_words",
        type: "integer",
        required: false,
        label: "Words per option",
        min: 1,
        max: 200,
      },
    ],
    contextSlices: [
      "selection",
      "scene.summary",
      "scene.title",
      "scene.pov",
      "scene.tense",
      "chapter.title",
      "novel.title",
      "codex.context",
    ],
    output: { mode: "options", suggestedAction: "copy_only" },
    attribution: null,
  },
  parts: [
    { role: "system", body: CRAFT_SYSTEM_BODY, name: "craft-brainstorm-system" },
    { role: "user", body: BRAINSTORM_USER_BODY, name: "craft-brainstorm-user" },
  ],
  allowedContextSlices: DESCRIBE.allowedContextSlices,
  defaults: {
    "craft.brainstorm_kind": BRAINSTORM_DEFAULT_KIND,
    "craft.brainstorm_count": BRAINSTORM_DEFAULT_COUNT,
    "craft.instructions": "None.",
    "craft.selection": BRAINSTORM_NO_SELECTION,
    "craft.target_words": BRAINSTORM_DEFAULT_TARGET_WORDS,
  },
});

const CRAFT_TOOLS: Record<CraftToolId, CraftToolDefinition> = {
  describe: DESCRIBE,
  expand: EXPAND,
  rewrite: REWRITE,
  show_dont_tell: SHOW_DONT_TELL,
  transition: TRANSITION,
  brainstorm: BRAINSTORM,
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
