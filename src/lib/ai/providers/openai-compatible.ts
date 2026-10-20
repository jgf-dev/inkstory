import { createTransportError, readJsonResponse } from "./http";
import {
  ProviderError,
  redactSecret,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type FinishReason,
  type LlmProvider,
  type ProviderErrorCode,
  type ProviderId,
  type ProviderModel,
  type TokenUsage,
} from "./types";

/**
 * Shared client for providers that speak the OpenAI Chat Completions and Models
 * wire format: OpenRouter, OpenAI, and local runtimes (Ollama, LM Studio).
 */

export interface OpenAICompatibleProviderOptions {
  providerId: ProviderId;
  /** Human-readable name used in error messages, e.g. "OpenAI" or "OpenRouter". */
  label: string;
  baseUrl: string;
  /**
   * Bearer token. Hosted vendors require one; local runtimes usually don't,
   * so an empty key simply omits the Authorization header.
   */
  apiKey?: string;
  /** Extra headers sent with every request, e.g. OpenRouter attribution. */
  headers?: Record<string, string>;
  /** Mention the base URL in connection errors (useful for local servers). */
  includeBaseUrlInNetworkErrors?: boolean;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

interface ChatChoice {
  message?: { content?: unknown };
  finish_reason?: unknown;
}

interface ChatResponse {
  id?: unknown;
  model?: unknown;
  choices?: ChatChoice[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
  /** OpenAI/OpenRouter/Ollama send an object; some LM Studio errors are a bare string. */
  error?: string | { message?: unknown; code?: unknown; type?: unknown };
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

function toUsage(usage: ChatResponse["usage"]): TokenUsage | null {
  if (!usage) return null;
  const inputTokens = toCount(usage.prompt_tokens);
  const outputTokens = toCount(usage.completion_tokens);
  const total = toCount(usage.total_tokens);
  return { inputTokens, outputTokens, totalTokens: total || inputTokens + outputTokens };
}

function errorMessage(error: ChatResponse["error"]): string | null {
  if (typeof error === "string") return error || null;
  const message = error?.message;
  return typeof message === "string" && message ? message : null;
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

function validateRequest(
  request: ChatCompletionRequest,
  providerId: OpenAICompatibleProviderOptions["providerId"],
): void {
  if (!request.model?.trim()) {
    throw new ProviderError("A model id is required", "INVALID_REQUEST", providerId);
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new ProviderError("At least one message is required", "INVALID_REQUEST", providerId);
  }
  if (request.maxOutputTokens !== undefined) {
    if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0) {
      throw new ProviderError(
        "maxOutputTokens must be a positive integer",
        "INVALID_REQUEST",
        providerId,
      );
    }
  }
}

export function createOpenAICompatibleProvider(
  options: OpenAICompatibleProviderOptions,
): LlmProvider {
  const { providerId, label } = options;
  const apiKey = options.apiKey?.trim() ?? "";
  const baseUrl = options.baseUrl.trim().replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch;
  const reachTarget = options.includeBaseUrlInNetworkErrors ? `${label} at ${baseUrl}` : label;

  function headers(): Record<string, string> {
    const result: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    };
    if (apiKey) result.Authorization = `Bearer ${apiKey}`;
    return result;
  }

  function safe(text: string): string {
    return redactSecret(text, apiKey);
  }

  async function send(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, { ...init, headers: headers() });
    } catch (err) {
      throw createTransportError(err, `Could not reach ${reachTarget}`, label, providerId, apiKey);
    }

    const body = await readJsonResponse(response, label, providerId, apiKey);

    if (!response.ok) {
      const message =
        errorMessage((body as ChatResponse | null)?.error) ??
        `${label} request failed with status ${response.status}`;
      throw new ProviderError(
        safe(message),
        errorCodeForStatus(response.status),
        providerId,
        response.status,
      );
    }
    return body;
  }

  return {
    id: providerId,

    async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
      validateRequest(request, providerId);
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
      })) as ChatResponse | null;

      if (body?.error) {
        throw new ProviderError(
          safe(errorMessage(body.error) ?? "Upstream error"),
          "UPSTREAM_ERROR",
          providerId,
          200,
        );
      }

      const choice = body?.choices?.[0];
      const text = choice?.message?.content;
      if (typeof text !== "string") {
        throw new ProviderError(
          `${label} response did not include a completion`,
          "INVALID_RESPONSE",
          providerId,
          200,
        );
      }

      return {
        providerId,
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
          `${label} model list was malformed`,
          "INVALID_RESPONSE",
          providerId,
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
