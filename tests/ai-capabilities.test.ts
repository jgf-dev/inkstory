import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  AVOIDANCE_GUIDANCE_CLOSE,
  AVOIDANCE_GUIDANCE_OPEN,
  CAPABILITY_REGISTRY_VERSION,
  CapabilityError,
  MAX_AVOIDANCE_GUIDANCE_CHARS,
  OPENROUTER_CATALOG_BASE_URL,
  OPENROUTER_CATALOG_TTL_MS,
  applyAvoidanceGuidance,
  assertControlsSupported,
  buildAppliedMetadata,
  catalogPathFor,
  clearOpenRouterCatalogCache,
  escapeGuidanceText,
  handleCapabilityApiError,
  isFresh,
  joinPromptMessages,
  loadOpenRouterCatalog,
  needsCatalog,
  parseAdvancedControls,
  rejectsSamplingParams,
  renderAvoidanceGuidanceBlock,
  resolveCapabilities,
  staticControls,
  summarizeProfile,
  transportFor,
  type OpenRouterCatalogEntry,
} from "../src/lib/ai/capabilities";
import {
  AVAILABILITY_LABELS,
  describeApplied,
  parseMinPDraft,
} from "../src/lib/ai/capabilities/display";

const LLAMA = "meta-llama/llama-3.3-70b-instruct";

function catalogBody(
  endpoints: Array<{ tag: string; params: string[]; name?: string }> = [
    { tag: "deepinfra/turbo", params: ["max_tokens", "temperature", "min_p"], name: "DeepInfra" },
    { tag: "groq", params: ["max_tokens", "temperature"], name: "Groq" },
    { tag: "cloudflare/fp8", params: ["temperature", "min_p"] },
  ],
) {
  return {
    data: {
      id: LLAMA,
      endpoints: endpoints.map((e) => ({
        tag: e.tag,
        provider_name: e.name,
        supported_parameters: e.params,
      })),
    },
  };
}

function entry(
  endpoints: OpenRouterCatalogEntry["endpoints"],
  fetchedAt = Date.UTC(2026, 10, 9),
): OpenRouterCatalogEntry {
  return { model: LLAMA, fetchedAt, endpoints };
}

const ENDPOINTS: OpenRouterCatalogEntry["endpoints"] = [
  {
    tag: "deepinfra/turbo",
    providerName: "DeepInfra",
    supportedParameters: ["temperature", "min_p"],
  },
  { tag: "groq", providerName: "Groq", supportedParameters: ["temperature"] },
];

beforeEach(() => clearOpenRouterCatalogCache());
afterEach(() => {
  vi.unstubAllGlobals();
  clearOpenRouterCatalogCache();
});

describe("static capability registry", () => {
  it("maps transports per provider", () => {
    expect(transportFor("anthropic")).toBe("anthropic-messages");
    expect(transportFor("platform-gateway")).toBe("openai-chat");
    expect(transportFor("ollama")).toBe("openai-chat");
  });

  it.each(["platform-gateway", "openai", "anthropic"] as const)(
    "%s: Min-P/DRY/Mirostat unsupported, guidance instruction-only",
    (provider) => {
      const c = staticControls({
        provider,
        model: "m",
        transport: transportFor(provider),
        endpoint: null,
        customBaseUrl: false,
      });
      expect(c.minP).toMatchObject({ usable: false, availability: "unsupported" });
      expect(c.dry).toMatchObject({ usable: false, support: "unsupported" });
      expect(c.mirostat).toMatchObject({ usable: false, support: "unsupported" });
      expect(c.nativeNegativePrompt.usable).toBe(false);
      expect(c.avoidanceGuidance).toMatchObject({ usable: true, support: "instruction-only" });
      expect(c.maxOutputTokens.usable).toBe(true);
      expect(c.temperature.usable).toBe(true);
    },
  );

  it.each(["ollama", "lmstudio"] as const)(
    "%s keeps Min-P off on the OpenAI-compatible transport and never emulates DRY/Mirostat",
    (provider) => {
      const c = staticControls({
        provider,
        model: "llama3.2",
        transport: "openai-chat",
        endpoint: null,
        customBaseUrl: false,
      });
      expect(c.minP).toMatchObject({
        usable: false,
        availability: "not_integrated",
        adapterImplemented: false,
      });
      expect(c.minP.reason).toMatch(/OpenAI-compatible/);
      expect(c.dry.reason).toMatch(/does not substitute repetition penalties/);
      expect(c.mirostat.reason).toMatch(/does not emulate Mirostat/);
    },
  );

  it("OpenRouter Min-P is unverified until the catalog is consulted", () => {
    const base = { provider: "openrouter", model: LLAMA, transport: "openai-chat" } as const;
    const c = staticControls({ ...base, endpoint: null, customBaseUrl: false });
    expect(c.minP).toMatchObject({ usable: false, availability: "unverified", support: "unknown" });
    const custom = staticControls({ ...base, endpoint: null, customBaseUrl: true });
    expect(custom.minP.reason).toMatch(/custom OpenRouter base URL/);
  });

  it.each([
    ["o3", true],
    ["o4-mini", true],
    ["openai/o1", true],
    ["gpt-5", true],
    ["openai/gpt-5.1", true],
    ["gpt-5-chat-latest", false],
    ["gpt-4o", false],
    ["anthropic/claude-sonnet-4.6", false],
    ["anthropic/claude-opus-4.7", true],
    ["claude-opus-4-7", true],
    ["claude-opus-5-5", true],
    ["anthropic/claude-opus-4.1", false],
    ["claude-opus-4-20250514", false],
    ["omni-model", false],
  ])("rejectsSamplingParams(%s) = %s", (model, expected) => {
    expect(rejectsSamplingParams(model)).toBe(expected);
    const c = staticControls({
      provider: "openai",
      model,
      transport: "openai-chat",
      endpoint: null,
      customBaseUrl: false,
    });
    expect(c.temperature.usable).toBe(!expected);
  });
});

describe("OpenRouter endpoint catalog overlay", () => {
  it("builds catalog paths only for author/slug ids", () => {
    expect(catalogPathFor(LLAMA)).toBe("/models/meta-llama/llama-3.3-70b-instruct/endpoints");
    expect(catalogPathFor("meta-llama/llama-3.3-70b-instruct:free")).toBe(
      "/models/meta-llama/llama-3.3-70b-instruct/endpoints",
    );
    expect(catalogPathFor("llama3.2")).toBeNull();
    expect(catalogPathFor("../../etc/passwd")).toBeNull();
    expect(catalogPathFor("a/b/c")).toBeNull();
    expect(catalogPathFor("a/b?x=1")).toBeNull();
  });

  it("fetches, parses, and caches within the TTL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(catalogBody()));
    let now = 1_000_000;
    const first = await loadOpenRouterCatalog(LLAMA, { fetch: fetchMock, now: () => now });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      `${OPENROUTER_CATALOG_BASE_URL}/models/meta-llama/llama-3.3-70b-instruct/endpoints`,
    );
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
    expect(first?.endpoints).toEqual([
      {
        tag: "deepinfra/turbo",
        providerName: "DeepInfra",
        supportedParameters: ["max_tokens", "temperature", "min_p"],
      },
      { tag: "groq", providerName: "Groq", supportedParameters: ["max_tokens", "temperature"] },
      {
        tag: "cloudflare/fp8",
        providerName: "cloudflare/fp8",
        supportedParameters: ["temperature", "min_p"],
      },
    ]);
    now += OPENROUTER_CATALOG_TTL_MS - 1;
    expect(await loadOpenRouterCatalog(LLAMA, { fetch: fetchMock, now: () => now })).toBe(first);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("never serves stale metadata: refetches after the TTL and returns null on failure", async () => {
    let now = 5_000_000;
    const good = vi.fn().mockResolvedValue(Response.json(catalogBody()));
    expect(await loadOpenRouterCatalog(LLAMA, { fetch: good, now: () => now })).not.toBeNull();
    now += OPENROUTER_CATALOG_TTL_MS;
    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    expect(await loadOpenRouterCatalog(LLAMA, { fetch: failing, now: () => now })).toBeNull();
    expect(failing).toHaveBeenCalledOnce();
    // Failure was not cached and the stale entry was evicted.
    const again = vi.fn().mockResolvedValue(new Response("nope", { status: 503 }));
    expect(await loadOpenRouterCatalog(LLAMA, { fetch: again, now: () => now })).toBeNull();
    expect(again).toHaveBeenCalledOnce();
  });

  it("treats malformed bodies as unavailable and skips malformed endpoints", async () => {
    const bad = vi.fn().mockResolvedValue(Response.json({ data: { endpoints: "x" } }));
    expect(await loadOpenRouterCatalog(LLAMA, { fetch: bad })).toBeNull();
    const notJson = vi.fn().mockResolvedValue(new Response("<html>"));
    expect(await loadOpenRouterCatalog(LLAMA, { fetch: notJson })).toBeNull();
    const partial = vi.fn().mockResolvedValue(
      Response.json({
        data: {
          endpoints: [
            { tag: 1 },
            null,
            { tag: "ok", supported_parameters: ["min_p", 7] },
            { tag: "", supported_parameters: [] },
          ],
        },
      }),
    );
    const parsed = await loadOpenRouterCatalog(LLAMA, { fetch: partial });
    expect(parsed?.endpoints).toEqual([
      { tag: "ok", providerName: "ok", supportedParameters: ["min_p"] },
    ]);
    clearOpenRouterCatalogCache();
    const allInvalid = vi
      .fn()
      .mockResolvedValue(Response.json({ data: { endpoints: [{ tag: 1 }, null] } }));
    expect(await loadOpenRouterCatalog(LLAMA, { fetch: allInvalid })).toBeNull();
  });

  it("does not fetch for ids without a catalog path and defaults to global fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(catalogBody()));
    vi.stubGlobal("fetch", fetchMock);
    expect(await loadOpenRouterCatalog("no-slash")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    const controller = new AbortController();
    expect(await loadOpenRouterCatalog(LLAMA, { signal: controller.signal })).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("evicts the oldest entry when the cache is full", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json(catalogBody()));
    for (let i = 0; i < 257; i++) {
      await loadOpenRouterCatalog(`author/model-${i}`, { fetch: fetchMock });
    }
    expect(fetchMock).toHaveBeenCalledTimes(257);
    await loadOpenRouterCatalog("author/model-0", { fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(258);
    await loadOpenRouterCatalog("author/model-256", { fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(258);
  });

  it("isFresh rejects future and expired timestamps", () => {
    const e = entry([], 1000);
    expect(isFresh(e, 1000)).toBe(true);
    expect(isFresh(e, 999)).toBe(false);
    expect(isFresh(e, 1000 + OPENROUTER_CATALOG_TTL_MS)).toBe(false);
  });
});

describe("resolveCapabilities", () => {
  const load = (e: OpenRouterCatalogEntry | null) => vi.fn().mockResolvedValue(e);

  it("same model, different endpoints → different Min-P support", async () => {
    const loader = load(entry(ENDPOINTS));
    const deepinfra = await resolveCapabilities(
      { provider: "openrouter", model: LLAMA, endpoint: "deepinfra/turbo" },
      { useCatalog: true, loadCatalog: loader },
    );
    const groq = await resolveCapabilities(
      { provider: "openrouter", model: LLAMA, endpoint: "groq" },
      { useCatalog: true, loadCatalog: loader },
    );
    expect(deepinfra.controls.minP).toMatchObject({ usable: true, support: "native" });
    expect(deepinfra.controls.minP.reason).toMatch(/deepinfra\/turbo/);
    expect(groq.controls.minP).toMatchObject({ usable: false, availability: "unsupported" });
    expect(groq.controls.minP.reason).toMatch(/groq endpoint does not support Min-P/);
    expect(deepinfra.source).toBe("catalog");
    expect(deepinfra.observedAt).toBe("2026-11-09T00:00:00.000Z");
    expect(deepinfra.registryVersion).toBe(CAPABILITY_REGISTRY_VERSION);
  });

  it("without a pinned endpoint, Min-P is usable when some endpoint supports it", async () => {
    const p = await resolveCapabilities(
      { provider: "openrouter", model: LLAMA },
      { useCatalog: true, loadCatalog: load(entry(ENDPOINTS)) },
    );
    expect(p.controls.minP.usable).toBe(true);
    expect(p.controls.minP.reason).toMatch(/1 of 2 .*deepinfra\/turbo/);
    expect(p.route).toEqual({
      provider: "openrouter",
      model: LLAMA,
      transport: "openai-chat",
      endpoint: null,
      customBaseUrl: false,
    });
  });

  it("no endpoint supports Min-P → unsupported with an actionable reason", async () => {
    const p = await resolveCapabilities(
      { provider: "openrouter", model: "anthropic/claude-sonnet-4.6" },
      { useCatalog: true, loadCatalog: load(entry([ENDPOINTS[1]])) },
    );
    expect(p.controls.minP).toMatchObject({ usable: false, availability: "unsupported" });
    expect(p.controls.minP.reason).toMatch(/Choose another model/);
  });

  it("unlisted pinned endpoint → unverified", async () => {
    const p = await resolveCapabilities(
      { provider: "openrouter", model: LLAMA, endpoint: "made-up" },
      { useCatalog: true, loadCatalog: load(entry(ENDPOINTS)) },
    );
    expect(p.controls.minP).toMatchObject({ usable: false, availability: "unverified" });
    expect(p.controls.minP.reason).toMatch(/not listed/);
  });

  it("missing/stale catalog → unknown, never native", async () => {
    const p = await resolveCapabilities(
      { provider: "openrouter", model: LLAMA },
      { useCatalog: true, loadCatalog: load(null) },
    );
    expect(p.source).toBe("catalog-unavailable");
    expect(p.controls.minP).toMatchObject({ usable: false, support: "unknown" });
  });

  it("drops temperature when no candidate endpoint accepts it", async () => {
    const p = await resolveCapabilities(
      { provider: "openrouter", model: "openai/some-reasoner" },
      {
        useCatalog: true,
        loadCatalog: load(
          entry([{ tag: "openai", providerName: "OpenAI", supportedParameters: ["max_tokens"] }]),
        ),
      },
    );
    expect(p.controls.temperature).toMatchObject({ usable: false, availability: "unsupported" });
  });

  it("skips the catalog for non-OpenRouter, custom base URLs, or when not requested", async () => {
    const loader = load(entry(ENDPOINTS));
    await resolveCapabilities(
      { provider: "openai", model: "gpt-4o" },
      { useCatalog: true, loadCatalog: loader },
    );
    await resolveCapabilities(
      { provider: "openrouter", model: LLAMA, customBaseUrl: true },
      { useCatalog: true, loadCatalog: loader },
    );
    const p = await resolveCapabilities(
      { provider: "openrouter", model: LLAMA },
      { loadCatalog: loader },
    );
    expect(loader).not.toHaveBeenCalled();
    expect(p.source).toBe("static");
    expect(p.controls.minP.usable).toBe(false);
  });

  it("uses the module catalog loader by default", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(catalogBody())));
    const p = await resolveCapabilities(
      { provider: "openrouter", model: ` ${LLAMA} ` },
      { useCatalog: true },
    );
    expect(p.route.model).toBe(LLAMA);
    expect(p.controls.minP.usable).toBe(true);
  });

  it("summarizeProfile splits usable/unavailable and exposes no custom-base-url flag", async () => {
    const p = await resolveCapabilities({
      provider: "platform-gateway",
      model: "anthropic/claude-sonnet-4.6",
    });
    const s = summarizeProfile(p);
    expect(s.route).toEqual({
      provider: "platform-gateway",
      model: "anthropic/claude-sonnet-4.6",
      transport: "openai-chat",
      endpoint: null,
    });
    expect(s.usable.map((c) => c.id).sort()).toEqual([
      "avoidanceGuidance",
      "maxOutputTokens",
      "temperature",
    ]);
    expect(s.unavailable.map((c) => c.id).sort()).toEqual([
      "dry",
      "minP",
      "mirostat",
      "nativeNegativePrompt",
    ]);
  });
});

describe("parseAdvancedControls", () => {
  it("omitted ≠ 0", () => {
    expect(parseAdvancedControls({})).toEqual({});
    expect(parseAdvancedControls({ minP: 0 })).toEqual({ minP: 0 });
    expect("minP" in parseAdvancedControls({})).toBe(false);
    expect(parseAdvancedControls({ minP: 1 })).toEqual({ minP: 1 });
    expect(parseAdvancedControls({ minP: 0.05 })).toEqual({ minP: 0.05 });
  });

  it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "0.1", null, true, {}])(
    "rejects minP=%s",
    (minP) => {
      try {
        parseAdvancedControls({ minP });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(CapabilityError);
        expect((err as CapabilityError).code).toBe("VALIDATION_FAILED");
        expect((err as CapabilityError).control).toBe("minP");
        expect((err as CapabilityError).status).toBe(400);
      }
    },
  );

  it.each([
    ["dry", "dry", 422],
    ["mirostat", "mirostat", 422],
    ["mirostat_tau", "mirostat", 422],
    ["negativePrompt", "nativeNegativePrompt", 422],
    ["temperature", "temperature", 422],
    ["logit_bias", "logitBias", 422],
    ["min_p", "minP", 400],
    ["capabilities", "capabilities", 400],
    ["provider", "provider", 400],
  ])("rejects request key %s", (key, control, status) => {
    try {
      parseAdvancedControls({ [key]: 1 });
      expect.unreachable();
    } catch (err) {
      expect((err as CapabilityError).control).toBe(control);
      expect((err as CapabilityError).status).toBe(status);
    }
  });

  it("validates and trims avoidance guidance", () => {
    expect(parseAdvancedControls({ avoidanceGuidance: "  no clichés  " })).toEqual({
      avoidanceGuidance: "no clichés",
    });
    expect(parseAdvancedControls({ avoidanceGuidance: "   " })).toEqual({});
    expect(() => parseAdvancedControls({ avoidanceGuidance: 3 })).toThrow(/must be a string/);
    expect(() =>
      parseAdvancedControls({ avoidanceGuidance: "x".repeat(MAX_AVOIDANCE_GUIDANCE_CHARS + 1) }),
    ).toThrow(/at most/);
  });

  it("validates endpoint slugs", () => {
    expect(parseAdvancedControls({ endpoint: " deepinfra/turbo " })).toEqual({
      endpoint: "deepinfra/turbo",
    });
    expect(parseAdvancedControls({ endpoint: "baseten/fp4/us/priority" }).endpoint).toBe(
      "baseten/fp4/us/priority",
    );
    for (const endpoint of ["", "http://evil", "a b", 4, "x".repeat(129), "/lead"]) {
      expect(() => parseAdvancedControls({ endpoint })).toThrow(CapabilityError);
    }
  });

  it("needsCatalog only for native routing controls", () => {
    expect(needsCatalog({})).toBe(false);
    expect(needsCatalog({ avoidanceGuidance: "x" })).toBe(false);
    expect(needsCatalog({ minP: 0 })).toBe(true);
    expect(needsCatalog({ endpoint: "groq" })).toBe(true);
  });
});

describe("assertControlsSupported", () => {
  it("rejects Min-P on ineligible routes with an actionable 422", async () => {
    const platform = await resolveCapabilities({
      provider: "platform-gateway",
      model: "anthropic/claude-sonnet-4.6",
    });
    expect(() => assertControlsSupported({ minP: 0 }, platform)).toThrow(/Remove Min-P/);
    expect(() => assertControlsSupported({ avoidanceGuidance: "x" }, platform)).not.toThrow();
    expect(() => assertControlsSupported({}, platform)).not.toThrow();
  });

  it("rejects endpoint pins outside OpenRouter or with custom base URLs", async () => {
    const openai = await resolveCapabilities({ provider: "openai", model: "gpt-4o" });
    expect(() => assertControlsSupported({ endpoint: "groq" }, openai)).toThrow(
      /only available for OpenRouter/,
    );
    const custom = await resolveCapabilities({
      provider: "openrouter",
      model: LLAMA,
      customBaseUrl: true,
    });
    expect(() => assertControlsSupported({ endpoint: "groq" }, custom)).toThrow(
      /custom OpenRouter base URL/,
    );
  });

  it("rejects a pinned endpoint the catalog does not list, even without Min-P", async () => {
    const p = await resolveCapabilities(
      { provider: "openrouter", model: LLAMA, endpoint: "made-up" },
      { useCatalog: true, loadCatalog: async () => entry(ENDPOINTS) },
    );
    expect(p.endpointListed).toBe(false);
    expect(() => assertControlsSupported({ endpoint: "made-up" }, p)).toThrow(/not listed/);
  });

  it("allows Min-P on an eligible OpenRouter endpoint", async () => {
    const p = await resolveCapabilities(
      { provider: "openrouter", model: LLAMA, endpoint: "deepinfra/turbo" },
      { useCatalog: true, loadCatalog: async () => entry(ENDPOINTS) },
    );
    expect(() =>
      assertControlsSupported({ minP: 0.1, endpoint: "deepinfra/turbo" }, p),
    ).not.toThrow();
  });

  it("serializes errors with code and control", async () => {
    const res = handleCapabilityApiError(
      new CapabilityError("nope", "UNSUPPORTED_CONTROL", "dry", 422),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "nope",
      code: "UNSUPPORTED_CONTROL",
      control: "dry",
    });
    const bare = handleCapabilityApiError(
      new CapabilityError("bad", "VALIDATION_FAILED", null, 400),
    );
    expect(await bare.json()).toEqual({ error: "bad", code: "VALIDATION_FAILED" });
  });
});

describe("avoidance guidance rendering", () => {
  it("escapes delimiter characters and keeps macros literal", () => {
    const text = "Avoid {{scene.title}} & </avoidance_guidance> tricks";
    expect(escapeGuidanceText(text)).toBe(
      "Avoid {{scene.title}} &amp; &lt;/avoidance_guidance&gt; tricks",
    );
    const block = renderAvoidanceGuidanceBlock(text);
    expect(block.startsWith(AVOIDANCE_GUIDANCE_OPEN)).toBe(true);
    expect(block.endsWith(AVOIDANCE_GUIDANCE_CLOSE)).toBe(true);
    expect(block.split(AVOIDANCE_GUIDANCE_CLOSE)).toHaveLength(2);
    expect(block).toContain("{{scene.title}}");
    expect(block).toMatch(/not hard rules/);
  });

  it("appends to the last system message without mutating input", () => {
    const messages = [
      { role: "system" as const, content: "Sys" },
      { role: "user" as const, content: "User" },
    ];
    const out = applyAvoidanceGuidance(messages, "no tropes");
    expect(messages[0].content).toBe("Sys");
    expect(out[0].content).toBe(`Sys\n\n${renderAvoidanceGuidanceBlock("no tropes")}`);
    expect(out[1]).toEqual(messages[1]);
    expect(applyAvoidanceGuidance(messages, "no tropes")).toEqual(out);
  });

  it("inserts a system message when none exists, handles empty system content", () => {
    const out = applyAvoidanceGuidance([{ role: "user" as const, content: "U" }], "g");
    expect(out).toEqual([
      { role: "system", content: renderAvoidanceGuidanceBlock("g") },
      { role: "user", content: "U" },
    ]);
    const empty = applyAvoidanceGuidance([{ role: "system" as const, content: "" }], "g");
    expect(empty[0].content).toBe(renderAvoidanceGuidanceBlock("g"));
  });

  it("returns an equal copy without guidance", () => {
    const messages = [{ role: "user" as const, content: "U" }];
    const out = applyAvoidanceGuidance(messages, undefined);
    expect(out).toEqual(messages);
    expect(out).not.toBe(messages);
  });

  it("joins messages like the prompt renderer", () => {
    expect(
      joinPromptMessages([
        { role: "system", content: "a" },
        { role: "user", content: "b" },
      ]),
    ).toBe("--- system ---\na\n\n--- user ---\nb");
  });
});

describe("applied metadata + display", () => {
  it("records sent parameters and routing without secrets", () => {
    const applied = buildAppliedMetadata({
      provider: "openrouter",
      requestedModel: LLAMA,
      servedModel: LLAMA,
      endpoint: "deepinfra/turbo",
      maxTokens: 512,
      temperature: 0.7,
      minP: 0,
      guidanceIncluded: true,
    });
    expect(applied).toEqual({
      provider: "openrouter",
      requestedModel: LLAMA,
      model: LLAMA,
      endpoint: "deepinfra/turbo",
      parameters: { max_tokens: 512, temperature: 0.7, min_p: 0 },
      routing: { requireParameters: true, only: ["deepinfra/turbo"] },
      avoidanceGuidance: "included",
    });
    expect(describeApplied(applied)).toBe(
      "max_tokens 512 · temperature 0.7 · min_p 0 · endpoint deepinfra/turbo · require_parameters · avoidance guidance included (not enforced)",
    );
  });

  it("omits routing when nothing native was requested", () => {
    const applied = buildAppliedMetadata({
      provider: "platform-gateway",
      requestedModel: "m",
      servedModel: "m",
      maxTokens: 1024,
      guidanceIncluded: false,
    });
    expect(applied.routing).toBeNull();
    expect(applied.parameters).toEqual({ max_tokens: 1024 });
    expect(describeApplied(applied)).toBe("max_tokens 1024 · no avoidance guidance");
    const pinOnly = buildAppliedMetadata({
      provider: "openrouter",
      requestedModel: "m",
      servedModel: "m",
      endpoint: "groq",
      maxTokens: 1,
      guidanceIncluded: false,
    });
    expect(pinOnly.routing).toEqual({ requireParameters: false, only: ["groq"] });
  });

  it("parses Min-P drafts", () => {
    expect(parseMinPDraft("")).toBeNull();
    expect(parseMinPDraft("  ")).toBeNull();
    expect(parseMinPDraft("0")).toBe(0);
    expect(parseMinPDraft("0.1")).toBe(0.1);
    expect(parseMinPDraft("2")).toBeNull();
    expect(parseMinPDraft("abc")).toBeNull();
    expect(AVAILABILITY_LABELS.not_integrated).toMatch(/integration not available yet/);
  });
});
