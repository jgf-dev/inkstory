import { createOpenRouterProvider, type OpenRouterProviderOptions } from "./openrouter";
import { ProviderError, type LlmProvider, type ProviderId } from "./types";

export * from "./types";
export { createOpenRouterProvider, OPENROUTER_DEFAULT_BASE_URL } from "./openrouter";

export const SUPPORTED_PROVIDERS: readonly ProviderId[] = ["openrouter"];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}

export type ProviderConfig = { provider: "openrouter" } & OpenRouterProviderOptions;

/**
 * Build a provider from an author's BYOK configuration. Later adapters
 * (OpenAI, Anthropic, local runtimes) register here as new union members.
 */
export function createProvider(config: ProviderConfig): LlmProvider {
  switch (config.provider) {
    case "openrouter":
      return createOpenRouterProvider(config);
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
