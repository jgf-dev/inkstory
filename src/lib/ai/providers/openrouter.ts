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
 * OpenRouter adapter (STO-1175). OpenRouter speaks the OpenAI-compatible
 * chat completions protocol and fronts hundreds of models behind one key,
 * which makes it the highest-leverage first BYOK provider.
 *
 * https://openrouter.ai/docs/api-reference/chat-completion
 */

export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

export interface OpenRouterProviderOptions {
  /** The author's own OpenRouter key. Never logged or returned. */
  apiKey: string;
  baseUrl?: string;
  /** Sent as `HTTP-Referer` so OpenRouter can attribute traffic to the app. */
  appUrl?: string;
  /** Sent as `X-Title`. */
  appTitle?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

interface OpenRouterChoice {
  message?: { content?: unknown };
  finish_reason?: unknown;
}

interface OpenRouterChatResponse {
  id?: unknown;
  model?: unknown;
  choices?: OpenRouterChoice[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
  error?: { message?: unknown; code?: unknown };
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

function toUsage(usage: OpenRouterChatResponse["usage"]): TokenUsage | null {
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
    throw new ProviderError("A model id is required", "INVALID_REQUEST", "openrouter");
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new ProviderError("At least one message is required", "INVALID_REQUEST", "openrouter");
  }
  if (request.maxOutputTokens !== undefined) {
    if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0) {
      throw new ProviderError(
        "maxOutputTokens must be a positive integer",
        "INVALID_REQUEST",
        "openrouter",
      );
    }
  }
}

export function createOpenRouterProvider(options: OpenRouterProviderOptions): LlmProvider {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new ProviderError("An OpenRouter API key is required", "AUTH_FAILED", "openrouter");
  }
  const baseUrl = (options.baseUrl ?? OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;

  function headers(): Record<string, string> {
    const h: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };
    if (options.appUrl) h["HTTP-Referer"] = options.appUrl;
    if (options.appTitle) h["X-Title"] = options.appTitle;
    return h;
  }

  function safe(text: string): string {
    return redactSecret(text, apiKey as string);
  }

  function transportError(err: unknown, prefix: string, status?: number): ProviderError {
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      return new ProviderError("OpenRouter request was aborted", "TIMEOUT", "openrouter", status);
    }
    const detail = err instanceof Error ? err.message : String(err);
    return new ProviderError(safe(`${prefix}: ${detail}`), "NETWORK_ERROR", "openrouter", status);
  }

  async function send(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, { ...init, headers: headers() });
    } catch (err) {
      throw transportError(err, "Could not reach OpenRouter");
    }

    let body: unknown = null;
    let raw: string;
    try {
      raw = await response.text();
    } catch (err) {
      throw transportError(err, "Could not read OpenRouter response", response.status);
    }
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        if (response.ok) {
          throw new ProviderError(
            "OpenRouter returned a non-JSON response",
            "INVALID_RESPONSE",
            "openrouter",
            response.status,
          );
        }
      }
    }

    if (!response.ok) {
      const upstream = (body as OpenRouterChatResponse | null)?.error?.message;
      const message =
        typeof upstream === "string" && upstream
          ? upstream
          : `OpenRouter request failed with status ${response.status}`;
      throw new ProviderError(
        safe(message),
        errorCodeForStatus(response.status),
        "openrouter",
        response.status,
      );
    }
    return body;
  }

  return {
    id: "openrouter",

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
      })) as OpenRouterChatResponse | null;

      // OpenRouter can return 200 with an `error` object when the upstream model fails mid-flight.
      if (body?.error) {
        const msg = typeof body.error.message === "string" ? body.error.message : "Upstream error";
        throw new ProviderError(safe(msg), "UPSTREAM_ERROR", "openrouter", 200);
      }

      const choice = body?.choices?.[0];
      const text = choice?.message?.content;
      if (typeof text !== "string") {
        throw new ProviderError(
          "OpenRouter response did not include a completion",
          "INVALID_RESPONSE",
          "openrouter",
          200,
        );
      }

      return {
        providerId: "openrouter",
        model: typeof body?.model === "string" ? body.model : request.model,
        text,
        finishReason: toFinishReason(choice?.finish_reason),
        usage: toUsage(body?.usage),
        id: typeof body?.id === "string" ? body.id : null,
      };
    },

    async listModels(opts?: { signal?: AbortSignal }): Promise<ProviderModel[]> {
      const body = (await send("/models", { method: "GET", signal: opts?.signal })) as {
        data?: Array<{ id?: unknown; name?: unknown; context_length?: unknown }>;
      } | null;
      if (!Array.isArray(body?.data)) {
        throw new ProviderError(
          "OpenRouter model list was malformed",
          "INVALID_RESPONSE",
          "openrouter",
          200,
        );
      }
      return body.data
        .filter(
          (m): m is { id: string; name?: unknown; context_length?: unknown } =>
            typeof m?.id === "string",
        )
        .map((m) => ({
          id: m.id,
          name: typeof m.name === "string" ? m.name : m.id,
          contextLength:
            typeof m.context_length === "number" && Number.isFinite(m.context_length)
              ? m.context_length
              : null,
        }));
    },
  };
}
