/**
 * Scene AI generation (launch phase 3). Calls the Vercel AI Gateway
 * (OpenAI-compatible `/v1/chat/completions`) with the assembled Codex context
 * embedded in the system message.
 *
 * Cost safety: the gateway client is lazily built from `AI_GATEWAY_API_KEY`.
 * With no key configured (dev/CI), generation answers 503 `AI_NOT_CONFIGURED`
 * and the route still returns the fully assembled prompt so the author can
 * copy it into any LLM — no spend can occur without explicit configuration.
 */

import { renderDefaultScenePrompt } from "@/lib/prompts/render";

export const DEFAULT_AI_MODEL = "anthropic/claude-sonnet-4.6";
export const DEFAULT_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";

/** Default completion cap for a single generation request. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

/** Hard upper bound on completion tokens per request (model output limit). */
export const MAX_OUTPUT_TOKENS = 4096;

export type GenerationMode = "continuation" | "beat_expansion";

export const GENERATION_MODES: readonly GenerationMode[] = ["continuation", "beat_expansion"];

export function isGenerationMode(value: unknown): value is GenerationMode {
  return typeof value === "string" && (GENERATION_MODES as readonly string[]).includes(value);
}

export class AiError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "AI_NOT_CONFIGURED"
      | "AI_GATEWAY_ERROR"
      | "AI_INVALID_RESPONSE"
      | "SCENE_EXCLUDED_FROM_AI",
    public readonly status: number = 500,
  ) {
    super(message);
    this.name = "AiError";
  }
}

/** Standard AI error handler mirroring `handleCodexApiError`. */
export function handleAiApiError(err: unknown): Response {
  if (err instanceof SyntaxError) {
    return Response.json(
      { error: "Malformed or invalid JSON body", code: "INVALID_JSON" },
      { status: 400 },
    );
  }
  if (err instanceof AiError) {
    return Response.json({ error: err.message, code: err.code }, { status: err.status });
  }
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY);
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface BuildScenePromptInput {
  mode: GenerationMode;
  novelTitle: string;
  chapterTitle: string;
  sceneTitle: string;
  povLabel: string;
  tenseLabel: string;
  sceneContent: string;
  summary: string | null;
  beatText?: string | null;
  /** Formatted `<codex_context>` XML block from the context assembler. */
  codexPrompt: string;
  maxContentChars?: number;
}

/**
 * Builds the chat messages for a scene generation request. Pure so prompt
 * construction is unit-testable without any network access.
 *
 * @deprecated Prefer `renderResolvedScenePrompt` / `renderDefaultScenePrompt`
 * from `@/lib/prompts` (STO-1158). This wrapper keeps the historical signature
 * and delegates to the shared renderer + SYSTEM_DEFAULT templates.
 */
export function buildSceneMessages(input: BuildScenePromptInput): ChatMessage[] {
  const rendered = renderDefaultScenePrompt(input);
  return rendered.messages;
}

/** Re-export for callers that still reference the old constant. */
export const DEFAULT_MAX_CONTENT_CHARS_FOR_PROMPT = 8000;

/** Internal default temperature, sent only where the resolved route accepts it. */
export const DEFAULT_TEMPERATURE = 0.7;

/** Model the platform gateway will be called with. */
export function resolveGatewayModel(): string {
  return process.env.AI_MODEL || DEFAULT_AI_MODEL;
}

export interface GenerateTextOptions {
  messages: ChatMessage[];
  maxTokens?: number;
  /**
   * Sampling temperature. Omitted → {@link DEFAULT_TEMPERATURE}; `null` →
   * not sent (for models that reject sampling parameters, STO-1265).
   */
  temperature?: number | null;
  signal?: AbortSignal;
}

interface GatewayChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

/**
 * Calls the AI Gateway chat-completions endpoint and returns the completion
 * text. Throws `AiError` (503) when no key is configured.
 */
export async function generateText(
  options: GenerateTextOptions,
): Promise<{ text: string; model: string }> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new AiError(
      "AI generation is not configured on this deployment (missing AI_GATEWAY_API_KEY)",
      "AI_NOT_CONFIGURED",
      503,
    );
  }

  if (
    options.maxTokens !== undefined &&
    (!Number.isInteger(options.maxTokens) ||
      options.maxTokens <= 0 ||
      options.maxTokens > MAX_OUTPUT_TOKENS)
  ) {
    throw new TypeError(`maxTokens must be a positive integer up to ${MAX_OUTPUT_TOKENS}`);
  }

  const baseUrl = (process.env.AI_GATEWAY_BASE_URL || DEFAULT_AI_GATEWAY_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const model = resolveGatewayModel();
  const temperature = options.temperature === undefined ? DEFAULT_TEMPERATURE : options.temperature;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        max_tokens: options.maxTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        ...(temperature === null ? {} : { temperature }),
        stream: false,
      }),
      signal: options.signal,
    });
  } catch (err) {
    throw new AiError(
      `AI gateway request failed: ${err instanceof Error ? err.message : "network error"}`,
      "AI_GATEWAY_ERROR",
      502,
    );
  }

  if (!response.ok) {
    let detail = `status ${response.status}`;
    try {
      const body = (await response.json()) as GatewayChatResponse;
      if (body?.error?.message) {
        detail = body.error.message;
      }
    } catch {
      // Non-JSON error body; keep the status-based detail.
    }
    throw new AiError(`AI gateway request failed (${detail})`, "AI_GATEWAY_ERROR", 502);
  }

  let payload: GatewayChatResponse;
  try {
    payload = (await response.json()) as GatewayChatResponse;
  } catch {
    throw new AiError("AI gateway returned an unparseable response", "AI_INVALID_RESPONSE", 502);
  }

  const text = payload.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new AiError("AI gateway returned an empty completion", "AI_INVALID_RESPONSE", 502);
  }

  return { text, model };
}
