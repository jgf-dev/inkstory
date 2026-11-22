import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { POST as generate } from "../src/app/api/ai/generate/route";
import { POST as preview } from "../src/app/api/ai/preview/route";
import { GET as capabilities } from "../src/app/api/ai/capabilities/route";
import { encryptSecret } from "../src/lib/ai/credentials/crypto";
import {
  clearOpenRouterCatalogCache,
  renderAvoidanceGuidanceBlock,
} from "../src/lib/ai/capabilities";

const { first, where, getUser, getScene } = vi.hoisted(() => ({
  first: vi.fn(),
  where: vi.fn(),
  getUser: vi.fn(),
  getScene: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => ({
  db: { orm: { public: { UserProviderCredential: { where } } } },
}));
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
}));
vi.mock("../src/lib/writing/service", () => ({ getSceneForEditor: getScene }));
vi.mock("../src/lib/codex/service", () => ({
  assembleCodexContextForScene: async () => ({ entries: [], meta: {} }),
}));
vi.mock("../src/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ maxContextTokens: 8000 }),
  resolveContextTokenBudget: () => 8000,
}));
vi.mock("../src/lib/prompts", () => ({
  PromptError: class extends Error {},
  handlePromptApiError: vi.fn(),
  renderResolvedScenePrompt: async () => ({
    messages: [
      { role: "system", content: "You are a novelist." },
      { role: "user", content: "Continue the scene." },
    ],
    unresolved: [],
    unknownTokens: [],
    joined: "--- system ---\nYou are a novelist.\n\n--- user ---\nContinue the scene.",
    prompt: { id: "p", name: "Default", scope: "SYSTEM_DEFAULT", mode: "continuation" },
  }),
}));

const LLAMA = "meta-llama/llama-3.3-70b-instruct";
const apiKey = "sk-or-server-only-5678";

function post(url: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(body) });
}
const gen = (extra: Record<string, unknown> = {}) =>
  generate(post("/api/ai/generate", { sceneId: "scene", mode: "continuation", ...extra }));
const byok = (extra: Record<string, unknown> = {}) =>
  gen({ credentialId: "credential", model: LLAMA, ...extra });

function row(extra: Record<string, unknown> = {}) {
  return {
    id: "credential",
    ownerId: "owner",
    provider: "OPENROUTER",
    label: "Default",
    keyHint: "5678",
    deletedAt: null,
    baseUrl: null,
    updatedAt: { toString: () => "2026-11-09T00:00:00" },
    ...encryptSecret(apiKey),
    ...extra,
  };
}

const catalog = {
  data: {
    id: LLAMA,
    endpoints: [
      {
        tag: "deepinfra/turbo",
        provider_name: "DeepInfra",
        supported_parameters: ["temperature", "min_p"],
      },
      { tag: "groq", provider_name: "Groq", supported_parameters: ["temperature"] },
    ],
  },
};

function routedFetch(opts: { catalog?: unknown } = {}) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.includes("/endpoints")) {
      if (opts.catalog === "fail") return new Response("down", { status: 503 });
      return Response.json(opts.catalog ?? catalog);
    }
    return Response.json({ model: "served", choices: [{ message: { content: "Prose." } }] });
  });
}
const chatCalls = (f: ReturnType<typeof routedFetch>) =>
  f.mock.calls.filter(([url]) => String(url).endsWith("/chat/completions"));

beforeEach(() => {
  clearOpenRouterCatalogCache();
  vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("AI_GATEWAY_API_KEY", "platform-key");
  vi.stubEnv("AI_MODEL", "");
  where.mockReturnValue({ first });
  first.mockResolvedValue(row());
  getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
  getScene.mockResolvedValue({
    id: "scene",
    novelId: "novel",
    content: "Prose",
    excludeFromAi: false,
    pov: "THIRD_LIMITED",
    tense: "PAST",
  });
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("generate: capability gating (STO-1265)", () => {
  it("sends Min-P to an eligible OpenRouter endpoint with require_parameters", async () => {
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await byok({ minP: 0.07, endpoint: "deepinfra/turbo" });
    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(json.applied).toEqual({
      provider: "openrouter",
      requestedModel: LLAMA,
      model: "served",
      endpoint: "deepinfra/turbo",
      parameters: { max_tokens: 1024, temperature: 0.7, min_p: 0.07 },
      routing: { requireParameters: true, only: ["deepinfra/turbo"] },
      avoidanceGuidance: "none",
    });
    expect(JSON.stringify(json)).not.toContain(apiKey);
    const [[url, init]] = chatCalls(fetchMock);
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(init!.body as string)).toMatchObject({
      min_p: 0.07,
      provider: { require_parameters: true, only: ["deepinfra/turbo"], allow_fallbacks: false },
    });
  });

  it("same model, ineligible endpoint → actionable 422 and no upstream chat", async () => {
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await byok({ minP: 0.07, endpoint: "groq" });
    expect(res.status).toBe(422);
    const json = await res.json<any>();
    expect(json.code).toBe("UNSUPPORTED_CONTROL");
    expect(json.control).toBe("minP");
    expect(json.error).toMatch(/groq endpoint does not support Min-P.*Remove Min-P/);
    expect(chatCalls(fetchMock)).toHaveLength(0);
  });

  it("stale/unavailable catalog → unknown, rejected before spend", async () => {
    const fetchMock = routedFetch({ catalog: "fail" });
    vi.stubGlobal("fetch", fetchMock);
    const res = await byok({ minP: 0.1 });
    expect(res.status).toBe(422);
    expect((await res.json<any>()).error).toMatch(/catalog .* unavailable/);
    expect(chatCalls(fetchMock)).toHaveLength(0);
  });

  it("omitted Min-P sends neither min_p nor routing and skips the catalog", async () => {
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);
    expect((await byok()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(chatCalls(fetchMock)[0][1]!.body as string);
    expect(body).not.toHaveProperty("min_p");
    expect(body).not.toHaveProperty("provider");
  });

  it("explicit Min-P 0 is sent (omitted ≠ 0)", async () => {
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);
    expect((await byok({ minP: 0 })).status).toBe(200);
    const body = JSON.parse(chatCalls(fetchMock)[0][1]!.body as string);
    expect(body).toMatchObject({ min_p: 0, provider: { require_parameters: true } });
  });

  it.each([
    [{ minP: 1.5 }, 400, "VALIDATION_FAILED"],
    [{ minP: -0.1 }, 400, "VALIDATION_FAILED"],
    [{ minP: "0.1" }, 400, "VALIDATION_FAILED"],
    [{ minP: null }, 400, "VALIDATION_FAILED"],
    [{ dry: { multiplier: 0.8 } }, 422, "UNSUPPORTED_CONTROL"],
    [{ mirostat: 2 }, 422, "UNSUPPORTED_CONTROL"],
    [{ capabilities: { minP: { usable: true } } }, 400, "VALIDATION_FAILED"],
  ])("rejects %j before any spend", async (extra, status, code) => {
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await byok(extra);
    expect(res.status).toBe(status);
    expect((await res.json<any>()).code).toBe(code);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(where).not.toHaveBeenCalled();
  });

  it("custom OpenRouter base URL → Min-P unverified", async () => {
    first.mockResolvedValue(row({ baseUrl: "https://proxy.example.com/api/v1" }));
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await byok({ minP: 0.1 });
    expect(res.status).toBe(422);
    expect((await res.json<any>()).error).toMatch(/custom OpenRouter base URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["OLLAMA", "LMSTUDIO"])(
    "%s Min-P stays off on the OpenAI-compatible transport",
    async (provider) => {
      first.mockResolvedValue(row({ provider }));
      const fetchMock = routedFetch();
      vi.stubGlobal("fetch", fetchMock);
      const res = await byok({ model: "llama3.2", minP: 0.1 });
      expect(res.status).toBe(422);
      expect((await res.json<any>()).error).toMatch(/OpenAI-compatible endpoint/);
      expect(fetchMock).not.toHaveBeenCalled();

      expect((await byok({ model: "llama3.2" })).status).toBe(200);
      const [[url, init]] = chatCalls(fetchMock);
      expect(String(url)).toMatch(/\/v1\/chat\/completions$/);
      expect(JSON.parse(init!.body as string)).not.toHaveProperty("min_p");
    },
  );

  it("endpoint pins are rejected for non-OpenRouter credentials", async () => {
    first.mockResolvedValue(row({ provider: "OPENAI" }));
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await byok({ model: "gpt-4o", endpoint: "groq" });
    expect(res.status).toBe(422);
    expect((await res.json<any>()).control).toBe("endpoint");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("omits the default temperature for models that reject sampling params", async () => {
    first.mockResolvedValue(row({ provider: "OPENAI" }));
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await byok({ model: "o3" });
    expect(res.status).toBe(200);
    const body = JSON.parse(chatCalls(fetchMock)[0][1]!.body as string);
    expect(body).not.toHaveProperty("temperature");
    expect((await res.json<any>()).applied.parameters).toEqual({ max_tokens: 1024 });
  });
});

describe("generate: platform gateway gating", () => {
  it("rejects Min-P on the platform gateway before scene lookup or spend", async () => {
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await gen({ minP: 0.1 });
    expect(res.status).toBe(422);
    expect((await res.json<any>()).error).toMatch(/platform gateway/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getScene).not.toHaveBeenCalled();
  });

  it("platform generation reports applied params and omits temperature for o-series", async () => {
    vi.stubEnv("AI_MODEL", "openai/o3");
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await gen({ avoidanceGuidance: "no tropes" });
    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(json.applied).toMatchObject({
      provider: "platform-gateway",
      requestedModel: "openai/o3",
      parameters: { max_tokens: 1024 },
      avoidanceGuidance: "included",
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body).not.toHaveProperty("temperature");
    expect(body.messages[0].content).toContain(renderAvoidanceGuidanceBlock("no tropes"));
  });

  it("default gateway model keeps temperature 0.7", async () => {
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await gen();
    expect((await res.json<any>()).applied.parameters).toEqual({
      max_tokens: 1024,
      temperature: 0.7,
    });
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).temperature).toBe(0.7);
  });

  it("no-key copy-prompt response is unchanged without controls, and carries guidance with it", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);
    const plain = await gen();
    expect(plain.status).toBe(503);
    expect(await plain.json()).toEqual({
      error: "AI generation is not configured on this deployment (missing AI_GATEWAY_API_KEY)",
      code: "AI_NOT_CONFIGURED",
      prompt: { system: "You are a novelist.", user: "Continue the scene." },
      messages: [
        { role: "system", content: "You are a novelist." },
        { role: "user", content: "Continue the scene." },
      ],
      joined: "--- system ---\nYou are a novelist.\n\n--- user ---\nContinue the scene.",
    });
    const guided = await gen({ avoidanceGuidance: "avoid {{scene.title}}" });
    const json = await guided.json<any>();
    expect(json.prompt.system).toBe(
      `You are a novelist.\n\n${renderAvoidanceGuidanceBlock("avoid {{scene.title}}")}`,
    );
    expect(json.joined).toContain("avoid {{scene.title}}");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("preview renders guidance exactly as generate sends it", () => {
  it("identical messages; macros stay literal", async () => {
    const guidance = "Avoid {{scene.title}} and <b>purple</b> prose";
    const p = await preview(
      post("/api/ai/preview", {
        sceneId: "scene",
        mode: "continuation",
        avoidanceGuidance: guidance,
      }),
    );
    expect(p.status).toBe(200);
    const previewJson = await p.json<any>();
    expect(previewJson.avoidanceGuidance).toBe("included");
    expect(previewJson.joined).toContain("{{scene.title}}");

    const fetchMock = routedFetch();
    vi.stubGlobal("fetch", fetchMock);
    expect((await byok({ avoidanceGuidance: guidance })).status).toBe(200);
    const sent = JSON.parse(chatCalls(fetchMock)[0][1]!.body as string).messages;
    expect(sent).toEqual(previewJson.messages);
    expect(sent[0].content).toContain("{{scene.title}}");
    expect(sent[0].content).toContain("&lt;b&gt;purple&lt;/b&gt;");
  });

  it("preview without guidance is unchanged and rejects bad guidance", async () => {
    const p = await preview(post("/api/ai/preview", { sceneId: "scene", mode: "continuation" }));
    const json = await p.json<any>();
    expect(json.avoidanceGuidance).toBe("none");
    expect(json.joined).toBe(
      "--- system ---\nYou are a novelist.\n\n--- user ---\nContinue the scene.",
    );
    const bad = await preview(
      post("/api/ai/preview", { sceneId: "scene", mode: "continuation", avoidanceGuidance: 7 }),
    );
    expect(bad.status).toBe(400);
  });
});

describe("GET /api/ai/capabilities", () => {
  const get = (q = "") => capabilities(new NextRequest(`http://localhost/api/ai/capabilities${q}`));

  it("requires auth", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await get()).status).toBe(401);
  });

  it("resolves the platform gateway without a credential", async () => {
    const res = await get();
    const { capabilities: c } = await res.json<any>();
    expect(c.route.provider).toBe("platform-gateway");
    expect(c.unavailable.map((x: any) => x.id)).toContain("minP");
    expect(where).not.toHaveBeenCalled();
  });

  it("resolves an owned OpenRouter credential per endpoint without secrets", async () => {
    vi.stubGlobal("fetch", routedFetch());
    const ok = await get(
      `?credentialId=credential&model=${encodeURIComponent(LLAMA)}&endpoint=deepinfra/turbo`,
    );
    const text = await ok.text();
    expect(text).not.toContain(apiKey);
    expect(text).not.toContain("ciphertext");
    const c = JSON.parse(text).capabilities;
    expect(c.usable.map((x: any) => x.id)).toContain("minP");
    expect(c.route.endpoint).toBe("deepinfra/turbo");

    const groq = await (
      await get(`?credentialId=credential&model=${encodeURIComponent(LLAMA)}&endpoint=groq`)
    ).json<any>();
    expect(groq.capabilities.unavailable.find((x: any) => x.id === "minP").availability).toBe(
      "unsupported",
    );
  });

  it("validates params and hides foreign credentials", async () => {
    expect((await get("?model=x")).status).toBe(400);
    expect((await get("?credentialId=credential")).status).toBe(400);
    expect((await get("?credentialId=credential&model=m&endpoint=bad%20slug")).status).toBe(400);
    first.mockResolvedValue(row({ ownerId: "someone-else" }));
    const res = await get("?credentialId=credential&model=m");
    expect(res.status).toBe(404);
  });
});
