import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handleCodexApiError } from "@/lib/codex/errors";
import { assembleSceneContext } from "@/lib/codex/service";
import { getSceneForEditor } from "@/lib/writing/service";
import { POV_LABELS, TENSE_LABELS } from "@/lib/writing/meta";
import {
  AiError,
  buildSceneMessages,
  generateText,
  handleAiApiError,
  isGenerationMode,
} from "@/lib/ai/generate";

export const dynamic = "force-dynamic";

/**
 * Generates scene prose from the assembled Codex context. When the gateway is
 * not configured, responds 503 `AI_NOT_CONFIGURED` **with the assembled
 * prompt** so the author can still copy it into any LLM (zero cost path).
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
      maxTokens?: number;
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
    if (body.beatText !== undefined && typeof body.beatText !== "string") {
      return Response.json(
        { error: "beatText must be a string", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }

    const scene = await getSceneForEditor(user.id, body.sceneId);
    if (scene.excludeFromAi) {
      throw new AiError(
        "This scene is excluded from AI assistance (exclude_from_ai is on)",
        "SCENE_EXCLUDED_FROM_AI",
        403,
      );
    }

    const { prompt } = await assembleSceneContext(user.id, {
      sceneId: scene.id,
      beatText: body.beatText || scene.summary || undefined,
      recentProse: scene.content || undefined,
    });

    const messages = buildSceneMessages({
      mode: body.mode,
      novelTitle: scene.novelTitle,
      chapterTitle: scene.chapterTitle,
      sceneTitle: scene.title,
      povLabel: POV_LABELS[scene.pov],
      tenseLabel: TENSE_LABELS[scene.tense],
      sceneContent: scene.content,
      summary: scene.summary,
      beatText: body.beatText,
      codexPrompt: prompt,
    });

    if (!process.env.AI_GATEWAY_API_KEY) {
      return Response.json(
        {
          error: "AI generation is not configured on this deployment (missing AI_GATEWAY_API_KEY)",
          code: "AI_NOT_CONFIGURED",
          prompt: { system: messages[0].content, user: messages[1].content },
        },
        { status: 503 },
      );
    }

    const result = await generateText({
      messages,
      maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : undefined,
    });

    return Response.json({ text: result.text, model: result.model });
  } catch (err) {
    if (err instanceof AiError) {
      return handleAiApiError(err);
    }
    return handleCodexApiError(err);
  }
}
