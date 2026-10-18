import { createTransportError, readJsonResponse } from "./http";
import {
  ProviderError,
  redactSecret,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type FinishReason,
  type LlmProvider,
  type ProviderChatMessage,
  type ProviderErrorCode,
  type ProviderModel,
  type TokenUsage,
} from "./types";

/**
 * Anthropic adapter (STO-1176). Maps the shared chat shape onto Anthropic's
 * Messages API (system as a top-level field, user/assistant turns only,
 * content blocks) so callers never see the wire format.
 *
 * https://docs.anthropic.com/en/api/messages
 */

export const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
export const ANTHROPIC_DEFAULT_VERSION = "2023-06-01";
/** Anthropic requires `max_tokens`; used when the caller omits maxOutputTokens. */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 4096;

export interface AnthropicProviderOptions {
  /** The author's own Anthropic key. Never logged or returned. */
  apiKey: string;
  baseUrl?: string;
  /** Sent as `anthropic-version`. Defaults to {@link ANTHROPIC_DEFAULT_VERSION}. */
  apiVersion?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

interface AnthropicContentBlock {
  type?: unknown;
  text?: unknown;
}

interface AnthropicMessagesResponse {
  id?: unknown;
  model?: unknown;
  content?: AnthropicContentBlock[];
  stop_reason?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
  error?: { message?: unknown; type?: unknown };
  type?: unknown;
}

const STOP_REASONS: Record<string, FinishReason> = {
  end_turn: "stop",
  stop_sequence: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
  refusal: "content_filter",
};

function toFinishReason(value: unknown): FinishReason {
  return typeof value === "string" ? (STOP_REASONS[value] ?? "unknown") : "unknown";
}

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toUsage(usage: AnthropicMessagesResponse["usage"]): TokenUsage | null {
  if (!usage) return null;
  const inputTokens = toCount(usage.input_tokens);
  const outputTokens = toCount(usage.output_tokens);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
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
    throw new ProviderError("A model id is required", "INVALID_REQUEST", "anthropic");
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new ProviderError("At least one message is required", "INVALID_REQUEST", "anthropic");
  }
  if (request.maxOutputTokens !== undefined) {
    if (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0) {
      throw new ProviderError(
        "maxOutputTokens must be a positive integer",
        "INVALID_REQUEST",
        "anthropic",
      );
    }
  }
}

/**
 * Split system prompts out and collapse consecutive same-role turns so the
 * payload satisfies Anthropic's alternating user/assistant constraint.
 */
export function toAnthropicMessages(messages: ProviderChatMessage[]): {
  system: string | undefined;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemParts: string[] = [];
  const turns: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const message of messages) {
    if (message.role === "system") {
      systemParts.push(message.content);
      continue;
    }
    const last = turns[turns.length - 1];
    if (last && last.role === message.role) {
      last.content = `${last.content}\n\n${message.content}`;
    } else {
      turns.push({ role: message.role, content: message.content });
    }
  }

  if (turns.length === 0) {
    throw new ProviderError(
      "Anthropic requires at least one user or assistant message",
      "INVALID_REQUEST",
      "anthropic",
    );
  }

  // Anthropic requires the first message to be from the user.
  if (turns[0].role !== "user") {
    turns.unshift({ role: "user", content: "(continued)" });
  }

  return {
    system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: turns,
  };
}

function extractText(content: AnthropicContentBlock[] | undefined): string | null {
  if (!Array.isArray(content) || content.length === 0) return null;
  const parts: string[] = [];
  for (const block of content) {
    if (block?.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    }
  }
  return parts.length > 0 ? parts.join("") : null;
}

export function createAnthropicProvider(options: AnthropicProviderOptions): LlmProvider {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new ProviderError("An Anthropic API key is required", "AUTH_FAILED", "anthropic");
  }
  const baseUrl = (options.baseUrl ?? ANTHROPIC_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const apiVersion = options.apiVersion ?? ANTHROPIC_DEFAULT_VERSION;
  const doFetch = options.fetch ?? globalThis.fetch;

  function headers(): Record<string, string> {
    return {
      "x-api-key": apiKey as string,
      "anthropic-version": apiVersion,
      "Content-Type": "application/json",
    };
  }

  function safe(text: string): string {
    return redactSecret(text, apiKey as string);
  }

  async function send(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, { ...init, headers: headers() });
    } catch (err) {
      throw createTransportError(
        err,
        "Could not reach Anthropic",
        "Anthropic",
        "anthropic",
        apiKey,
      );
    }

    const body = await readJsonResponse(response, "Anthropic", "anthropic", apiKey);

    if (!response.ok) {
      const typed = body as AnthropicMessagesResponse | null;
      const upstream = typed?.error?.message;
      const message =
        typeof upstream === "string" && upstream
          ? upstream
          : `Anthropic request failed with status ${response.status}`;
      throw new ProviderError(
        safe(message),
        errorCodeForStatus(response.status),
        "anthropic",
        response.status,
      );
    }
    return body;
  }

  return {
    id: "anthropic",

    async chat(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
      validateRequest(request);
      const mapped = toAnthropicMessages(request.messages);
      const payload: Record<string, unknown> = {
        model: request.model,
        messages: mapped.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        max_tokens: request.maxOutputTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
        stream: false,
      };
      if (mapped.system !== undefined) payload.system = mapped.system;
      if (request.temperature !== undefined) payload.temperature = request.temperature;
      if (request.topP !== undefined) payload.top_p = request.topP;
      if (request.stop?.length) payload.stop_sequences = request.stop;

      const body = (await send("/messages", {
        method: "POST",
        body: JSON.stringify(payload),
        signal: request.signal,
      })) as AnthropicMessagesResponse | null;

      // Anthropic can return an error-shaped JSON body even on some 2xx paths;
      // also guard against `type: "error"` envelopes.
      if (body?.error || body?.type === "error") {
        const msg = typeof body.error?.message === "string" ? body.error.message : "Upstream error";
        throw new ProviderError(safe(msg), "UPSTREAM_ERROR", "anthropic", 200);
      }

      const text = extractText(body?.content);
      if (text === null) {
        throw new ProviderError(
          "Anthropic response did not include a completion",
          "INVALID_RESPONSE",
          "anthropic",
          200,
        );
      }

      return {
        providerId: "anthropic",
        model: typeof body?.model === "string" ? body.model : request.model,
        text,
        finishReason: toFinishReason(body?.stop_reason),
        usage: toUsage(body?.usage),
        id: typeof body?.id === "string" ? body.id : null,
      };
    },

    async listModels(opts?: { signal?: AbortSignal }): Promise<ProviderModel[]> {
      const body = (await send("/models", { method: "GET", signal: opts?.signal })) as {
        data?: Array<{ id?: unknown; display_name?: unknown; max_tokens?: unknown }>;
      } | null;
      if (!Array.isArray(body?.data)) {
        throw new ProviderError(
          "Anthropic model list was malformed",
          "INVALID_RESPONSE",
          "anthropic",
          200,
        );
      }
      return body.data
        .filter(
          (m): m is { id: string; display_name?: unknown; max_tokens?: unknown } =>
            typeof m?.id === "string",
        )
        .map((m) => ({
          id: m.id,
          name: typeof m.display_name === "string" ? m.display_name : m.id,
          // Anthropic's catalog does not expose context length in the list payload.
          contextLength: null,
        }));
    },
  };
}
