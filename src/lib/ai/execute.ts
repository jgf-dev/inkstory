/**
 * Shared chat execution for scene Generate and Craft tools (STO-1266).
 *
 * Runs already-rendered messages through either the platform gateway or an
 * explicitly selected stored BYOK credential, with the same capability gating
 * and `applied` metadata as the original Generate route. Never falls back to
 * platform spend when an explicit credential fails.
 */

import {
  CapabilityError,
  assertControlsSupported,
  buildAppliedMetadata,
  handleCapabilityApiError,
  needsCatalog,
  resolveCapabilities,
  type AdvancedControlsRequest,
  type AppliedGenerationMetadata,
  type CapabilityProfile,
} from "@/lib/ai/capabilities";
import {
  ByokCryptoError,
  CredentialError,
  createProviderFromCredential,
  getCredential,
  handleCredentialApiError,
  providerIdFromName,
} from "@/lib/ai/credentials";
import { isCustomOpenRouterBaseUrl, ProviderError } from "@/lib/ai/providers";
import { handleCodexApiError } from "@/lib/codex/errors";
import { PromptError, handlePromptApiError } from "@/lib/prompts/errors";
import {
  AiError,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_TEMPERATURE,
  generateText,
  handleAiApiError,
  resolveGatewayModel,
  type ChatMessage,
} from "./generate";

export interface ChatExecutionRequest {
  messages: ChatMessage[];
  /** Explicit opt-in to an owned stored credential; omitted means platform gateway. */
  credentialId?: string;
  /** Provider-specific model ID, required with credentialId. */
  model?: string;
  maxTokens?: number;
  /** Already shape-checked advanced controls (STO-1265). */
  controls?: AdvancedControlsRequest;
  guidanceIncluded?: boolean;
  /** Platform profile resolved during preflight, to avoid a second lookup. */
  platformProfile?: CapabilityProfile | null;
  signal?: AbortSignal;
}

export interface ChatExecutionResult {
  text: string;
  model: string;
  applied: AppliedGenerationMetadata;
}

/** Validates the BYOK pair; returns an error message or null. */
export function byokSelectionError(body: {
  credentialId?: unknown;
  model?: unknown;
}): string | null {
  const { credentialId, model } = body;
  if (
    (credentialId !== undefined &&
      (typeof credentialId !== "string" || !credentialId.trim() || credentialId.length > 128)) ||
    (credentialId !== undefined &&
      (typeof model !== "string" || !model.trim() || model.length > 256)) ||
    (credentialId === undefined && model !== undefined)
  ) {
    return "BYOK requires a credentialId and provider-specific model (up to 256 characters)";
  }
  return null;
}

/** Platform-gateway profile, or null for a BYOK request. */
export async function resolvePlatformProfile(
  credentialId: string | undefined,
): Promise<CapabilityProfile | null> {
  if (credentialId !== undefined) return null;
  return resolveCapabilities({ provider: "platform-gateway", model: resolveGatewayModel() });
}

/** True when the request would use the platform gateway but no key is configured. */
export function platformUnconfigured(credentialId: string | undefined): boolean {
  return credentialId === undefined && !process.env.AI_GATEWAY_API_KEY;
}

export async function executeChat(
  userId: string,
  request: ChatExecutionRequest,
): Promise<ChatExecutionResult> {
  const controls = request.controls ?? {};
  const guidanceIncluded = request.guidanceIncluded ?? false;
  const maxTokens = request.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;

  if (request.credentialId === undefined) {
    const profile =
      request.platformProfile ??
      (await resolveCapabilities({ provider: "platform-gateway", model: resolveGatewayModel() }));
    assertControlsSupported(controls, profile);
    const temperature = profile.controls.temperature.usable ? DEFAULT_TEMPERATURE : undefined;
    const result = await generateText({
      messages: request.messages,
      maxTokens: request.maxTokens,
      temperature: temperature ?? null,
      signal: request.signal,
    });
    return {
      text: result.text,
      model: result.model,
      applied: buildAppliedMetadata({
        provider: "platform-gateway",
        requestedModel: profile.route.model,
        servedModel: result.model,
        maxTokens,
        temperature,
        guidanceIncluded,
      }),
    };
  }

  // Gate controls on stored credential metadata only (no decrypt, no DNS).
  // resolveProviderConfig's SSRF lookup must not run first, or an
  // unresolvable custom OpenRouter base would 400 before the 422.
  const model = (request.model ?? "").trim();
  const credentialId = request.credentialId.trim();
  const credential = await getCredential(userId, credentialId);
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
  const provider = await createProviderFromCredential(userId, credentialId);

  const result = await provider.chat({
    model,
    messages: request.messages,
    maxOutputTokens: maxTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(controls.minP !== undefined ? { minP: controls.minP } : {}),
    ...(controls.endpoint !== undefined ? { endpoint: controls.endpoint } : {}),
    signal: request.signal,
  });

  return {
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
  };
}

/** Error mapping shared by every route that calls executeChat. */
export function handleGenerationApiError(err: unknown): Response {
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
