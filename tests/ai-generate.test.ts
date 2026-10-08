import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_AI_MODEL,
  buildSceneMessages,
  generateText,
  isAiConfigured,
} from "../src/lib/ai/generate";
import { POST as generateRoute } from "../src/app/api/ai/generate/route";
import * as codexService from "../src/lib/codex/service";
import * as writingService from "../src/lib/writing/service";
import { CodexError } from "../src/lib/codex/errors";

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
      codexPrompt: "<entity type='CHARACTER'>Mara</entity>",
    };

    it("embeds the codex prompt in the system message with POV/tense directives", () => {
      const messages = buildSceneMessages(base);
      expect(messages).toHaveLength(2);
      expect(messages[0].role).toBe("system");
      expect(messages[0].content).toContain("<story_bible>");
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
      vi.unstubAllEnvs();
      vi.stubEnv("AI_GATEWAY_API_KEY", "");
    });

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
      const json = await res.json();
      expect(json.code).toBe("SCENE_EXCLUDED_FROM_AI");
    });

    it("responds 503 with the assembled prompt when the gateway is not configured", async () => {
      vi.spyOn(writingService, "getSceneForEditor").mockResolvedValueOnce(editorScene);
      vi.spyOn(codexService, "assembleSceneContext").mockResolvedValueOnce({
        context: { entries: [], meta: {} } as any,
        prompt: "<codex_context></codex_context>",
      });

      const res = await generateRoute(makeRequest({ sceneId, mode: "continuation" }));
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.code).toBe("AI_NOT_CONFIGURED");
      expect(json.prompt.system).toContain("<story_bible>");
      expect(json.prompt.system).toContain("<codex_context></codex_context>");
      expect(json.prompt.user).toContain("Mara reached the quay.");
    });

    it("generates via the gateway when configured, using client content overrides", async () => {
      vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
      vi.spyOn(writingService, "getSceneForEditor").mockResolvedValueOnce(editorScene);
      vi.spyOn(codexService, "assembleSceneContext").mockResolvedValueOnce({
        context: { entries: [], meta: {} } as any,
        prompt: "<codex_context></codex_context>",
      });
      const fetchMock = vi
        .fn()
        .mockResolvedValue(fetchPayload({ choices: [{ message: { content: "New prose." } }] }));
      vi.stubGlobal("fetch", fetchMock);

      const res = await generateRoute(
        makeRequest({ sceneId, mode: "continuation", content: "Unsaved fresh prose." }),
      );
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.text).toBe("New prose.");
      expect(json.model).toBe(DEFAULT_AI_MODEL);

      // Client content override flows into both assembly and the user message.
      expect(codexService.assembleSceneContext).toHaveBeenCalledWith(
        "ai-user",
        expect.objectContaining({ recentProse: "Unsaved fresh prose." }),
      );
      const gatewayBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(gatewayBody.messages[1].content).toContain("Unsaved fresh prose.");
    });
  });
});
