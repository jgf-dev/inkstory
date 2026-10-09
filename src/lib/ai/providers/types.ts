/**
 * BYOK provider layer (STO-1175 / 4.2.1).
 *
 * Every model provider (OpenRouter, OpenAI, Anthropic, local runtimes) is
 * exposed to the rest of the app through this one interface, so generation
 * code never depends on a vendor SDK or wire format. Adapters receive the
 * author's own API key at construction time and must never echo it back in
 * errors, logs, or responses.
 */

export type ProviderId = "openrouter";

export type ChatRole = "system" | "user" | "assistant";

export interface ProviderChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionRequest {
  /** Provider-specific model id, e.g. `anthropic/claude-sonnet-4.6` on OpenRouter. */
  model: string;
  messages: ProviderChatMessage[];
  /** Upper bound on generated tokens. */
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  stop?: string[];
  /** Abort an in-flight request (e.g. when the author cancels generation). */
  signal?: AbortSignal;
}

export type FinishReason =
  | "stop"
  | "length"
  | "content_filter"
  | "tool_calls"
  | "error"
  | "unknown";

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ChatCompletionResult {
  providerId: ProviderId;
  /** Model that actually served the request (may differ from the requested alias). */
  model: string;
  text: string;
  finishReason: FinishReason;
  usage: TokenUsage | null;
  /** Upstream generation id, useful for cost lookups and support tickets. */
  id: string | null;
}

export interface ProviderModel {
  id: string;
  name: string;
  contextLength: number | null;
}

export interface LlmProvider {
  readonly id: ProviderId;
  chat(request: ChatCompletionRequest): Promise<ChatCompletionResult>;
  listModels(options?: { signal?: AbortSignal }): Promise<ProviderModel[]>;
}

export type ProviderErrorCode =
  | "INVALID_REQUEST"
  | "AUTH_FAILED"
  | "INSUFFICIENT_CREDITS"
  | "RATE_LIMITED"
  | "MODEL_UNAVAILABLE"
  | "UPSTREAM_ERROR"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "INVALID_RESPONSE";

/**
 * Normalized provider failure. `message` is always safe to show the author:
 * adapters must build it from upstream error text with the API key redacted.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: ProviderErrorCode,
    public readonly providerId: ProviderId,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }

  /** Whether retrying the same request later may succeed. */
  get retryable(): boolean {
    return (
      this.code === "RATE_LIMITED" ||
      this.code === "UPSTREAM_ERROR" ||
      this.code === "NETWORK_ERROR" ||
      this.code === "TIMEOUT"
    );
  }
}

/** Replace every occurrence of `secret` in `text` so keys can't leak via error strings. */
export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join("[REDACTED]");
}
