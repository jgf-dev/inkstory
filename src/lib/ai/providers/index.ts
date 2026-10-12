import { createAnthropicProvider, type AnthropicProviderOptions } from "./anthropic";
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
export { createOpenAIProvider, OPENAI_DEFAULT_BASE_URL } from "./openai";
export { createOpenRouterProvider, OPENROUTER_DEFAULT_BASE_URL } from "./openrouter";

export const SUPPORTED_PROVIDERS: readonly ProviderId[] = ["openrouter", "openai", "anthropic"];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

export type ProviderConfig =
  | ({ provider: "openrouter" } & OpenRouterProviderOptions)
  | ({ provider: "openai" } & OpenAIProviderOptions)
  | ({ provider: "anthropic" } & AnthropicProviderOptions);

/**
 * Build a provider from an author's BYOK configuration. Later adapters
 * (local runtimes) register here as new union members.
 */
export function createProvider(config: ProviderConfig): LlmProvider {
  switch (config.provider) {
    case "openrouter":
      return createOpenRouterProvider(config);
    case "openai":
      return createOpenAIProvider(config);
    case "anthropic":
      return createAnthropicProvider(config);
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
