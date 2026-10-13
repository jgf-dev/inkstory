import { createAnthropicProvider, type AnthropicProviderOptions } from "./anthropic";
import { createLMStudioProvider, type LMStudioProviderOptions } from "./lmstudio";
import { createOllamaProvider, type OllamaProviderOptions } from "./ollama";
import { createOpenAIProvider, type OpenAIProviderOptions } from "./openai";
import { createOpenRouterProvider, type OpenRouterProviderOptions } from "./openrouter";
import { ProviderError, type LlmProvider, type ProviderId } from "./types";

export * from "./types";
export {
  ANTHROPIC_DEFAULT_BASE_URL,
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  ANTHROPIC_DEFAULT_VERSION,
  createAnthropicProvider,
  toAnthropicMessages,
} from "./anthropic";
export { createLMStudioProvider, LMSTUDIO_DEFAULT_BASE_URL } from "./lmstudio";
export { createOllamaProvider, OLLAMA_DEFAULT_BASE_URL } from "./ollama";
export { createOpenAIProvider, OPENAI_DEFAULT_BASE_URL } from "./openai";
export { createOpenAICompatibleProvider } from "./openai-compatible";
export { createOpenRouterProvider, OPENROUTER_DEFAULT_BASE_URL } from "./openrouter";

export const SUPPORTED_PROVIDERS: readonly ProviderId[] = [
  "openrouter",
  "openai",
  "anthropic",
  "ollama",
  "lmstudio",
];

/** Providers that run on the author's machine and need no API key. */
export const LOCAL_PROVIDERS: readonly ProviderId[] = ["ollama", "lmstudio"];

export function isLocalProvider(id: ProviderId): boolean {
  return LOCAL_PROVIDERS.includes(id);
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

export type ProviderConfig =
  | ({ provider: "openrouter" } & OpenRouterProviderOptions)
  | ({ provider: "openai" } & OpenAIProviderOptions)
  | ({ provider: "anthropic" } & AnthropicProviderOptions)
  | ({ provider: "ollama" } & OllamaProviderOptions)
  | ({ provider: "lmstudio" } & LMStudioProviderOptions);

/**
 * Build a provider from an author's BYOK configuration. New adapters
 * register here as new union members.
 */
export function createProvider(config: ProviderConfig): LlmProvider {
  switch (config.provider) {
    case "openrouter":
      return createOpenRouterProvider(config);
    case "openai":
      return createOpenAIProvider(config);
    case "anthropic":
      return createAnthropicProvider(config);
    case "ollama":
      return createOllamaProvider(config);
    case "lmstudio":
      return createLMStudioProvider(config);
    default: {
      const unknown: string = (config as { provider: string }).provider;
      throw new ProviderError(
        `Unsupported provider: ${unknown}`,
        "INVALID_REQUEST",
        unknown as ProviderId,
      );
    }
  }
}
