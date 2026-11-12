import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handleCodexApiError } from "@/lib/codex/errors";
import { assembleCodexContextForScene } from "@/lib/codex/service";
import { formatAssembledContext } from "@/lib/codex/prompt-formatter";
import { applyTokenBudget } from "@/lib/codex/token-budgeter";
import { getEntitlements, resolveContextTokenBudget } from "@/lib/billing/entitlements";
import { getSceneForEditor } from "@/lib/writing/service";
import { POV_LABELS, TENSE_LABELS } from "@/lib/writing/meta";
import { AiError, handleAiApiError, isGenerationMode } from "@/lib/ai/generate";
import { PromptError, handlePromptApiError, renderResolvedScenePrompt } from "@/lib/prompts";
import {
  CapabilityError,
  applyAvoidanceGuidance,
  handleCapabilityApiError,
  joinPromptMessages,
  parseAdvancedControls,
} from "@/lib/ai/capabilities";

export const dynamic = "force-dynamic";

/**
 * Prompt Preview (STO-1158): returns the exact messages[] Generate will send,
 * plus a joined debug string. No provider call; never returns keys.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      sceneId?: string;
      mode?: string;
      beatText?: string;
      content?: string;
      /** STO-1265: rendered exactly as Generate will send it. */
      avoidanceGuidance?: string;
    };

    if (typeof body.sceneId !== "string" || !body.sceneId) {
      return Response.json(
        { error: "Missing required string 'sceneId'", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }
    if (!isGenerationMode(body.mode)) {
      return Response.json(
        { error: "mode must be 'continuation' or 'beat_expansion'", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }

    // Same shape rules as Generate so Preview never shows a block Generate would reject.
    const controls = parseAdvancedControls(body as Record<string, unknown>);

    const scene = await getSceneForEditor(user.id, body.sceneId);
    if (scene.excludeFromAi) {
      throw new AiError(
        "This scene is excluded from AI assistance (exclude_from_ai is on)",
        "SCENE_EXCLUDED_FROM_AI",
        403,
      );
    }

    const prose = body.content !== undefined ? body.content : scene.content;

    const assembled = await assembleCodexContextForScene(user.id, {
      sceneId: scene.id,
      novelId: scene.novelId,
      beatText: body.beatText || scene.summary || undefined,
      recentProse: prose || undefined,
    });
    const { maxContextTokens } = await getEntitlements(user.id);
    const codexPrompt = formatAssembledContext(
      applyTokenBudget(assembled, {
        maxTokens: resolveContextTokenBudget(undefined, maxContextTokens),
      }),
    );

    const rendered = await renderResolvedScenePrompt(user.id, scene.novelId, {
      mode: body.mode,
      novelTitle: scene.novelTitle,
      chapterTitle: scene.chapterTitle,
      sceneTitle: scene.title,
      povLabel: POV_LABELS[scene.pov],
      tenseLabel: TENSE_LABELS[scene.tense],
      sceneContent: prose,
      summary: scene.summary,
      beatText: body.beatText,
      codexPrompt,
    });

    const messages = applyAvoidanceGuidance(rendered.messages, controls.avoidanceGuidance);

    return Response.json({
      messages,
      joined:
        controls.avoidanceGuidance !== undefined ? joinPromptMessages(messages) : rendered.joined,
      unresolved: rendered.unresolved,
      unknownTokens: rendered.unknownTokens,
      avoidanceGuidance: controls.avoidanceGuidance !== undefined ? "included" : "none",
      prompt: {
        id: rendered.prompt.id,
        name: rendered.prompt.name,
        scope: rendered.prompt.scope,
        mode: rendered.prompt.mode,
      },
    });
  } catch (err) {
    if (err instanceof CapabilityError) return handleCapabilityApiError(err);
    if (err instanceof AiError) return handleAiApiError(err);
    if (err instanceof PromptError) return handlePromptApiError(err);
    return handleCodexApiError(err);
  }
}
