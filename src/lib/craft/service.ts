/**
 * Craft Studio request preparation (STO-1266 scaffold). Loads the scene,
 * validates craft inputs against the tool contract, reads only the declared
 * context slices and renders the built-in component. Providers are called by
 * the route through the shared executeChat path.
 */

import { AiError } from "@/lib/ai/generate";
import { getEntitlements, resolveContextTokenBudget } from "@/lib/billing/entitlements";
import { formatAssembledContext } from "@/lib/codex/prompt-formatter";
import { assembleCodexContextForScene } from "@/lib/codex/service";
import { applyTokenBudget } from "@/lib/codex/token-budgeter";
import type { ContextSlice, ContractOutput, CraftInputBindings } from "@/lib/prompts/contracts";
import { buildSceneBindings } from "@/lib/prompts/render";
import type { RenderedPrompt } from "@/lib/prompts/types";
import { POV_LABELS, TENSE_LABELS } from "@/lib/writing/meta";
import { getSceneForEditor } from "@/lib/writing/service";
import {
  contractReadsSlice,
  filterBindingsBySlices,
  maxTokensForTargetWords,
  renderCraftPrompt,
  resolveToolInputs,
} from "./prompt";
import { getCraftTool, type CraftToolId } from "./tools";

export interface CraftRequestInput {
  sceneId: string;
  /** Raw craft input values keyed by registered craft input key. */
  inputs?: unknown;
  /** Client-side current prose; overrides the stored scene content. */
  content?: string;
}

export interface PreparedCraftPrompt {
  tool: CraftToolId;
  sceneId: string;
  messages: RenderedPrompt["messages"];
  joined: string;
  /** Completion budget derived from craft.target_words (undefined = default). */
  maxTokens: number | undefined;
  output: ContractOutput | null;
  contextSlices: ContextSlice[];
  inputs: CraftInputBindings;
}

export async function prepareCraftPrompt(
  userId: string,
  toolId: unknown,
  input: CraftRequestInput,
): Promise<PreparedCraftPrompt> {
  const tool = getCraftTool(toolId);
  // Inputs are validated before any scene lookup or context assembly.
  const craftInputs = resolveToolInputs(tool, input.inputs);

  const scene = await getSceneForEditor(userId, input.sceneId);
  if (scene.excludeFromAi) {
    throw new AiError(
      "This scene is excluded from AI assistance (exclude_from_ai is on)",
      "SCENE_EXCLUDED_FROM_AI",
      403,
    );
  }
  const prose = input.content !== undefined ? input.content : scene.content;

  let codexPrompt = "";
  if (contractReadsSlice(tool.contract, "codex.context")) {
    const assembled = await assembleCodexContextForScene(userId, {
      sceneId: scene.id,
      novelId: scene.novelId,
      beatText: craftInputs["craft.selection"] || scene.summary || undefined,
      recentProse: prose || undefined,
    });
    const { maxContextTokens } = await getEntitlements(userId);
    codexPrompt = formatAssembledContext(
      applyTokenBudget(assembled, {
        maxTokens: resolveContextTokenBudget(undefined, maxContextTokens),
      }),
    );
  }

  const bindings = filterBindingsBySlices(
    buildSceneBindings({
      mode: tool.id,
      novelTitle: scene.novelTitle,
      chapterTitle: scene.chapterTitle,
      sceneTitle: scene.title,
      povLabel: POV_LABELS[scene.pov],
      tenseLabel: TENSE_LABELS[scene.tense],
      sceneContent: prose,
      summary: scene.summary,
      codexPrompt,
    }),
    tool.contract.contextSlices,
  );
  const rendered = renderCraftPrompt(tool, bindings, craftInputs);
  const targetWords = craftInputs["craft.target_words"];

  return {
    tool: tool.id,
    sceneId: scene.id,
    messages: rendered.messages,
    joined: rendered.joined,
    maxTokens: maxTokensForTargetWords(targetWords ? Number(targetWords) : undefined),
    output: tool.contract.output,
    contextSlices: [...tool.contract.contextSlices],
    inputs: craftInputs,
  };
}
