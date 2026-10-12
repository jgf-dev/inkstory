import {
  ProviderError,
  redactSecret,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type FinishReason,
  type LlmProvider,
  type ProviderErrorCode,
  type ProviderModel,
  type TokenUsage,
} from "./types";

/**
 * OpenAI adapter (STO-1176). Talks to the Chat Completions and Models APIs
 * with the author's own key.
 *
 * https://platform.openai.com/docs/api-reference/chat
 */

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

export interface OpenAIProviderOptions {
  /** The author's own OpenAI key. Never logged or returned. */
  apiKey: string;
  baseUrl?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

interface OpenAIChoice {
  message?: { content?: unknown };
  finish_reason?: unknown;
}

interface OpenAIChatResponse {
  id?: unknown;
  model?: unknown;
  choices?: OpenAIChoice[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
  error?: { message?: unknown; code?: unknown; type?: unknown };
}

const FINISH_REASONS: Record<string, FinishReason> = {
  stop: "stop",
  length: "length",
  content_filter: "content_filter",
  tool_calls: "tool_calls",
  error: "error",
};

function toFinishReason(value: unknown): FinishReason {
  return typeof value === "string" ? (FINISH_REASONS[value] ?? "unknown") : "unknown";
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toUsage(usage: OpenAIChatResponse["usage"]): TokenUsage | null {
  if (!usage) return null;
  const inputTokens = toCount(usage.prompt_tokens);
  const outputTokens = toCount(usage.completion_tokens);
  const total = toCount(usage.total_tokens);
  return { inputTokens, outputTokens, totalTokens: total || inputTokens + outputTokens };
}

export function errorCodeForStatus(status: number): ProviderErrorCode {
  if (status === 400 || status === 422) return "INVALID_REQUEST";
  if (status === 401 || status === 403) return "AUTH_FAILED";
  if (status === 402) return "INSUFFICIENT_CREDITS";
  if (status === 404) return "MODEL_UNAVAILABLE";
  if (status === 408) return "TIMEOUT";
  if (status === 429) return "RATE_LIMITED";
  return "UPSTREAM_ERROR";
}

function validateRequest(request: ChatCompletionRequest): void {
  if (!request.model?.trim()) {
    throw new ProviderError("A model id is required", "INVALID_REQUEST", "openai");
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new ProviderError("At least one message is required", "INVALID_REQUEST", "openai");
  }
  if (request.maxOutputTokens !== undefined) {
    if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0) {
      throw new ProviderError(
        "maxOutputTokens must be a positive integer",
        "INVALID_REQUEST",
        "openai",
      );
    }
  }
}

export function createOpenAIProvider(options: OpenAIProviderOptions): LlmProvider {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new ProviderError("An OpenAI API key is required", "AUTH_FAILED", "openai");
  }
  const baseUrl = (options.baseUrl ?? OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;

  function headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
  }

  function safe(text: string): string {
    return redactSecret(text, apiKey as string);
  }

  function transportError(err: unknown, prefix: string, status?: number): ProviderError {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      return new ProviderError("OpenAI request was aborted", "TIMEOUT", "openai", status);
    }
    const detail = err instanceof Error ? err.message : String(err);
    return new ProviderError(safe(`${prefix}: ${detail}`), "NETWORK_ERROR", "openai", status);
  }

  async function send(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, { ...init, headers: headers() });
    } catch (err) {
      throw transportError(err, "Could not reach OpenAI");
    }

    let body: unknown = null;
    let raw: string;
    try {
      raw = await response.text();
    } catch (err) {
      throw transportError(err, "Could not read OpenAI response", response.status);
    }
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        if (response.ok) {
          throw new ProviderError(
            "OpenAI returned a non-JSON response",
            "INVALID_RESPONSE",
            "openai",
            response.status,
          );
        }
      }
    }

    if (!response.ok) {
      const upstream = (body as OpenAIChatResponse | null)?.error?.message;
      const message =
        typeof upstream === "string" && upstream
          ? upstream
          : `OpenAI request failed with status ${response.status}`;
      throw new ProviderError(
        safe(message),
        errorCodeForStatus(response.status),
        "openai",
        response.status,
      );
    }
    return body;
  }

  return {
    id: "openai",

    async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
      validateRequest(request);
      const payload: Record<string, unknown> = {
        model: request.model,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      };
      if (request.maxOutputTokens !== undefined) payload.max_tokens = request.maxOutputTokens;
      if (request.temperature !== undefined) payload.temperature = request.temperature;
      if (request.topP !== undefined) payload.top_p = request.topP;
      if (request.stop?.length) payload.stop = request.stop;

      const body = (await send("/chat/completions", {
        method: "POST",
        body: JSON.stringify(payload),
        signal: request.signal,
      })) as OpenAIChatResponse | null;

      if (body?.error) {
        const msg = typeof body.error.message === "string" ? body.error.message : "Upstream error";
        throw new ProviderError(safe(msg), "UPSTREAM_ERROR", "openai", 200);
      }

      const choice = body?.choices?.[0];
      const text = choice?.message?.content;
      if (typeof text !== "string") {
        throw new ProviderError(
          "OpenAI response did not include a completion",
          "INVALID_RESPONSE",
          "openai",
          200,
        );
      }

      return {
        providerId: "openai",
        model: typeof body?.model === "string" ? body.model : request.model,
        text,
        finishReason: toFinishReason(choice?.finish_reason),
        usage: toUsage(body?.usage),
        id: typeof body?.id === "string" ? body.id : null,
      };
    },

    async listModels(opts?: { signal?: AbortSignal }): Promise<ProviderModel[]> {
      const body = (await send("/models", { method: "GET", signal: opts?.signal })) as {
        data?: Array<{ id?: unknown; owned_by?: unknown }>;
      } | null;
      if (!Array.isArray(body?.data)) {
        throw new ProviderError(
          "OpenAI model list was malformed",
          "INVALID_RESPONSE",
          "openai",
          200,
        );
      }
      return body.data
        .filter((m): m is { id: string; owned_by?: unknown } => typeof m?.id === "string")
        .map((m) => ({
          id: m.id,
          name: m.id,
          contextLength: null,
        }));
    },
  };
}
