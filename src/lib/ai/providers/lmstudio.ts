import { createOpenAICompatibleProvider } from "./openai-compatible";
import type { LlmProvider } from "./types";

/**
 * LM Studio adapter (STO-1177). LM Studio's local server exposes an
 * OpenAI-compatible API under `/v1` (`/v1/models`, `/v1/chat/completions`).
 * No key is needed by default; one is sent only when the author enabled
 * authentication on the server and configured a token.
 *
 * https://lmstudio.ai/docs/app/api/endpoints/openai
 */

export const LMSTUDIO_DEFAULT_BASE_URL = "http://127.0.0.1:1234/v1";

export interface LMStudioProviderOptions {
  /** Optional API token, only needed when LM Studio server auth is enabled. */
  apiKey?: string;
  baseUrl?: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

export function createLMStudioProvider(options: LMStudioProviderOptions = {}): LlmProvider {
  return createOpenAICompatibleProvider({
    providerId: "lmstudio",
    label: "LM Studio",
    apiKey: options.apiKey,
    baseUrl: options.baseUrl?.trim() || LMSTUDIO_DEFAULT_BASE_URL,
    includeBaseUrlInNetworkErrors: true,
    fetch: options.fetch,
  });
}
