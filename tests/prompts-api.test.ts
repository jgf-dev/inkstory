import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { POST as previewRoute } from "../src/app/api/ai/preview/route";
import { POST as duplicateRoute } from "../src/app/api/prompts/[id]/duplicate/route";
import {
  GET as getPromptRoute,
  PATCH as patchPromptRoute,
  DELETE as deletePromptRoute,
} from "../src/app/api/prompts/[id]/route";
import { GET as listPromptsRoute, POST as createPromptRoute } from "../src/app/api/prompts/route";
import {
  GET as listComponentsRoute,
  POST as createComponentRoute,
} from "../src/app/api/prompts/components/route";
import {
  PATCH as patchComponentRoute,
  DELETE as deleteComponentRoute,
} from "../src/app/api/prompts/components/[id]/route";
import * as writingService from "../src/lib/writing/service";
import * as codexService from "../src/lib/codex/service";
import * as entitlements from "../src/lib/billing/entitlements";
import * as prompts from "../src/lib/prompts";
import { CodexError } from "../src/lib/codex/errors";
import { PLANS } from "../src/lib/billing/plans";

const mockGetUser = vi.fn();
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}));

describe("prompt preview + API routes (STO-1158)", () => {
  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/ai/preview", () => {
    it("preview returns messages[] + joined and never calls a provider", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      vi.spyOn(writingService, "getSceneForEditor").mockResolvedValue({
        id: "scene-1",
        title: "Quay",
        content: "Prose.",
        contentDoc: null,
        contentFormat: "PLAIN" as const,
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

    it("returns 401 when unauthorized", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const req = new NextRequest("http://localhost/api/ai/preview", {
        method: "POST",
        body: JSON.stringify({ sceneId: "scene-1", mode: "continuation" }),
      });
      const res = await previewRoute(req);
      expect(res.status).toBe(401);
    });

    it("validates missing sceneId and invalid mode", async () => {
      let req = new NextRequest("http://localhost/api/ai/preview", {
        method: "POST",
        body: JSON.stringify({ mode: "continuation" }),
      });
      let res = await previewRoute(req);
      expect(res.status).toBe(400);

      req = new NextRequest("http://localhost/api/ai/preview", {
        method: "POST",
        body: JSON.stringify({ sceneId: "scene-1", mode: "invalid-mode" }),
      });
      res = await previewRoute(req);
      expect(res.status).toBe(400);
    });

    it("returns 403 when scene is excluded from AI", async () => {
      vi.spyOn(writingService, "getSceneForEditor").mockResolvedValue({
        id: "scene-1",
        title: "Quay",
        content: "Prose.",
        contentDoc: null,
        contentFormat: "PLAIN" as const,
        summary: null,
        label: null,
        pov: "THIRD_LIMITED",
        tense: "PAST",
        excludeFromAi: true,
        wordCount: 1,
        updatedAt: "now",
        chapterId: "ch-1",
        chapterTitle: "Ch1",
        actTitle: "Act I",
        novelId: "novel-1",
        novelTitle: "Storm",
      });
      const req = new NextRequest("http://localhost/api/ai/preview", {
        method: "POST",
        body: JSON.stringify({ sceneId: "scene-1", mode: "continuation" }),
      });
      const res = await previewRoute(req);
      expect(res.status).toBe(403);
      const json = (await res.json()) as { code: string };
      expect(json.code).toBe("SCENE_EXCLUDED_FROM_AI");
    });

    it("handles PromptError and CodexError properly", async () => {
      vi.spyOn(writingService, "getSceneForEditor").mockRejectedValue(
        new CodexError("Scene not found", "NOT_FOUND", 404),
      );
      const req = new NextRequest("http://localhost/api/ai/preview", {
        method: "POST",
        body: JSON.stringify({ sceneId: "scene-1", mode: "continuation" }),
      });
      const res = await previewRoute(req);
      expect(res.status).toBe(404);
    });
  });

  describe("Prompt CRUD routes", () => {
    it("lists prompts with query filters", async () => {
      const mockList = vi.spyOn(prompts, "listPrompts").mockResolvedValue([]);
      const req = new NextRequest(
        "http://localhost/api/prompts?mode=continuation&novelId=n1&includeSystem=false",
      );
      const res = await listPromptsRoute(req);
      expect(res.status).toBe(200);
      expect(mockList).toHaveBeenCalledWith("user-1", {
        mode: "continuation",
        novelId: "n1",
        includeSystem: false,
      });
    });

    it("rejects unauthorized GET and POST on /api/prompts", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const reqGet = new NextRequest("http://localhost/api/prompts");
      const resGet = await listPromptsRoute(reqGet);
      expect(resGet.status).toBe(401);

      const reqPost = new NextRequest("http://localhost/api/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "P" }),
      });
      const resPost = await createPromptRoute(reqPost);
      expect(resPost.status).toBe(401);
    });

    it("creates a prompt via POST /api/prompts", async () => {
      vi.spyOn(prompts, "createPrompt").mockResolvedValue({
        id: "p1",
        name: "New Prompt",
        description: null,
        mode: "continuation",
        scope: "USER",
        body: "body",
        role: "USER",
        position: 0,
        isActive: true,
        ownerId: "user-1",
        novelId: null,
        updatedAt: "now",
      });
      const req = new NextRequest("http://localhost/api/prompts", {
        method: "POST",
        body: JSON.stringify({ name: "New Prompt", mode: "continuation" }),
      });
      const res = await createPromptRoute(req);
      expect(res.status).toBe(201);
      const json = (await res.json()) as { prompt: { id: string } };
      expect(json.prompt.id).toBe("p1");
    });

    it("gets, updates, and deletes prompt via /api/prompts/[id]", async () => {
      vi.spyOn(prompts, "getPrompt").mockResolvedValue({
        id: "p1",
        name: "Existing",
        description: null,
        mode: "continuation",
        scope: "USER",
        body: "body",
        role: "USER",
        position: 0,
        isActive: true,
        ownerId: "user-1",
        novelId: null,
        updatedAt: "now",
      });
      vi.spyOn(prompts, "updatePrompt").mockResolvedValue({
        id: "p1",
        name: "Updated",
        description: null,
        mode: "continuation",
        scope: "USER",
        body: "body",
        role: "USER",
        position: 0,
        isActive: true,
        ownerId: "user-1",
        novelId: null,
        updatedAt: "now",
      });
      vi.spyOn(prompts, "softDeletePrompt").mockResolvedValue();

      // GET
      const reqGet = new NextRequest("http://localhost/api/prompts/p1");
      const resGet = await getPromptRoute(reqGet, { params: Promise.resolve({ id: "p1" }) });
      expect(resGet.status).toBe(200);

      // PATCH
      const reqPatch = new NextRequest("http://localhost/api/prompts/p1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Updated" }),
      });
      const resPatch = await patchPromptRoute(reqPatch, { params: Promise.resolve({ id: "p1" }) });
      expect(resPatch.status).toBe(200);

      // DELETE
      const reqDel = new NextRequest("http://localhost/api/prompts/p1", { method: "DELETE" });
      const resDel = await deletePromptRoute(reqDel, { params: Promise.resolve({ id: "p1" }) });
      expect(resDel.status).toBe(200);
      const delJson = (await resDel.json()) as { ok: boolean };
      expect(delJson.ok).toBe(true);
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

  describe("Component CRUD routes", () => {
    it("lists and creates components", async () => {
      vi.spyOn(prompts, "listComponents").mockResolvedValue([]);
      vi.spyOn(prompts, "createComponent").mockResolvedValue({
        id: "c1",
        name: "Comp 1",
        description: null,
        body: "text",
        role: "USER",
        contract: null,
        ownerId: "user-1",
        updatedAt: "now",
      });

      const resList = await listComponentsRoute();
      expect(resList.status).toBe(200);

      const reqPost = new NextRequest("http://localhost/api/prompts/components", {
        method: "POST",
        body: JSON.stringify({ name: "Comp 1", body: "text" }),
      });
      const resPost = await createComponentRoute(reqPost);
      expect(resPost.status).toBe(201);
      const json = (await resPost.json()) as { component: { id: string } };
      expect(json.component.id).toBe("c1");
    });

    it("updates and soft-deletes components", async () => {
      vi.spyOn(prompts, "updateComponent").mockResolvedValue({
        id: "c1",
        name: "Comp Updated",
        description: null,
        body: "text",
        role: "USER",
        contract: null,
        ownerId: "user-1",
        updatedAt: "now",
      });
      vi.spyOn(prompts, "softDeleteComponent").mockResolvedValue();

      const reqPatch = new NextRequest("http://localhost/api/prompts/components/c1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Comp Updated" }),
      });
      const resPatch = await patchComponentRoute(reqPatch, {
        params: Promise.resolve({ id: "c1" }),
      });
      expect(resPatch.status).toBe(200);

      const reqDel = new NextRequest("http://localhost/api/prompts/components/c1", {
        method: "DELETE",
      });
      const resDel = await deleteComponentRoute(reqDel, { params: Promise.resolve({ id: "c1" }) });
      expect(resDel.status).toBe(200);
    });

    it("rejects unauthorized component requests", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const resList = await listComponentsRoute();
      expect(resList.status).toBe(401);

      const reqPost = new NextRequest("http://localhost/api/prompts/components", {
        method: "POST",
        body: JSON.stringify({ name: "c", body: "b" }),
      });
      const resPost = await createComponentRoute(reqPost);
      expect(resPost.status).toBe(401);

      const reqPatch = new NextRequest("http://localhost/api/prompts/components/c1", {
        method: "PATCH",
      });
      const resPatch = await patchComponentRoute(reqPatch, {
        params: Promise.resolve({ id: "c1" }),
      });
      expect(resPatch.status).toBe(401);

      const reqDel = new NextRequest("http://localhost/api/prompts/components/c1", {
        method: "DELETE",
      });
      const resDel = await deleteComponentRoute(reqDel, { params: Promise.resolve({ id: "c1" }) });
      expect(resDel.status).toBe(401);
    });
  });
});
