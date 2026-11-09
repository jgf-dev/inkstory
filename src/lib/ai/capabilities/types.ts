/**
 * Capability-gated advanced generation controls (STO-1265).
 *
 * Effective support is the intersection of provider, exact model, transport,
 * endpoint, and inkstory's own adapter mapping — never the model name alone.
 * Profiles are resolved server-side only; client-supplied capability maps are
 * never trusted.
 */

import type { ProviderId } from "@/lib/ai/providers/types";

/** Bumped whenever static registry facts change. */
export const CAPABILITY_REGISTRY_VERSION = 1;

export type CapabilityProvider = ProviderId | "platform-gateway";

export type CapabilityTransport = "openai-chat" | "anthropic-messages";

export type Support = "native" | "instruction-only" | "unsupported" | "unknown";

export type ControlId =
  | "minP"
  | "dry"
  | "mirostat"
  | "nativeNegativePrompt"
  | "avoidanceGuidance"
  | "temperature"
  | "maxOutputTokens";

/**
 * Why a control is (un)available. UI copy distinguishes these:
 * - `unsupported`: not supported by this API/model.
 * - `unverified`: support not verified for this route (unknown ≠ no).
 * - `not_integrated`: provider supports it; inkstory has no mapping yet.
 */
export type AvailabilityReason = "available" | "unsupported" | "unverified" | "not_integrated";

export interface NumericRange {
  min: number;
  max: number;
  /** Value that disables the sampler on the backend. */
  offValue?: number;
}

export interface ControlCapability {
  id: ControlId;
  label: string;
  support: Support;
  /** Whether inkstory maps the control onto this transport (independent of upstream support). */
  adapterImplemented: boolean;
  /** True only when the control may be requested on this route right now. */
  usable: boolean;
  availability: AvailabilityReason;
  /** Author-facing explanation (accessible text, not just a tooltip). */
  reason: string;
  numeric?: NumericRange;
}

export interface CapabilityRoute {
  provider: CapabilityProvider;
  /** Exact resolved model id. */
  model: string;
  transport: CapabilityTransport;
  /** OpenRouter endpoint slug, e.g. `deepinfra/turbo`. Never credentials. */
  endpoint: string | null;
  /** Author-configured non-default base URL (the URL itself is not kept). */
  customBaseUrl: boolean;
}

export type CapabilitySource = "static" | "catalog" | "catalog-unavailable";

export interface CapabilityProfile {
  registryVersion: number;
  route: CapabilityRoute;
  source: CapabilitySource;
  /** ISO time the endpoint catalog was observed, when it was consulted. */
  observedAt: string | null;
  /**
   * Whether the OpenRouter catalog listed the pinned endpoint: false when the
   * catalog was consulted and the endpoint is missing, true when listed,
   * undefined when no endpoint was pinned or the catalog was not consulted.
   */
  endpointListed?: boolean;
  controls: Record<ControlId, ControlCapability>;
}

export const CONTROL_LABELS: Record<ControlId, string> = {
  minP: "Min-P",
  dry: "DRY repetition penalty",
  mirostat: "Mirostat",
  nativeNegativePrompt: "Native negative prompt",
  avoidanceGuidance: "Avoidance / anti-trope guidance (instructions)",
  temperature: "Temperature",
  maxOutputTokens: "Max output tokens",
};

/** Controls an author can explicitly request in V1. */
export interface AdvancedControlsRequest {
  /** 0–1. Omitted means untouched; `0` is an explicit (off) value and is sent. */
  minP?: number;
  /** Per-request instruction text appended as a delimited block. */
  avoidanceGuidance?: string;
  /** OpenRouter endpoint slug to pin. */
  endpoint?: string;
}

export class CapabilityError extends Error {
  constructor(
    message: string,
    public readonly code: "VALIDATION_FAILED" | "UNSUPPORTED_CONTROL",
    public readonly control: string | null,
    public readonly status: number,
  ) {
    super(message);
    this.name = "CapabilityError";
  }
}

export function handleCapabilityApiError(err: CapabilityError): Response {
  return Response.json(
    { error: err.message, code: err.code, ...(err.control ? { control: err.control } : {}) },
    { status: err.status },
  );
}
