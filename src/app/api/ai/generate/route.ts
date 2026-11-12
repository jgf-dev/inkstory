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
  DEFAULT_TEMPERATURE,
  generateText,
  handleAiApiError,
  isGenerationMode,
  MAX_OUTPUT_TOKENS,
  resolveGatewayModel,
} from "@/lib/ai/generate";
import {
  CapabilityError,
  applyAvoidanceGuidance,
  assertControlsSupported,
  buildAppliedMetadata,
  handleCapabilityApiError,
  joinPromptMessages,
  needsCatalog,
  parseAdvancedControls,
  resolveCapabilities,
} from "@/lib/ai/capabilities";
import { PromptError, handlePromptApiError, renderResolvedScenePrompt } from "@/lib/prompts";
import {
  ByokCryptoError,
  CredentialError,
  createProviderFromCredential,
  getCredential,
  handleCredentialApiError,
  providerIdFromName,
} from "@/lib/ai/credentials";
import { isCustomOpenRouterBaseUrl, ProviderError } from "@/lib/ai/providers";

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
      /** STO-1265: optional Min-P (0–1); omitted ≠ 0. */
      minP?: number;
      /** STO-1265: per-request avoidance guidance (instruction-only). */
      avoidanceGuidance?: string;
      /** STO-1265: OpenRouter endpoint slug to pin. */
      endpoint?: string;
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

    // Shape-check advanced controls, and reject anything the platform route
    // can't honor, before any lookup or spend. Client capability maps are ignored.
    const controls = parseAdvancedControls(body as Record<string, unknown>);
    const platformProfile =
      body.credentialId === undefined
        ? await resolveCapabilities({ provider: "platform-gateway", model: resolveGatewayModel() })
        : null;
    if (platformProfile) assertControlsSupported(controls, platformProfile);

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

    // Same delimited guidance block the Preview route renders (STO-1265).
    const messages = applyAvoidanceGuidance(rendered.messages, controls.avoidanceGuidance);
    const guidanceIncluded = controls.avoidanceGuidance !== undefined;

    if (body.credentialId === undefined && !process.env.AI_GATEWAY_API_KEY) {
      return Response.json(
        {
          error: "AI generation is not configured on this deployment (missing AI_GATEWAY_API_KEY)",
          code: "AI_NOT_CONFIGURED",
          prompt: { system: messages[0]?.content ?? "", user: messages[1]?.content ?? "" },
          messages,
          joined: guidanceIncluded ? joinPromptMessages(messages) : rendered.joined,
        },
        { status: 503 },
      );
    }

    const maxTokens = body.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

    if (platformProfile) {
      const temperature = platformProfile.controls.temperature.usable
        ? DEFAULT_TEMPERATURE
        : undefined;
      const result = await generateText({
        messages,
        maxTokens: body.maxTokens,
        temperature: temperature ?? null,
        signal: request.signal,
      });
      return Response.json({
        text: result.text,
        model: result.model,
        applied: buildAppliedMetadata({
          provider: "platform-gateway",
          requestedModel: platformProfile.route.model,
          servedModel: result.model,
          maxTokens,
          temperature,
          guidanceIncluded,
        }),
      });
    }

    // Gate controls on stored credential metadata only (no decrypt, no DNS).
    // resolveProviderConfig's SSRF lookup must not run first, or an
    // unresolvable custom OpenRouter base would 400 before the 422.
    const model = body.model!.trim();
    const credentialId = body.credentialId!.trim();
    const credential = await getCredential(user.id, credentialId);
    const providerId = providerIdFromName(credential.provider);
    const profile = await resolveCapabilities(
      {
        provider: providerId,
        model,
        endpoint: controls.endpoint,
        customBaseUrl: providerId === "openrouter" && isCustomOpenRouterBaseUrl(credential.baseUrl),
      },
      { useCatalog: needsCatalog(controls), signal: request.signal },
    );
    // Unsupported/unknown controls fail here, before the provider is called.
    assertControlsSupported(controls, profile);
    const temperature = profile.controls.temperature.usable ? DEFAULT_TEMPERATURE : undefined;

    // Never silently fall back to platform spend when an explicit credential fails.
    const provider = await createProviderFromCredential(user.id, credentialId);

    const result = await provider.chat({
      model,
      messages,
      maxOutputTokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(controls.minP !== undefined ? { minP: controls.minP } : {}),
      ...(controls.endpoint !== undefined ? { endpoint: controls.endpoint } : {}),
      signal: request.signal,
    });

    return Response.json({
      text: result.text,
      model: result.model,
      applied: buildAppliedMetadata({
        provider: provider.id,
        requestedModel: model,
        servedModel: result.model,
        endpoint: controls.endpoint,
        maxTokens,
        temperature,
        minP: controls.minP,
        guidanceIncluded,
      }),
    });
  } catch (err) {
    if (err instanceof CapabilityError) {
      return handleCapabilityApiError(err);
    }
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
