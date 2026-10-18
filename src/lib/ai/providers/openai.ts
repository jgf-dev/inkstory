import { createOpenAICompatibleProvider } from "./openai-compatible";
import { ProviderError, type LlmProvider } from "./types";

/**
 * OpenAI adapter (STO-1176). Maps the shared chat shape onto OpenAI's
 * `/v1/chat/completions` endpoint and lists models from `/v1/models`.
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

export function createOpenAIProvider(options: OpenAIProviderOptions): LlmProvider {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new ProviderError("An OpenAI API key is required", "AUTH_FAILED", "openai");
  }

  return createOpenAICompatibleProvider({
    providerId: "openai",
    label: "OpenAI",
    apiKey,
    baseUrl: options.baseUrl?.trim() || OPENAI_DEFAULT_BASE_URL,
    fetch: options.fetch,
  });
}
