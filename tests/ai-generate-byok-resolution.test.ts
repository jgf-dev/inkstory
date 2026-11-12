import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { POST } from "../src/app/api/ai/generate/route";
import { encryptSecret } from "../src/lib/ai/credentials/crypto";

const { first, where, getUser, getScene } = vi.hoisted(() => ({
  first: vi.fn(),
  where: vi.fn(),
  getUser: vi.fn(),
  getScene: vi.fn(),
}));
vi.mock("../src/lib/prisma", () => ({
  db: {
    orm: {
      public: {
        UserProviderCredential: { where },
      },
    },
  },
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
    messages: [{ role: "user", content: "Continue the scene." }],
    unresolved: [],
    unknownTokens: [],
    joined: "Continue the scene.",
  }),
}));

const apiKey = "sk-test-server-only-1234";
function request() {
  return new NextRequest("http://localhost/api/ai/generate", {
    method: "POST",
    body: JSON.stringify({
      sceneId: "scene",
      mode: "continuation",
      credentialId: "credential",
      model: "native-model",
    }),
  });
}
function row(extra: Record<string, unknown> = {}) {
  return {
    id: "credential",
    ownerId: "owner",
    provider: "OPENAI",
    label: "Default",
    keyHint: "1234",
    deletedAt: null,
    baseUrl: null,
    updatedAt: { toString: () => "2026-11-09T00:00:00" },
    ...encryptSecret(apiKey),
    ...extra,
  };
}

beforeEach(() => {
  vi.stubEnv("BYOK_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("AI_GATEWAY_API_KEY", "platform-key");
  where.mockReturnValue({ first });
  getUser.mockResolvedValue({ data: { user: { id: "owner" } } });
  getScene.mockResolvedValue({
    id: "scene",
    novelId: "novel",
    content: "Prose",
    excludeFromAi: false,
  });
});
afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("scene generate with real credential resolution + encryption", () => {
  it("decrypts only server-side and sends saved key to the existing adapter", async () => {
    first.mockResolvedValue(row());
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: "served-model",
          choices: [{ message: { content: "New prose." } }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request());
    expect(response.status).toBe(200);
    const json = (await response.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ text: "New prose.", model: "served-model" });
    expect(JSON.stringify(json)).not.toContain(apiKey);
    expect(where).toHaveBeenCalledWith({ id: "credential" });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(init.headers.Authorization).toBe(`Bearer ${apiKey}`);
    expect(JSON.parse(init.body)).toMatchObject({ model: "native-model", max_tokens: 1024 });
  });

  it.each(["missing", "foreign", "deleted"])(
    "rejects %s credentials without provider or gateway spend",
    async (state) => {
      first.mockResolvedValue(
        state === "missing"
          ? null
          : row(state === "foreign" ? { ownerId: "another-user" } : { deletedAt: "deleted" }),
      );
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const response = await POST(request());
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Credential not found", code: "NOT_FOUND" });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("fails closed on a corrupt encrypted key without exposing crypto material", async () => {
    first.mockResolvedValue(row({ authTag: Buffer.alloc(16) }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Credential encryption is not available",
      code: "CRYPTO_ERROR",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
