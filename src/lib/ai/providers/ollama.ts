import { createOpenAICompatibleProvider } from "./openai-compatible";
import type { LlmProvider } from "./types";

/**
 * Ollama adapter (STO-1177). Ollama serves an OpenAI-compatible API under
 * `/v1`, so local models are listed via `/v1/models` and called via
 * `/v1/chat/completions`. Ollama does not require a key; one is only sent
 * when the author configured it (e.g. behind an authenticating proxy).
 *
 * https://github.com/ollama/ollama/blob/main/docs/openai.md
 */

export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434/v1";

export interface OllamaProviderOptions {
  /** Optional; Ollama ignores it unless a proxy in front of it checks one. */
  apiKey?: string;
  baseUrl?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export function createOllamaProvider(options: OllamaProviderOptions = {}): LlmProvider {
  return createOpenAICompatibleProvider({
    providerId: "ollama",
    label: "Ollama",
    apiKey: options.apiKey,
    baseUrl: options.baseUrl?.trim() || OLLAMA_DEFAULT_BASE_URL,
    includeBaseUrlInNetworkErrors: true,
    fetch: options.fetch,
  });
}
