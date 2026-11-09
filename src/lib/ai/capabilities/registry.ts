import {
  CONTROL_LABELS,
  type AvailabilityReason,
  type CapabilityProvider,
  type CapabilityRoute,
  type CapabilityTransport,
  type ControlCapability,
  type ControlId,
  type NumericRange,
  type Support,
} from "./types";

/**
 * Code-owned static capability registry (STO-1265). Conservative by default:
 * anything not documented for the exact transport is `unsupported` or
 * `unknown`, never assumed. OpenRouter Min-P is refined per endpoint by the
 * catalog overlay in `./openrouter-catalog`.
 *
 * Evidence (checked 2026-11-08, see STO-1258 research):
 * - OpenRouter parameters / endpoint catalogs: Min-P per endpoint, no DRY/Mirostat.
 * - Vercel AI Gateway OpenAI-compat, OpenAI Chat Completions, Anthropic Messages:
 *   no Min-P, DRY, Mirostat, or native negative prompt.
 * - Ollama / LM Studio: Min-P only on their native APIs; inkstory uses their
 *   OpenAI-compatible `/v1/chat/completions` transport, where it is not documented.
 */

export const MIN_P_RANGE: NumericRange = { min: 0, max: 1, offValue: 0 };

export function transportFor(provider: CapabilityProvider): CapabilityTransport {
  return provider === "anthropic" ? "anthropic-messages" : "openai-chat";
}

function control(
  id: ControlId,
  support: Support,
  adapterImplemented: boolean,
  availability: AvailabilityReason,
  reason: string,
  numeric?: NumericRange,
): ControlCapability {
  return {
    id,
    label: CONTROL_LABELS[id],
    support,
    adapterImplemented,
    usable: availability === "available",
    availability,
    reason,
    ...(numeric ? { numeric } : {}),
  };
}

const PROVIDER_LABELS: Record<CapabilityProvider, string> = {
  "platform-gateway": "the platform gateway",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  ollama: "Ollama",
  lmstudio: "LM Studio",
};

/**
 * Models known to reject sampling parameters such as `temperature` (OpenAI
 * reasoning models; recent Claude Opus releases restrict sampling). When the
 * route matches, inkstory omits its internal temperature default instead of
 * sending a value the model rejects.
 */
const SAMPLING_RESTRICTED_MODELS: RegExp[] = [
  /^(?:openai\/)?o\d(?:[-.:]|$)/i,
  /^(?:openai\/)?gpt-5(?![\w.]*-chat)/i,
];

export function rejectsSamplingParams(model: string): boolean {
  const id = model.trim();
  return SAMPLING_RESTRICTED_MODELS.some((pattern) => pattern.test(id));
}

function minPStatic(route: CapabilityRoute): ControlCapability {
  const label = PROVIDER_LABELS[route.provider];
  switch (route.provider) {
    case "openrouter":
      return route.customBaseUrl
        ? control(
            "minP",
            "unknown",
            true,
            "unverified",
            "Support not verified: this credential uses a custom OpenRouter base URL, so the public endpoint catalog does not apply.",
            MIN_P_RANGE,
          )
        : control(
            "minP",
            "unknown",
            true,
            "unverified",
            "Support not verified yet for this model's OpenRouter endpoints.",
            MIN_P_RANGE,
          );
    case "ollama":
    case "lmstudio":
      return control(
        "minP",
        "unknown",
        false,
        "not_integrated",
        `${label} supports Min-P on its native API, but inkstory connects through its OpenAI-compatible endpoint, where Min-P is not available yet.`,
        MIN_P_RANGE,
      );
    default:
      return control("minP", "unsupported", false, "unsupported", `Not supported by ${label}.`);
  }
}

/** Static profile controls for a route, before any catalog overlay. */
export function staticControls(route: CapabilityRoute): Record<ControlId, ControlCapability> {
  const label = PROVIDER_LABELS[route.provider];
  const local = route.provider === "ollama" || route.provider === "lmstudio";
  const samplingRestricted = rejectsSamplingParams(route.model);
  return {
    minP: minPStatic(route),
    dry: local
      ? control(
          "dry",
          "unsupported",
          false,
          "unsupported",
          `Not supported by ${label}'s current API. inkstory does not substitute repetition penalties for DRY.`,
        )
      : control("dry", "unsupported", false, "unsupported", `Not supported by ${label}.`),
    mirostat: local
      ? control(
          "mirostat",
          "unsupported",
          false,
          "unsupported",
          `Not supported by ${label}'s current API. inkstory does not emulate Mirostat with temperature.`,
        )
      : control("mirostat", "unsupported", false, "unsupported", `Not supported by ${label}.`),
    nativeNegativePrompt: control(
      "nativeNegativePrompt",
      "unsupported",
      false,
      "unsupported",
      "No native negative-prompt channel exists for text generation here. Use avoidance guidance instead (included as instructions).",
    ),
    avoidanceGuidance: control(
      "avoidanceGuidance",
      "instruction-only",
      true,
      "available",
      "Included in the prompt as instructions. The model may not follow every preference; this is not a hard ban.",
    ),
    temperature: samplingRestricted
      ? control(
          "temperature",
          "unsupported",
          false,
          "unsupported",
          "This model rejects sampling parameters, so inkstory does not send a temperature.",
        )
      : control(
          "temperature",
          "native",
          true,
          "available",
          "inkstory sends its default temperature (0.7).",
        ),
    maxOutputTokens: control(
      "maxOutputTokens",
      "native",
      true,
      "available",
      "Caps the length of each generation.",
    ),
  };
}
