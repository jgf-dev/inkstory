import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { POST as previewRoute } from "../src/app/api/ai/preview/route";
import { POST as duplicateRoute } from "../src/app/api/prompts/[id]/duplicate/route";
import { PATCH as patchPromptRoute } from "../src/app/api/prompts/[id]/route";
import * as writingService from "../src/lib/writing/service";
import * as codexService from "../src/lib/codex/service";
import * as entitlements from "../src/lib/billing/entitlements";
import * as prompts from "../src/lib/prompts";
import { PLANS } from "../src/lib/billing/plans";

const mockGetUser = vi.fn();
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}));

describe("prompt preview + read-only API (STO-1158)", () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preview returns messages[] + joined and never calls a provider", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    vi.spyOn(writingService, "getSceneForEditor").mockResolvedValue({
      id: "scene-1",
      title: "Quay",
      content: "Prose.",
      summary: null,
      label: null,
      pov: "THIRD_LIMITED",
      tense: "PAST",
      excludeFromAi: false,
      wordCount: 1,
      updatedAt: "now",
      chapterId: "ch-1",
      chapterTitle: "Ch1",
      actTitle: "Act I",
      novelId: "novel-1",
      novelTitle: "Storm",
    });

    vi.spyOn(codexService, "assembleCodexContextForScene").mockResolvedValue({
      entries: [],
      meta: { totalCandidates: 0, finalCount: 0, truncated: false, sceneId: "scene-1" },
    });
    vi.spyOn(entitlements, "getEntitlements").mockResolvedValue(PLANS.FREE);

    vi.spyOn(prompts, "renderResolvedScenePrompt").mockResolvedValue({
      messages: [
        { role: "system", content: "SYS" },
        { role: "user", content: "USR" },
      ],
      joined: "--- system ---\nSYS\n\n--- user ---\nUSR",
      unresolved: [],
      unknownTokens: [],
      prompt: {
        id: "sys-prompt-continuation",
        name: "Scene continuation (system default)",
        description: null,
        mode: "continuation",
        scope: "SYSTEM_DEFAULT",
        body: "",
        role: "SYSTEM",
        position: 0,
        isActive: true,
        ownerId: null,
        novelId: null,
        updatedAt: "now",
      },
    });

    const req = new NextRequest("http://localhost/api/ai/preview", {
      method: "POST",
      body: JSON.stringify({ sceneId: "scene-1", mode: "continuation" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await previewRoute(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      messages: unknown[];
      joined: string;
      prompt: { scope: string };
    };
    expect(body.messages).toHaveLength(2);
    expect(body.joined).toContain("--- system ---");
    expect(body.prompt.scope).toBe("SYSTEM_DEFAULT");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("PATCH on SYSTEM_DEFAULT returns 403 READ_ONLY", async () => {
    vi.spyOn(prompts, "updatePrompt").mockRejectedValue(
      new prompts.PromptError("SYSTEM_DEFAULT prompts are read-only", "READ_ONLY", 403),
    );
    const req = new NextRequest("http://localhost/api/prompts/sys-1", {
      method: "PATCH",
      body: JSON.stringify({ name: "nope" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await patchPromptRoute(req, { params: Promise.resolve({ id: "sys-1" }) });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("READ_ONLY");
  });

  it("duplicate endpoint returns 201 with USER-scoped copy", async () => {
    vi.spyOn(prompts, "duplicatePromptToLibrary").mockResolvedValue({
      id: "copy-1",
      name: "Scene continuation (system default) (copy)",
      description: null,
      mode: "continuation",
      scope: "USER",
      body: "",
      role: "SYSTEM",
      position: 0,
      isActive: true,
      ownerId: "user-1",
      novelId: null,
      updatedAt: "now",
    });
    const req = new NextRequest("http://localhost/api/prompts/sys-1/duplicate", {
      method: "POST",
    });
    const res = await duplicateRoute(req, { params: Promise.resolve({ id: "sys-1" }) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { prompt: { scope: string; ownerId: string } };
    expect(body.prompt.scope).toBe("USER");
    expect(body.prompt.ownerId).toBe("user-1");
  });
});
