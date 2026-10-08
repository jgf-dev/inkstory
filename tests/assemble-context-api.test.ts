import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { POST as assembleContextRoute } from "../src/app/api/codex/assemble-context/route";
import * as codexService from "../src/lib/codex/service";
import { CodexError } from "../src/lib/codex/service";

const mockGetUser = vi.fn();
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: () => mockGetUser(),
    },
  }),
}));

describe("POST /api/codex/assemble-context", () => {
  const userId = "api-asm-user-1";
  const assembledFixture = {
    context: {
      entries: [],
      meta: {
        totalCandidates: 0,
        finalCount: 0,
        truncated: false,
        sceneId: "scene-1",
        maxTokens: 4000,
        estimatedTokensBefore: 60,
        estimatedTokensAfter: 60,
        droppedEntryIds: [],
        truncatedEntryIds: [],
      },
    },
    prompt: "<codex_context>\n<story_bible>\n</story_bible>\n</codex_context>",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: userId, email: "api-asm@inkstory.local" } },
    });
  });

  function makeRequest(body: unknown): Promise<Response> {
    return assembleContextRoute(
      new NextRequest("http://localhost:3000/api/codex/assemble-context", {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  }

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    const res = await makeRequest({ sceneId: "scene-1" });

    expect(res.status).toBe(401);
  });

  it("returns 400 when sceneId is missing", async () => {
    const res = await makeRequest({});

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("VALIDATION_FAILED");
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await makeRequest("{not json");

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("INVALID_JSON");
  });

  it("returns 400 for invalid field types", async () => {
    expect((await makeRequest({ sceneId: "s", beatText: 42 })).status).toBe(400);
    expect((await makeRequest({ sceneId: "s", manualAttachmentIds: "x" })).status).toBe(400);
    expect((await makeRequest({ sceneId: "s", options: { maxTokens: -1 } })).status).toBe(400);
    expect((await makeRequest({ sceneId: "s", options: { maxTokens: "4k" } })).status).toBe(400);
    expect(
      (await makeRequest({ sceneId: "s", options: { includeSeriesCodex: "yes" } })).status,
    ).toBe(400);
    expect((await makeRequest({ sceneId: "s", options: "nope" })).status).toBe(400);
  });

  it("returns the assembled context and prompt on success", async () => {
    const spy = vi
      .spyOn(codexService, "assembleSceneContext")
      .mockResolvedValueOnce(assembledFixture);

    const res = await makeRequest({
      sceneId: "scene-1",
      beatText: "Beat text",
      recentProse: "Prose",
      manualAttachmentIds: ["entry-1"],
      options: { maxTokens: 3000, maxRelationDepth: 2, includeSeriesCodex: true },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(assembledFixture);
    expect(spy).toHaveBeenCalledWith(userId, {
      sceneId: "scene-1",
      beatText: "Beat text",
      recentProse: "Prose",
      manualAttachmentIds: ["entry-1"],
      options: { maxTokens: 3000, maxRelationDepth: 2, includeSeriesCodex: true },
    });
  });

  it("maps service errors to their HTTP status codes", async () => {
    vi.spyOn(codexService, "assembleSceneContext").mockRejectedValueOnce(
      new CodexError("Scene not found", "NOT_FOUND", 404),
    );
    expect((await makeRequest({ sceneId: "missing" })).status).toBe(404);

    vi.spyOn(codexService, "assembleSceneContext").mockRejectedValueOnce(
      new CodexError("Unauthorized to access scene", "FORBIDDEN", 403),
    );
    expect((await makeRequest({ sceneId: "scene-1" })).status).toBe(403);

    vi.spyOn(codexService, "assembleSceneContext").mockRejectedValueOnce(new Error("boom"));
    expect((await makeRequest({ sceneId: "scene-1" })).status).toBe(500);
  });
});
