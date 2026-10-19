import { createOpenAICompatibleProvider, errorCodeForStatus } from "./openai-compatible";
import { ProviderError, type LlmProvider } from "./types";

export { errorCodeForStatus };

/**
 * OpenRouter adapter (STO-1175). Speaks the OpenAI-compatible chat completions
 * and models protocol and fronts hundreds of models behind one key.
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

export function createOpenRouterProvider(options: OpenRouterProviderOptions): LlmProvider {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) {
    throw new ProviderError("An OpenRouter API key is required", "AUTH_FAILED", "openrouter");
  }
  const headers: Record<string, string> = {};
  if (options.appUrl) headers["HTTP-Referer"] = options.appUrl;
  if (options.appTitle) headers["X-Title"] = options.appTitle;

  return createOpenAICompatibleProvider({
    providerId: "openrouter",
    label: "OpenRouter",
    apiKey,
    baseUrl: options.baseUrl?.trim() || OPENROUTER_DEFAULT_BASE_URL,
    headers,
    fetch: options.fetch,
  });
}
