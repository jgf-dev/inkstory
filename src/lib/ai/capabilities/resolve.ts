import { MIN_P_RANGE, staticControls, transportFor } from "./registry";
import {
  loadOpenRouterCatalog,
  type CatalogLoadOptions,
  type OpenRouterCatalogLoader,
} from "./openrouter-catalog";
import {
  CAPABILITY_REGISTRY_VERSION,
  CONTROL_LABELS,
  type CapabilityProfile,
  type CapabilityProvider,
  type CapabilityRoute,
  type ControlCapability,
} from "./types";

export interface ResolveCapabilitiesInput {
  provider: CapabilityProvider;
  model: string;
  endpoint?: string | null;
  customBaseUrl?: boolean;
}

export interface ResolveCapabilitiesOptions extends CatalogLoadOptions {
  /**
   * Consult the OpenRouter endpoint catalog. Off by default so plain
   * generation never pays a catalog round-trip; enabled when an advanced
   * native control (Min-P, endpoint pin) is requested or the UI asks.
   */
  useCatalog?: boolean;
  loadCatalog?: OpenRouterCatalogLoader;
}

function minP(
  availability: ControlCapability["availability"],
  support: ControlCapability["support"],
  reason: string,
): ControlCapability {
  return {
    id: "minP",
    label: CONTROL_LABELS.minP,
    support,
    adapterImplemented: true,
    usable: availability === "available",
    availability,
    reason,
    numeric: MIN_P_RANGE,
  };
}

/**
 * The single server-owned capability resolver (STO-1265). Resolves at
 * provider + exact model + transport + endpoint. Platform gateway included.
 */
export async function resolveCapabilities(
  input: ResolveCapabilitiesInput,
  options: ResolveCapabilitiesOptions = {},
): Promise<CapabilityProfile> {
  const endpoint = input.endpoint?.trim() || null;
  const route: CapabilityRoute = {
    provider: input.provider,
    model: input.model.trim(),
    transport: transportFor(input.provider),
    endpoint,
    customBaseUrl: input.customBaseUrl === true,
  };
  const controls = staticControls(route);
  const profile: CapabilityProfile = {
    registryVersion: CAPABILITY_REGISTRY_VERSION,
    route,
    source: "static",
    observedAt: null,
    controls,
  };

  if (route.provider !== "openrouter" || route.customBaseUrl || !options.useCatalog) {
    return profile;
  }

  const load = options.loadCatalog ?? loadOpenRouterCatalog;
  const catalog = await load(route.model, options);
  if (!catalog) {
    profile.source = "catalog-unavailable";
    controls.minP = minP(
      "unverified",
      "unknown",
      "Support not verified: OpenRouter's endpoint catalog for this model is unavailable right now. Try again later or choose another model.",
    );
    return profile;
  }

  profile.source = "catalog";
  profile.observedAt = new Date(catalog.fetchedAt).toISOString();

  const candidates = endpoint
    ? catalog.endpoints.filter((e) => e.tag === endpoint)
    : catalog.endpoints;

  if (endpoint && candidates.length === 0) {
    controls.minP = minP(
      "unverified",
      "unknown",
      `Endpoint "${endpoint}" is not listed for ${route.model} on OpenRouter. Pick a listed endpoint or clear the endpoint.`,
    );
    return profile;
  }

  const withMinP = candidates.filter((e) => e.supportedParameters.includes("min_p"));
  if (withMinP.length) {
    controls.minP = minP(
      "available",
      "native",
      endpoint
        ? `Supported by the ${endpoint} endpoint. Keeps tokens with probability ≥ Min-P × the top token's probability (0 turns it off).`
        : `Supported by ${withMinP.length} of ${candidates.length} OpenRouter endpoints for this model; requests using Min-P only route to those (${withMinP.map((e) => e.tag).join(", ")}).`,
    );
  } else {
    controls.minP = minP(
      "unsupported",
      "unsupported",
      endpoint
        ? `The ${endpoint} endpoint does not support Min-P. Choose an endpoint that lists min_p or another model.`
        : "None of this model's OpenRouter endpoints support Min-P. Choose another model.",
    );
  }

  if (
    controls.temperature.usable &&
    candidates.length > 0 &&
    candidates.every((e) => !e.supportedParameters.includes("temperature"))
  ) {
    controls.temperature = {
      ...controls.temperature,
      support: "unsupported",
      usable: false,
      availability: "unsupported",
      reason: "This route does not accept temperature, so inkstory does not send one.",
    };
  }
  return profile;
}

/** Client-safe summary: no keys, base URLs, or catalog internals. */
export function summarizeProfile(profile: CapabilityProfile) {
  const all = Object.values(profile.controls);
  return {
    registryVersion: profile.registryVersion,
    route: {
      provider: profile.route.provider,
      model: profile.route.model,
      transport: profile.route.transport,
      endpoint: profile.route.endpoint,
    },
    source: profile.source,
    observedAt: profile.observedAt,
    usable: all.filter((c) => c.usable),
    unavailable: all.filter((c) => !c.usable),
  };
}

export type CapabilitySummary = ReturnType<typeof summarizeProfile>;
