import type { CapabilityProvider } from "./types";

/**
 * Request-time "what was actually sent" metadata (STO-1265), for the result
 * UI and the Context Inspector. Contains no keys, ciphertext, base URLs or
 * prose; guidance is reported as "included", never "enforced".
 */
export interface AppliedGenerationMetadata {
  provider: CapabilityProvider;
  requestedModel: string;
  model: string;
  endpoint: string | null;
  parameters: {
    max_tokens: number;
    temperature?: number;
    min_p?: number;
  };
  routing: { requireParameters: boolean; only: string[] | null } | null;
  avoidanceGuidance: "included" | "none";
}

export function buildAppliedMetadata(input: {
  provider: CapabilityProvider;
  requestedModel: string;
  servedModel: string;
  endpoint?: string;
  maxTokens: number;
  temperature?: number;
  minP?: number;
  guidanceIncluded: boolean;
}): AppliedGenerationMetadata {
  const parameters: AppliedGenerationMetadata["parameters"] = { max_tokens: input.maxTokens };
  if (input.temperature !== undefined) parameters.temperature = input.temperature;
  if (input.minP !== undefined) parameters.min_p = input.minP;
  const routed = input.provider === "openrouter" && (input.minP !== undefined || input.endpoint);
  return {
    provider: input.provider,
    requestedModel: input.requestedModel,
    model: input.servedModel,
    endpoint: input.endpoint ?? null,
    parameters,
    routing: routed
      ? {
          requireParameters: input.minP !== undefined,
          only: input.endpoint ? [input.endpoint] : null,
        }
      : null,
    avoidanceGuidance: input.guidanceIncluded ? "included" : "none",
  };
}
