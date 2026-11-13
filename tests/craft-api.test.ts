import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { POST as runCraft } from "../src/app/api/craft/[tool]/route";
import { GET as listTools } from "../src/app/api/craft/tools/route";
import { encryptSecret } from "../src/lib/ai/credentials/crypto";
import { CodexError } from "../src/lib/codex/errors";

const { first, where, getUser, getScene, assemble } = vi.hoisted(() => ({
  first: vi.fn(),
  where: vi.fn(),
  getUser: vi.fn(),
  getScene: vi.fn(),
  assemble: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => ({
  db: { orm: { public: { UserProviderCredential: { where } } } },
}));
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser } }),
}));
vi.mock("../src/lib/writing/service", () => ({ getSceneForEditor: getScene }));
vi.mock("../src/lib/codex/service", () => ({ assembleCodexContextForScene: assemble }));
vi.mock("../src/lib/billing/entitlements", () => ({
  getEntitlements: async () => ({ maxContextTokens: 8000 }),
  resolveContextTokenBudget: () => 8000,
}));

const apiKey = "sk-or-craft-secret-4321";
const MODEL = "meta-llama/llama-3.3-70b-instruct";
const SELECTION = "The boat was late.";

function credentialRow() {
  return {
    id: "credential",
    ownerId: "owner",
    provider: "OPENROUTER",
    label: "Default",
    keyHint: "4321",
    deletedAt: null,
    baseUrl: null,
    updatedAt: { toString: () => "2026-11-13T00:00:00" },
    ...encryptSecret(apiKey),
  };
}

function craft(body: unknown, tool = "describe") {
  return runCraft(
    new NextRequest(`http://localhost/api/craft/${tool}`, {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ tool }) },
  );
}
const describeBody = (extra: Record<string, unknown> = {}) => ({
  sceneId: "scene",
  inputs: { "craft.selection": SELECTION, "craft.sensory_focus": "smell" },
  ...extra,
});

function chatFetch(
  response: () => Response = () =>
    Response.json({ model: "served", choices: [{ message: { content: "Salt and tar." } }] }),
) {
  return vi.fn(async (_url: string, _init?: RequestInit) => response());
}

beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("AI_GATEWAY_API_KEY", "platform-key");
  vi.stubEnv("AI_MODEL", "");
  where.mockReturnValue({ first });
  first.mockResolvedValue(credentialRow());
  getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
  assemble.mockResolvedValue({ entries: [], meta: {} });
  getScene.mockResolvedValue({
    id: "scene",
    novelId: "novel",
    novelTitle: "The Salt Road",
    chapterTitle: "Harbor",
    title: "Docks at Dawn",
    content: "Mara walked to the pier. The boat was late.",
    summary: "Mara waits.",
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

describe("GET /api/craft/tools", () => {
  it("lists the code-owned tools for signed-in authors", async () => {
    const res = await listTools();
    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(json.tools.map((t: { id: string }) => t.id)).toEqual(["describe"]);
    expect(json.tools[0].contract.output.suggestedAction).toBe("replace_selection");
  });

  it("requires a session", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await listTools()).status).toBe(401);
  });

  it("maps unexpected failures", async () => {
    getUser.mockRejectedValueOnce(new Error("boom"));
    expect((await listTools()).status).toBe(500);
  });
});

describe("POST /api/craft/:tool — validation before spend", () => {
  it("requires a session", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } });
    expect((await craft(describeBody())).status).toBe(401);
  });

  it.each([
    [{ inputs: {} }, /sceneId/],
    [{ sceneId: "scene", content: 7 }, /content must be a string/],
    [{ sceneId: "scene", dryRun: "yes" }, /dryRun must be a boolean/],
    [{ sceneId: "scene", credentialId: "credential" }, /BYOK requires/],
    [{ sceneId: "scene", model: MODEL }, /BYOK requires/],
  ])("400 for %j", async (body, message) => {
    const fetchMock = chatFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await craft(body);
    expect(res.status).toBe(400);
    const json = await res.json<any>();
    expect(json.code).toBe("VALIDATION_FAILED");
    expect(json.error).toMatch(message);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getScene).not.toHaveBeenCalled();
  });

  it("404 for an unknown tool", async () => {
    const res = await craft(describeBody(), "expand");
    expect(res.status).toBe(404);
    expect((await res.json<any>()).code).toBe("NOT_FOUND");
  });

  it("422 MISSING_INPUT without a selection, before any scene lookup", async () => {
    const fetchMock = chatFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await craft({ sceneId: "scene", inputs: { "craft.sensory_focus": "sight" } });
    expect(res.status).toBe(422);
    const json = await res.json<any>();
    expect(json.code).toBe("MISSING_INPUT");
    expect(json.error).toContain("craft.selection");
    expect(getScene).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("422 VALIDATION_FAILED for undeclared inputs", async () => {
    const res = await craft(
      describeBody({ inputs: { "craft.selection": "x", "craft.rewrite_preset": "simpler" } }),
    );
    expect(res.status).toBe(422);
    expect((await res.json<any>()).code).toBe("VALIDATION_FAILED");
  });

  it("403 when the scene is excluded from AI", async () => {
    getScene.mockResolvedValueOnce({ ...(await getScene()), excludeFromAi: true });
    const res = await craft(describeBody());
    expect(res.status).toBe(403);
    expect((await res.json<any>()).code).toBe("SCENE_EXCLUDED_FROM_AI");
    expect(assemble).not.toHaveBeenCalled();
  });

  it("maps scene access errors and malformed JSON", async () => {
    getScene.mockRejectedValueOnce(new CodexError("Scene not found", "NOT_FOUND", 404));
    expect((await craft(describeBody())).status).toBe(404);
    expect((await craft("{not json")).status).toBe(400);
  });
});

describe("POST /api/craft/describe — prompt and generation", () => {
  it("dryRun returns the rendered prompt and output behavior without a provider call", async () => {
    const fetchMock = chatFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await craft(
      describeBody({ dryRun: true, content: "Unsaved prose. The boat was late." }),
    );
    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(json.tool).toBe("describe");
    expect(json.output).toEqual({ mode: "prose", suggestedAction: "replace_selection" });
    expect(json.prompt.maxTokens).toBe(300);
    expect(json.prompt.contextSlices).toContain("codex.context");
    const user = json.prompt.messages[1].content as string;
    expect(user).toContain("Sensory focus: smell");
    expect(user).toContain("Unsaved prose.");
    expect(user).toContain(SELECTION);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(assemble).toHaveBeenCalledWith(
      "owner",
      expect.objectContaining({
        beatText: SELECTION,
        recentProse: "Unsaved prose. The boat was late.",
      }),
    );
  });

  it("503 AI_NOT_CONFIGURED still returns the prompt (zero-cost path)", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    const fetchMock = chatFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await craft(describeBody());
    expect(res.status).toBe(503);
    const json = await res.json<any>();
    expect(json.code).toBe("AI_NOT_CONFIGURED");
    expect(json.prompt.joined).toContain(SELECTION);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("platform gateway: sends the rendered messages with the target-derived budget", async () => {
    const fetchMock = chatFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await craft(
      describeBody({ inputs: { "craft.selection": SELECTION, "craft.target_words": 400 } }),
    );
    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(json).toMatchObject({
      tool: "describe",
      text: "Salt and tar.",
      model: "anthropic/claude-sonnet-4.6",
      output: { suggestedAction: "replace_selection" },
      applied: { provider: "platform-gateway", parameters: { max_tokens: 800 } },
    });
    const [[url, init]] = fetchMock.mock.calls;
    expect(url).toMatch(/\/chat\/completions$/);
    const sent = JSON.parse(init!.body as string);
    expect(sent.max_tokens).toBe(800);
    expect(sent.messages[1].content).toContain("roughly 400 words");
  });

  it("platform gateway failure → 502 AI_GATEWAY_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      chatFetch(() => Response.json({ error: { message: "nope" } }, { status: 500 })),
    );
    const res = await craft(describeBody());
    expect(res.status).toBe(502);
    expect((await res.json<any>()).code).toBe("AI_GATEWAY_ERROR");
  });

  it("BYOK: uses the stored credential and never leaks the key", async () => {
    const fetchMock = chatFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await craft(describeBody({ credentialId: "credential", model: MODEL }));
    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(json.applied).toMatchObject({ provider: "openrouter", requestedModel: MODEL });
    expect(JSON.stringify(json)).not.toContain(apiKey);
    const [[url, init]] = fetchMock.mock.calls;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${apiKey}`);
    expect(JSON.parse(init!.body as string).max_tokens).toBe(300);
  });

  it("BYOK: provider failure → 502 without upstream detail", async () => {
    vi.stubGlobal(
      "fetch",
      chatFetch(() => new Response(`upstream echoed ${apiKey}`, { status: 500 })),
    );
    const res = await craft(describeBody({ credentialId: "credential", model: MODEL }));
    expect(res.status).toBe(502);
    const json = await res.json<any>();
    expect(json.error).toBe("Selected provider generation failed");
    expect(JSON.stringify(json)).not.toContain(apiKey);
  });

  it("BYOK: missing credential → 404, no platform fallback", async () => {
    first.mockResolvedValueOnce(null);
    const fetchMock = chatFetch();
    vi.stubGlobal("fetch", fetchMock);
    const res = await craft(describeBody({ credentialId: "missing", model: MODEL }));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
