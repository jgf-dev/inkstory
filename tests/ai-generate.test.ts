import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_AI_MODEL,
  MAX_OUTPUT_TOKENS,
  buildSceneMessages,
  generateText,
  isAiConfigured,
} from "../src/lib/ai/generate";
import { POST as generateRoute } from "../src/app/api/ai/generate/route";
import * as codexService from "../src/lib/codex/service";
import * as writingService from "../src/lib/writing/service";
import { CodexError } from "../src/lib/codex/errors";
import * as entitlements from "../src/lib/billing/entitlements";
import { PLANS } from "../src/lib/billing/plans";
import * as tokenBudgeter from "../src/lib/codex/token-budgeter";
import * as prompts from "../src/lib/prompts";
import * as credentials from "../src/lib/ai/credentials";
import { createProvider, ProviderError, type LlmProvider } from "../src/lib/ai/providers";
import { renderDefaultScenePrompt } from "../src/lib/prompts";

const mockGetUser = vi.fn();
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: () => mockGetUser(),
    },
  }),
}));

function fetchPayload(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("AI generation (scene continuation / beat expansion)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe("buildSceneMessages (pure prompt construction)", () => {
    const base = {
      mode: "continuation" as const,
      novelTitle: "Storm Tide",
      chapterTitle: "Chapter 1",
      sceneTitle: "The Quay",
      povLabel: "Third person limited",
      tenseLabel: "Past",
      sceneContent: "Mara reached the quay.",
      summary: null,
      beatText: null,
      codexPrompt:
        "<codex_context>\n<story_bible>\n<entity type='CHARACTER'>Mara</entity>\n</story_bible>\n</codex_context>",
    };

    it("embeds the codex prompt in the system message with POV/tense directives", () => {
      const messages = buildSceneMessages(base);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      // The formatter's wrapper is passed through once, not wrapped again.
      expect(messages[0].content.split("<story_bible>")).toHaveLength(2);
      expect(messages[0].content.split("</story_bible>")).toHaveLength(2);
      expect(messages[0].content).toContain("<entity type='CHARACTER'>Mara</entity>");
      expect(messages[0].content).toContain("third person limited");
      expect(messages[0].content).toContain("past tense");
      expect(messages[1].role).toBe("user");
      expect(messages[1].content).toContain("Mara reached the quay.");
    });

    it("trims overlong prose from the tail", () => {
      const long = "a".repeat(12_000);
      const messages = buildSceneMessages({ ...base, sceneContent: long, maxContentChars: 8000 });
      expect(messages[1].content).toContain("earlier text omitted");
      expect(messages[1].content.length).toBeLessThan(long.length);
      expect(messages[1].content).toContain("a".repeat(8000));
    });

    it("includes the beat text for beat_expansion mode", () => {
      const messages = buildSceneMessages({
        ...base,
        mode: "beat_expansion",
        beatText: "Mara confronts the harbormaster.",
      });
      expect(messages[1].content).toContain("Beat to realize:");
      expect(messages[1].content).toContain("Mara confronts the harbormaster.");
    });
  });

  describe("generateText (gateway client)", () => {
    it("throws 503 AI_NOT_CONFIGURED when no key is set", async () => {
      vi.stubEnv("AI_GATEWAY_API_KEY", "");
      expect(isAiConfigured()).toBe(false);
      await expect(
        generateText({ messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toMatchObject({
        code: "AI_NOT_CONFIGURED",
        status: 503,
      });
    });

    it("posts to the OpenAI-compatible gateway endpoint and parses the completion", async () => {
      vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
      const fetchMock = vi
        .fn()
        .mockResolvedValue(
          fetchPayload({ choices: [{ message: { content: "Continued prose." } }] }),
        );
      vi.stubGlobal("fetch", fetchMock);

      const result = await generateText({
        messages: [{ role: "user", content: "hi" }],
      });

      expect(result.text).toBe("Continued prose.");
      expect(result.model).toBe(DEFAULT_AI_MODEL);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain("/chat/completions");
      const body = JSON.parse(init.body);
      expect(body.model).toBe(DEFAULT_AI_MODEL);
      expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
      expect(init.headers.Authorization).toBe("Bearer test-key");
    });

    it("maps gateway errors to 502", async () => {
      vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(fetchPayload({ error: { message: "quota exceeded" } }, false)),
      );
      await expect(
        generateText({ messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toMatchObject({
        code: "AI_GATEWAY_ERROR",
        status: 502,
      });
    });

    it("maps empty completions to AI_INVALID_RESPONSE", async () => {
      vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchPayload({ choices: [] })));
      await expect(
        generateText({ messages: [{ role: "user", content: "hi" }] }),
      ).rejects.toMatchObject({
        code: "AI_INVALID_RESPONSE",
      });
    });

    it("validates maxTokens options if provided", async () => {
      vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
      await expect(
        generateText({ messages: [{ role: "user", content: "hi" }], maxTokens: 0 }),
      ).rejects.toThrow(TypeError);
      await expect(
        generateText({ messages: [{ role: "user", content: "hi" }], maxTokens: -1 }),
      ).rejects.toThrow(TypeError);
      await expect(
        generateText({ messages: [{ role: "user", content: "hi" }], maxTokens: 1.5 }),
      ).rejects.toThrow(TypeError);
      await expect(
        generateText({
          messages: [{ role: "user", content: "hi" }],
          maxTokens: MAX_OUTPUT_TOKENS + 1,
        }),
      ).rejects.toThrow(TypeError);
    });
  });

  describe("POST /api/ai/generate route", () => {
    const sceneId = "scene-ai-1";
    const editorScene = {
      id: sceneId,
      title: "The Quay",
      content: "Mara reached the quay.",
      summary: null,
      pov: "THIRD_LIMITED",
      tense: "PAST",
      excludeFromAi: false,
      chapterTitle: "Chapter 1",
      novelTitle: "Storm Tide",
      novelId: "novel-1",
      wordCount: 4,
      updatedAt: "2026-10-08T00:00:00.000Z",
    } as any;

    beforeEach(() => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: "ai-user", email: "ai@inkstory.local" } },
      });
      vi.spyOn(entitlements, "getEntitlements").mockResolvedValue(PLANS.FREE);
      vi.spyOn(prompts, "renderResolvedScenePrompt").mockImplementation(
        async (_userId, _novelId, input) => {
          const rendered = renderDefaultScenePrompt(input);
          return {
            ...rendered,
            prompt: {
              id: "sys-prompt-continuation",
              name: "Scene continuation (system default)",
              description: null,
              mode: String(input.mode),
              scope: "SYSTEM_DEFAULT",
              body: "",
              role: "SYSTEM",
              position: 0,
              isActive: true,
              ownerId: null,
              novelId: null,
              updatedAt: "now",
            },
          };
        },
      );
      vi.unstubAllEnvs();
      vi.stubEnv("AI_GATEWAY_API_KEY", "");
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    function prepareByok() {
      vi.spyOn(writingService, "getSceneForEditor").mockResolvedValue(editorScene);
      vi.spyOn(codexService, "assembleCodexContextForScene").mockResolvedValue({
        entries: [],
        meta: {},
      } as any);
      return vi.spyOn(credentials, "createProviderFromCredential");
    }

    function makeRequest(body: unknown) {
      return new NextRequest("http://localhost:3000/api/ai/generate", {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    it("returns 401 when unauthenticated", async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });
      const res = await generateRoute(makeRequest({ sceneId, mode: "continuation" }));
      expect(res.status).toBe(401);
    });

    it("validates the body", async () => {
      const res1 = await generateRoute(makeRequest({ mode: "continuation" }));
      expect(res1.status).toBe(400);
      const res2 = await generateRoute(makeRequest({ sceneId, mode: "haiku" }));
      expect(res2.status).toBe(400);

      for (const invalid of [0, -1, 1.5, "100", MAX_OUTPUT_TOKENS + 1]) {
        const res = await generateRoute(
          makeRequest({ sceneId, mode: "continuation", maxTokens: invalid }),
        );
        expect(res.status).toBe(400);
        const json = await res.json<any>();
        expect(json.code).toBe("VALIDATION_FAILED");
      }
    });

    it("returns 404 when the scene is missing", async () => {
      vi.spyOn(writingService, "getSceneForEditor").mockRejectedValueOnce(
        new CodexError("Scene not found", "NOT_FOUND", 404),
      );
      const res = await generateRoute(makeRequest({ sceneId, mode: "continuation" }));
      expect(res.status).toBe(404);
    });

    it("blocks excluded scenes", async () => {
      vi.spyOn(writingService, "getSceneForEditor").mockResolvedValueOnce({
        ...editorScene,
        excludeFromAi: true,
      });
      const res = await generateRoute(makeRequest({ sceneId, mode: "continuation" }));
      expect(res.status).toBe(403);
      const json = await res.json<any>();
      expect(json.code).toBe("SCENE_EXCLUDED_FROM_AI");
    });

    it("responds 503 with the assembled prompt when the gateway is not configured", async () => {
      vi.spyOn(writingService, "getSceneForEditor").mockResolvedValueOnce(editorScene);
      vi.spyOn(codexService, "assembleCodexContextForScene").mockResolvedValueOnce({
        entries: [],
        meta: {},
      } as any);

      const res = await generateRoute(makeRequest({ sceneId, mode: "continuation" }));
      expect(res.status).toBe(503);
      const json = await res.json<any>();
      expect(json.code).toBe("AI_NOT_CONFIGURED");
      expect(json.prompt.system).toContain("<story_bible>");
      expect(json.prompt.system).toContain("<codex_context>");
      expect(json.prompt.user).toContain("Mara reached the quay.");
    });

    it("generates via the gateway when configured, using client content overrides", async () => {
      vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
      vi.spyOn(writingService, "getSceneForEditor").mockResolvedValueOnce(editorScene);
      vi.spyOn(codexService, "assembleCodexContextForScene").mockResolvedValueOnce({
        entries: [],
        meta: {},
      } as any);
      const fetchMock = vi
        .fn()
        .mockResolvedValue(fetchPayload({ choices: [{ message: { content: "New prose." } }] }));
      vi.stubGlobal("fetch", fetchMock);

      const res = await generateRoute(
        makeRequest({ sceneId, mode: "continuation", content: "Unsaved fresh prose." }),
      );
      expect(res.status).toBe(200);
      const json = await res.json<any>();
      expect(json.text).toBe("New prose.");
      expect(json.model).toBe(DEFAULT_AI_MODEL);

      // Client content override flows into both assembly and the user message.
      expect(codexService.assembleCodexContextForScene).toHaveBeenCalledWith(
        "ai-user",
        expect.objectContaining({ recentProse: "Unsaved fresh prose." }),
      );
      const gatewayBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(gatewayBody.messages[1].content).toContain("Unsaved fresh prose.");
    });

    it("forwards a valid custom maxTokens to the gateway", async () => {
      vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
      vi.spyOn(writingService, "getSceneForEditor").mockResolvedValueOnce(editorScene);
      vi.spyOn(codexService, "assembleCodexContextForScene").mockResolvedValueOnce({
        entries: [],
        meta: {},
      } as any);
      const fetchMock = vi
        .fn()
        .mockResolvedValue(fetchPayload({ choices: [{ message: { content: "New prose." } }] }));
      vi.stubGlobal("fetch", fetchMock);

      const res = await generateRoute(
        makeRequest({ sceneId, mode: "continuation", maxTokens: 500 }),
      );
      expect(res.status).toBe(200);
      const gatewayBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(gatewayBody.max_tokens).toBe(500);
    });

    it("rejects malformed credential/model selections before resolving secrets", async () => {
      const resolve = vi.spyOn(credentials, "createProviderFromCredential");
      for (const extra of [
        { credentialId: null },
        { credentialId: 1 },
        { credentialId: "" },
        { credentialId: " " },
        { credentialId: "x".repeat(129), model: "m" },
        { credentialId: "saved" },
        { credentialId: "saved", model: null },
        { credentialId: "saved", model: 12 },
        { credentialId: "saved", model: " " },
        { credentialId: "saved", model: "m".repeat(257) },
        { model: "model-without-credential" },
      ]) {
        const response = await generateRoute(
          makeRequest({ sceneId, mode: "continuation", ...extra }),
        );
        expect(response.status).toBe(400);
        expect((await response.json<any>()).code).toBe("VALIDATION_FAILED");
      }
      expect(resolve).not.toHaveBeenCalled();
    });

    it.each(["", "platform-key"])(
      "uses selected credential, not gateway (gateway key=%s)",
      async (gatewayKey) => {
        vi.stubEnv("AI_GATEWAY_API_KEY", gatewayKey);
        const resolve = prepareByok();
        const chat = vi.fn().mockResolvedValue({
          text: "BYOK prose",
          model: "served-model",
          apiKey: "must-not-leak",
          ciphertext: "must-not-leak",
        });
        resolve.mockResolvedValue({ id: "openrouter", chat } as unknown as LlmProvider);
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const request = makeRequest({
          sceneId,
          mode: "beat_expansion",
          credentialId: "saved",
          model: "  vendor/model  ",
          content: "Fresh prose",
          maxTokens: 256,
        });
        const response = await generateRoute(request);
        expect(response.status).toBe(200);
        const json = await response.json<any>();
        expect(json).toMatchObject({ text: "BYOK prose", model: "served-model" });
        expect(json.applied).toEqual({
          provider: "openrouter",
          requestedModel: "vendor/model",
          model: "served-model",
          endpoint: null,
          parameters: { max_tokens: 256, temperature: 0.7 },
          routing: null,
          avoidanceGuidance: "none",
        });
        expect(JSON.stringify(json)).not.toContain("must-not-leak");
        expect(resolve).toHaveBeenCalledExactlyOnceWith("ai-user", "saved");
        expect(chat).toHaveBeenCalledWith({
          model: "vendor/model",
          messages: expect.any(Array),
          maxOutputTokens: 256,
          temperature: 0.7,
          signal: request.signal,
        });
        expect(chat.mock.calls[0][0].messages[1].content).toContain("Fresh prose");
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it.each(["openrouter", "openai", "anthropic", "ollama", "lmstudio"] as const)(
      "dispatches through the existing %s adapter without transport changes",
      async (provider) => {
        const resolve = prepareByok();
        const fetchMock = vi
          .fn()
          .mockResolvedValue(
            fetchPayload(
              provider === "anthropic"
                ? { model: "native-model", content: [{ type: "text", text: "Adapter prose" }] }
                : { model: "native-model", choices: [{ message: { content: "Adapter prose" } }] },
            ),
          );
        vi.stubGlobal("fetch", fetchMock);
        resolve.mockResolvedValue(createProvider({ provider, apiKey: "saved-key" }));
        const response = await generateRoute(
          makeRequest({
            sceneId,
            mode: "continuation",
            credentialId: "saved",
            model: "native-model",
          }),
        );
        expect(response.status).toBe(200);
        const json = await response.json<any>();
        expect(json).toMatchObject({ text: "Adapter prose", model: "native-model" });
        expect(json.applied.provider).toBe(provider);
        expect(JSON.stringify(json)).not.toContain("saved-key");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).not.toContain("ai-gateway.vercel.sh");
        const sent = JSON.parse(init.body);
        expect(sent.model).toBe("native-model");
        expect(sent.max_tokens).toBe(1024);
        expect(sent.temperature).toBe(0.7);
        expect(sent.messages.at(-1).content).toContain("Mara reached the quay.");
      },
    );

    it.each(["KEY_MISSING", "DECRYPT_FAILED"] as const)(
      "handles crypto failure %s without leaking or falling back",
      async (code) => {
        vi.stubEnv("AI_GATEWAY_API_KEY", "platform-key");
        prepareByok().mockRejectedValue(new credentials.ByokCryptoError("secret ciphertext", code));
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const response = await generateRoute(
          makeRequest({ sceneId, mode: "continuation", credentialId: "saved", model: "m" }),
        );
        expect(response.status).toBe(code === "KEY_MISSING" ? 503 : 500);
        expect(await response.json()).toEqual({
          error: "Credential encryption is not available",
          code: "CRYPTO_ERROR",
        });
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it.each(["AUTH_FAILED", "INVALID_REQUEST", "RATE_LIMITED"] as const)(
      "reports provider failure %s without upstream secrets",
      async (code) => {
        vi.stubEnv("AI_GATEWAY_API_KEY", "platform-key");
        const chat = vi
          .fn()
          .mockRejectedValue(new ProviderError("secret key/ciphertext", code, "openai"));
        prepareByok().mockResolvedValue({ id: "openai", chat } as unknown as LlmProvider);
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        const response = await generateRoute(
          makeRequest({ sceneId, mode: "continuation", credentialId: "saved", model: "m" }),
        );
        expect(response.status).toBe(code === "INVALID_REQUEST" ? 400 : 502);
        expect(await response.json()).toEqual({
          error: "Selected provider generation failed",
          code,
        });
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it("does not resolve a credential for unauthenticated or excluded scenes", async () => {
      const resolve = prepareByok();
      const input = { sceneId, mode: "continuation", credentialId: "saved", model: "m" };
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });
      expect((await generateRoute(makeRequest(input))).status).toBe(401);
      vi.mocked(writingService.getSceneForEditor).mockResolvedValueOnce({
        ...editorScene,
        excludeFromAi: true,
      });
      expect((await generateRoute(makeRequest(input))).status).toBe(403);
      expect(resolve).not.toHaveBeenCalled();
    });

    it("caps the prompt context at the user's tier token ceiling", async () => {
      vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
      vi.mocked(entitlements.getEntitlements).mockResolvedValueOnce(PLANS.PRO);
      const budgetSpy = vi.spyOn(tokenBudgeter, "applyTokenBudget");
      vi.spyOn(writingService, "getSceneForEditor").mockResolvedValueOnce(editorScene);
      vi.spyOn(codexService, "assembleCodexContextForScene").mockResolvedValueOnce({
        entries: [],
        meta: {},
      } as any);
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(fetchPayload({ choices: [{ message: { content: "New prose." } }] })),
      );

      const res = await generateRoute(makeRequest({ sceneId, mode: "continuation" }));
      expect(res.status).toBe(200);
      expect(entitlements.getEntitlements).toHaveBeenCalledWith("ai-user");
      expect(budgetSpy).toHaveBeenCalledWith(expect.anything(), {
        maxTokens: PLANS.PRO.maxContextTokens,
      });
      budgetSpy.mockRestore();
    });
  });
});
