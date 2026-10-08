import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  DELETE as deleteOutline,
  GET as getOutline,
  PATCH as patchOutline,
  POST as postOutline,
} from "../src/app/api/novels/[id]/outline/route";
import { GET as getScene, PATCH as patchScene } from "../src/app/api/scenes/[id]/route";
import { GET as getSceneContext } from "../src/app/api/scenes/[id]/context/route";
import { POST as postAttachment } from "../src/app/api/scenes/[id]/attachments/route";
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

describe("Writing REST Route Handlers", () => {
  const userId = "writing-api-user";
  const novelId = "novel-1";
  const sceneId = "scene-1";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: userId, email: "writing@inkstory.local" } },
    });
  });

  describe("auth guard", () => {
    it("returns 401 on outline GET when unauthenticated", async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });
      const req = new NextRequest(`http://localhost:3000/api/novels/${novelId}/outline`);
      const res = await getOutline(req, { params: Promise.resolve({ id: novelId }) });
      expect(res.status).toBe(401);
    });

    it("returns 401 on scene PATCH when unauthenticated", async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });
      const req = new NextRequest(`http://localhost:3000/api/scenes/${sceneId}`, {
        method: "PATCH",
        body: JSON.stringify({ content: "x" }),
      });
      const res = await patchScene(req, { params: Promise.resolve({ id: sceneId }) });
      expect(res.status).toBe(401);
    });
  });

  describe("GET/PATCH/POST/DELETE outline", () => {
    it("returns the outline tree", async () => {
      const outline = {
        novel: { id: novelId, title: "N" },
        acts: [],
        totals: { acts: 0, chapters: 0, scenes: 0, words: 0 },
      } as any;
      vi.spyOn(writingService, "getNovelOutline").mockResolvedValueOnce(outline);

      const req = new NextRequest(`http://localhost:3000/api/novels/${novelId}/outline`);
      const res = await getOutline(req, { params: Promise.resolve({ id: novelId }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.outline).toEqual(outline);
    });

    it("creates a scene node and returns 201", async () => {
      const created = { kind: "scene", node: { id: "scene-2", title: "New Scene" } } as any;
      vi.spyOn(writingService, "createOutlineNode").mockResolvedValueOnce(created);

      const req = new NextRequest(`http://localhost:3000/api/novels/${novelId}/outline`, {
        method: "POST",
        body: JSON.stringify({ kind: "scene", parentId: "chapter-1" }),
      });
      const res = await postOutline(req, { params: Promise.resolve({ id: novelId }) });
      expect(res.status).toBe(201);
      expect(writingService.createOutlineNode).toHaveBeenCalledWith(
        userId,
        novelId,
        expect.objectContaining({ kind: "scene", parentId: "chapter-1" }),
      );
    });

    it("rejects invalid kind on create", async () => {
      const req = new NextRequest(`http://localhost:3000/api/novels/${novelId}/outline`, {
        method: "POST",
        body: JSON.stringify({ kind: "paragraph" }),
      });
      const res = await postOutline(req, { params: Promise.resolve({ id: novelId }) });
      expect(res.status).toBe(400);
    });

    it("maps service errors to status codes", async () => {
      vi.spyOn(writingService, "createOutlineNode").mockRejectedValueOnce(
        new CodexError("Act not found in this novel", "NOT_FOUND", 404),
      );
      const req = new NextRequest(`http://localhost:3000/api/novels/${novelId}/outline`, {
        method: "POST",
        body: JSON.stringify({ kind: "chapter", parentId: "nope" }),
      });
      const res = await postOutline(req, { params: Promise.resolve({ id: novelId }) });
      expect(res.status).toBe(404);
    });

    it("renames and/or moves on PATCH", async () => {
      vi.spyOn(writingService, "renameOutlineNode").mockResolvedValueOnce({
        id: "scene-1",
        kind: "scene",
        title: "Renamed",
      } as any);
      vi.spyOn(writingService, "moveOutlineNode").mockResolvedValueOnce({
        id: "scene-1",
        kind: "scene",
        moved: true,
      } as any);

      const req = new NextRequest(`http://localhost:3000/api/novels/${novelId}/outline`, {
        method: "PATCH",
        body: JSON.stringify({ kind: "scene", id: "scene-1", title: "Renamed", direction: "up" }),
      });
      const res = await patchOutline(req, { params: Promise.resolve({ id: novelId }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.renamed.title).toBe("Renamed");
      expect(json.moved.moved).toBe(true);
    });

    it("rejects PATCH without title or direction", async () => {
      const req = new NextRequest(`http://localhost:3000/api/novels/${novelId}/outline`, {
        method: "PATCH",
        body: JSON.stringify({ kind: "scene", id: "scene-1" }),
      });
      const res = await patchOutline(req, { params: Promise.resolve({ id: novelId }) });
      expect(res.status).toBe(400);
    });

    it("soft-deletes via DELETE with kind and nodeId", async () => {
      vi.spyOn(writingService, "deleteOutlineNode").mockResolvedValueOnce({
        id: "scene-1",
        kind: "scene",
        deleted: true,
      } as any);
      const req = new NextRequest(
        `http://localhost:3000/api/novels/${novelId}/outline?kind=scene&nodeId=scene-1`,
        { method: "DELETE" },
      );
      const res = await deleteOutline(req, { params: Promise.resolve({ id: novelId }) });
      expect(res.status).toBe(200);
      expect(writingService.deleteOutlineNode).toHaveBeenCalledWith(
        userId,
        novelId,
        "scene",
        "scene-1",
      );
    });
  });

  describe("scene editor routes", () => {
    it("GET returns the editor scene", async () => {
      const scene = { id: sceneId, title: "S", content: "" } as any;
      vi.spyOn(writingService, "getSceneForEditor").mockResolvedValueOnce(scene);

      const req = new NextRequest(`http://localhost:3000/api/scenes/${sceneId}`);
      const res = await getScene(req, { params: Promise.resolve({ id: sceneId }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.scene).toEqual(scene);
    });

    it("PATCH saves content and recomputes word count server-side", async () => {
      const scene = { id: sceneId, content: "hello world", wordCount: 2 } as any;
      vi.spyOn(writingService, "updateScene").mockResolvedValueOnce(scene);

      const req = new NextRequest(`http://localhost:3000/api/scenes/${sceneId}`, {
        method: "PATCH",
        body: JSON.stringify({ content: "hello world" }),
      });
      const res = await patchScene(req, { params: Promise.resolve({ id: sceneId }) });
      expect(res.status).toBe(200);
      expect(writingService.updateScene).toHaveBeenCalledWith(userId, sceneId, {
        content: "hello world",
      });
    });

    it("PATCH with an empty body returns 400", async () => {
      const req = new NextRequest(`http://localhost:3000/api/scenes/${sceneId}`, {
        method: "PATCH",
        body: JSON.stringify({}),
      });
      const res = await patchScene(req, { params: Promise.resolve({ id: sceneId }) });
      expect(res.status).toBe(400);
    });
  });

  describe("scene context + attachments", () => {
    it("GET context returns drawer data", async () => {
      const data = {
        scene: { id: sceneId },
        attachments: [],
        estimate: { maxTokens: 4000 },
      } as any;
      vi.spyOn(writingService, "getSceneContextData").mockResolvedValueOnce(data);

      const req = new NextRequest(`http://localhost:3000/api/scenes/${sceneId}/context`);
      const res = await getSceneContext(req, { params: Promise.resolve({ id: sceneId }) });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.estimate.maxTokens).toBe(4000);
    });

    it("POST attachments validates entryId and attach", async () => {
      const bad = new NextRequest(`http://localhost:3000/api/scenes/${sceneId}/attachments`, {
        method: "POST",
        body: JSON.stringify({ entryId: "e" }),
      });
      const res = await postAttachment(bad, { params: Promise.resolve({ id: sceneId }) });
      expect(res.status).toBe(400);

      vi.spyOn(writingService, "setSceneAttachment").mockResolvedValueOnce({
        sceneId,
        entryId: "entry-1",
        attached: true,
        alreadyAttached: false,
      } as any);
      const good = new NextRequest(`http://localhost:3000/api/scenes/${sceneId}/attachments`, {
        method: "POST",
        body: JSON.stringify({ entryId: "entry-1", attach: true }),
      });
      const res2 = await postAttachment(good, { params: Promise.resolve({ id: sceneId }) });
      expect(res2.status).toBe(200);
      const json = await res2.json();
      expect(json.attached).toBe(true);
    });
  });
});
