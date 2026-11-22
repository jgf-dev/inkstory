import { ProviderError, type ChatCompletionRequest, type ProviderId } from "./types";

/**
 * Adapter-side defense for STO-1265 advanced controls. The capability resolver
 * already rejects unsupported controls before any spend; this guard makes sure
 * an adapter that has no verified mapping can never silently drop (or blindly
 * forward) a requested native sampler.
 */
export function assertAdvancedControlsMappable(
  request: ChatCompletionRequest,
  providerId: ProviderId,
  label: string,
  mapped: boolean,
): void {
  if (request.minP !== undefined) {
    if (!mapped) {
      throw new ProviderError(
        `Min-P is not available for ${label} in inkstory`,
        "INVALID_REQUEST",
        providerId,
      );
    }
    if (
      typeof request.minP !== "number" ||
      !Number.isFinite(request.minP) ||
      request.minP < 0 ||
      request.minP > 1
    ) {
      throw new ProviderError("minP must be a number from 0 to 1", "INVALID_REQUEST", providerId);
    }
  }
  if (request.endpoint !== undefined) {
    if (!mapped) {
      throw new ProviderError(
        `Endpoint routing is not available for ${label} in inkstory`,
        "INVALID_REQUEST",
        providerId,
      );
    }
    if (typeof request.endpoint !== "string" || !request.endpoint.trim()) {
      throw new ProviderError("endpoint must be a non-empty string", "INVALID_REQUEST", providerId);
    }
  }
}

/**
 * OpenRouter `min_p` + `provider` routing. `require_parameters: true` keeps
 * OpenRouter from routing a Min-P request to an endpoint that would ignore it.
 */
export function applyOpenRouterAdvanced(
  payload: Record<string, unknown>,
  request: ChatCompletionRequest,
): void {
  const provider: Record<string, unknown> = {};
  if (request.minP !== undefined) {
    payload.min_p = request.minP;
    provider.require_parameters = true;
  }
  if (request.endpoint !== undefined) {
    provider.only = [request.endpoint.trim()];
    provider.allow_fallbacks = false;
  }
  if (Object.keys(provider).length) payload.provider = provider;
}
