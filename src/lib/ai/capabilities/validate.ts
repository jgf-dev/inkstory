import { MAX_AVOIDANCE_GUIDANCE_CHARS } from "./guidance";
import { CapabilityError, type AdvancedControlsRequest, type CapabilityProfile } from "./types";

/**
 * Request keys for controls inkstory does not accept in V1 (or must never take
 * from the client). Sending any of them is an explicit request we cannot
 * honor, so it is rejected before spending — never stripped and retried.
 */
const REJECTED_REQUEST_KEYS: Record<string, string> = {
  dry: "dry",
  dryMultiplier: "dry",
  dry_multiplier: "dry",
  mirostat: "mirostat",
  mirostatTau: "mirostat",
  mirostatEta: "mirostat",
  mirostat_tau: "mirostat",
  mirostat_eta: "mirostat",
  min_p: "minP",
  negativePrompt: "nativeNegativePrompt",
  negative_prompt: "nativeNegativePrompt",
  temperature: "temperature",
  topP: "topP",
  top_p: "topP",
  topK: "topK",
  top_k: "topK",
  repetitionPenalty: "repetitionPenalty",
  repetition_penalty: "repetitionPenalty",
  logitBias: "logitBias",
  logit_bias: "logitBias",
  provider: "provider",
  capabilities: "capabilities",
};

const ENDPOINT_SLUG = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9._-]+){0,3}$/i;

function unsupported(control: string, message: string): CapabilityError {
  return new CapabilityError(message, "UNSUPPORTED_CONTROL", control, 422);
}

function invalid(control: string, message: string): CapabilityError {
  return new CapabilityError(message, "VALIDATION_FAILED", control, 400);
}

/**
 * Shape-validates the advanced-control fields of a generate/preview body.
 * Throws `CapabilityError` on bad types/ranges or on rejected control keys.
 */
export function parseAdvancedControls(body: Record<string, unknown>): AdvancedControlsRequest {
  for (const key of Object.keys(body)) {
    const control = REJECTED_REQUEST_KEYS[key];
    if (!control) continue;
    if (control === "capabilities" || control === "provider") {
      throw invalid(
        control,
        `'${key}' cannot be set by the client; capabilities and routing are resolved server-side`,
      );
    }
    if (control === "minP") {
      throw invalid("minP", "Use 'minP' (0–1) rather than 'min_p'");
    }
    throw unsupported(
      control,
      `'${key}' is not an available generation control in inkstory. Remove it and try again.`,
    );
  }

  const result: AdvancedControlsRequest = {};

  if (body.minP !== undefined) {
    const value = body.minP;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      throw invalid("minP", "minP must be a number from 0 to 1 (0 turns Min-P off)");
    }
    result.minP = value;
  }

  if (body.avoidanceGuidance !== undefined) {
    const value = body.avoidanceGuidance;
    if (typeof value !== "string") {
      throw invalid("avoidanceGuidance", "avoidanceGuidance must be a string");
    }
    if (value.length > MAX_AVOIDANCE_GUIDANCE_CHARS) {
      throw invalid(
        "avoidanceGuidance",
        `avoidanceGuidance must be at most ${MAX_AVOIDANCE_GUIDANCE_CHARS} characters`,
      );
    }
    const trimmed = value.trim();
    if (trimmed) result.avoidanceGuidance = trimmed;
  }

  if (body.endpoint !== undefined) {
    const value = body.endpoint;
    if (typeof value !== "string" || value.length > 128 || !ENDPOINT_SLUG.test(value.trim())) {
      throw invalid(
        "endpoint",
        "endpoint must be an OpenRouter endpoint slug such as 'deepinfra/turbo'",
      );
    }
    result.endpoint = value.trim();
  }

  return result;
}

/** Whether a request needs endpoint-level catalog evidence. */
export function needsCatalog(controls: AdvancedControlsRequest): boolean {
  return controls.minP !== undefined || controls.endpoint !== undefined;
}

/**
 * Rejects explicitly requested controls the resolved route cannot honor.
 * Runs before any provider call so nothing is spent.
 */
export function assertControlsSupported(
  controls: AdvancedControlsRequest,
  profile: CapabilityProfile,
): void {
  if (controls.endpoint !== undefined && profile.route.provider !== "openrouter") {
    throw unsupported(
      "endpoint",
      "Endpoint selection is only available for OpenRouter credentials. Clear the endpoint.",
    );
  }
  if (controls.endpoint !== undefined && profile.route.customBaseUrl) {
    throw unsupported(
      "endpoint",
      "Endpoint selection is not available with a custom OpenRouter base URL. Clear the endpoint.",
    );
  }
  if (controls.minP !== undefined) {
    const cap = profile.controls.minP;
    if (!cap.usable) {
      throw unsupported(
        "minP",
        `Min-P is unavailable for ${profile.route.model}: ${cap.reason} Remove Min-P to generate.`,
      );
    }
  }
}
