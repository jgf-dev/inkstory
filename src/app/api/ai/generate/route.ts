import { NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { handleCodexApiError } from "@/lib/codex/errors";
import { assembleCodexContextForScene } from "@/lib/codex/service";
import { formatAssembledContext } from "@/lib/codex/prompt-formatter";
import { applyTokenBudget } from "@/lib/codex/token-budgeter";
import { getEntitlements, resolveContextTokenBudget } from "@/lib/billing/entitlements";
import { getSceneForEditor } from "@/lib/writing/service";
import { POV_LABELS, TENSE_LABELS } from "@/lib/writing/meta";
import {
  AiError,
  DEFAULT_MAX_OUTPUT_TOKENS,
  generateText,
  handleAiApiError,
  isGenerationMode,
  MAX_OUTPUT_TOKENS,
} from "@/lib/ai/generate";
import { PromptError, handlePromptApiError, renderResolvedScenePrompt } from "@/lib/prompts";
import {
  ByokCryptoError,
  CredentialError,
  createProviderFromCredential,
  handleCredentialApiError,
} from "@/lib/ai/credentials";
import { ProviderError } from "@/lib/ai/providers";

export const dynamic = "force-dynamic";

/**
 * Generates scene prose from the assembled Codex context. When the gateway is
 * not configured and no stored credential is selected, responds 503
 * `AI_NOT_CONFIGURED` **with the assembled prompt** so the author can still copy it into any LLM (zero cost path).
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
      /** Client-side current prose; overrides the stored scene content. */
      content?: string;
      maxTokens?: number;
      /** Explicit opt-in to an owned stored credential; omitted means platform gateway. */
      credentialId?: string;
      /** Provider-specific model ID, required only for BYOK. */
      model?: string;
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
    if (body.content !== undefined && typeof body.content !== "string") {
      return Response.json(
        { error: "content must be a string", code: "VALIDATION_FAILED" },
        { status: 400 },
      );
    }
    if (
      body.maxTokens !== undefined &&
      (typeof body.maxTokens !== "number" ||
        !Number.isInteger(body.maxTokens) ||
        body.maxTokens <= 0 ||
        body.maxTokens > MAX_OUTPUT_TOKENS)
    ) {
      return Response.json(
        {
          error: `maxTokens must be a positive integer up to ${MAX_OUTPUT_TOKENS}`,
          code: "VALIDATION_FAILED",
        },
        { status: 400 },
      );
    }

    if (
      (body.credentialId !== undefined &&
        (typeof body.credentialId !== "string" ||
          !body.credentialId.trim() ||
          body.credentialId.length > 128)) ||
      (body.credentialId !== undefined &&
        (typeof body.model !== "string" || !body.model.trim() || body.model.length > 256)) ||
      (body.credentialId === undefined && body.model !== undefined)
    ) {
      return Response.json(
        {
          error: "BYOK requires a credentialId and provider-specific model (up to 256 characters)",
          code: "VALIDATION_FAILED",
        },
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

    const prose = body.content !== undefined ? body.content : scene.content;

    const assembled = await assembleCodexContextForScene(user.id, {
      sceneId: scene.id,
      novelId: scene.novelId,
      beatText: body.beatText || scene.summary || undefined,
      recentProse: prose || undefined,
    });
    const { maxContextTokens } = await getEntitlements(user.id);
    const prompt = formatAssembledContext(
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
      codexPrompt: prompt,
    });

    if (rendered.unresolved.length || rendered.unknownTokens.length) {
      throw new PromptError(
        `Prompt has unresolved variables: ${[...rendered.unresolved, ...rendered.unknownTokens].join(", ")}`,
        "UNRESOLVED_VARS",
        422,
      );
    }

    const messages = rendered.messages;

    if (body.credentialId === undefined && !process.env.AI_GATEWAY_API_KEY) {
      return Response.json(
        {
          error: "AI generation is not configured on this deployment (missing AI_GATEWAY_API_KEY)",
          code: "AI_NOT_CONFIGURED",
          prompt: { system: messages[0]?.content ?? "", user: messages[1]?.content ?? "" },
          messages,
          joined: rendered.joined,
        },
        { status: 503 },
      );
    }

    // Never silently fall back to platform spend when an explicit credential fails.
    const provider =
      body.credentialId !== undefined
        ? await createProviderFromCredential(user.id, body.credentialId)
        : null;
    const result = provider
      ? await provider.chat({
          model: body.model!.trim(),
          messages,
          maxOutputTokens: body.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          temperature: 0.7,
          signal: request.signal,
        })
      : await generateText({ messages, maxTokens: body.maxTokens, signal: request.signal });

    return Response.json({ text: result.text, model: result.model });
  } catch (err) {
    if (err instanceof CredentialError || err instanceof ByokCryptoError) {
      return handleCredentialApiError(err);
    }
    if (err instanceof ProviderError) {
      // No upstream text/config in responses, even if a vendor echoes request details.
      return Response.json(
        { error: "Selected provider generation failed", code: err.code },
        { status: err.code === "INVALID_REQUEST" ? 400 : 502 },
      );
    }
    if (err instanceof AiError) {
      return handleAiApiError(err);
    }
    if (err instanceof PromptError) {
      return handlePromptApiError(err);
    }
    return handleCodexApiError(err);
  }
}
