import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { DELETE as deleteAlias } from "../src/app/api/codex/aliases/[id]/route";
import { GET as getEntries, POST as createEntry } from "../src/app/api/codex/entries/route";
import {
  DELETE as deleteEntry,
  GET as getEntry,
  PATCH as updateEntry,
} from "../src/app/api/codex/entries/[id]/route";
import { POST as createAlias } from "../src/app/api/codex/entries/[id]/aliases/route";
import { POST as createTag } from "../src/app/api/codex/entries/[id]/tags/route";
import {
  DELETE as deleteProgression,
  PATCH as updateProgression,
} from "../src/app/api/codex/progressions/[id]/route";
import { POST as createProgression } from "../src/app/api/codex/progressions/route";
import { POST as scanMentions } from "../src/app/api/codex/mentions/route";
import {
  DELETE as deleteRelation,
  PATCH as updateRelation,
} from "../src/app/api/codex/relations/[id]/route";
import { POST as createRelation } from "../src/app/api/codex/relations/route";
import { DELETE as deleteTag } from "../src/app/api/codex/tags/[id]/route";
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

describe("Codex REST Route Handlers", () => {
  const userId = "api-test-user-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: userId, email: "api@inkstory.local" } },
    });
  });

  describe("Authentication Guard", () => {
    it("returns 401 when unauthenticated on GET /api/codex/entries", async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });

      const req = new NextRequest("http://localhost:3000/api/codex/entries?novelId=novel-1");
      const res = await getEntries(req);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe("Unauthorized");
    });

    it("returns 401 when unauthenticated on POST /api/codex/entries", async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });

      const req = new NextRequest("http://localhost:3000/api/codex/entries", {
        method: "POST",
        body: JSON.stringify({ name: "Ghost" }),
      });
      const res = await createEntry(req);

      expect(res.status).toBe(401);
    });
  });

  describe("GET & POST /api/codex/entries", () => {
    it("returns 400 when neither novelId nor seriesId is specified", async () => {
      const req = new NextRequest("http://localhost:3000/api/codex/entries");
      const res = await getEntries(req);

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Must specify novelId or seriesId/);
    });

    it("returns entries for novelId", async () => {
      const mockEntries = [{ id: "entry-1", name: "Mara" }] as any;
      vi.spyOn(codexService, "listCodexEntriesForNovel").mockResolvedValueOnce(mockEntries);

      const req = new NextRequest(
        "http://localhost:3000/api/codex/entries?novelId=novel-1&type=CHARACTER&search=Mara",
      );
      const res = await getEntries(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.entries).toEqual(mockEntries);
      expect(codexService.listCodexEntriesForNovel).toHaveBeenCalledWith(
        userId,
        "novel-1",
        expect.objectContaining({ type: "CHARACTER", search: "Mara" }),
      );
    });

    it("returns entries for seriesId with seriesOnly flag", async () => {
      const mockEntries = [{ id: "entry-lore", name: "Lore" }] as any;
      vi.spyOn(codexService, "listCodexEntriesForSeries").mockResolvedValueOnce(mockEntries);

      const req = new NextRequest(
        "http://localhost:3000/api/codex/entries?seriesId=series-1&seriesOnly=true",
      );
      const res = await getEntries(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.entries).toEqual(mockEntries);
    });

    it("creates an entry and returns 201", async () => {
      const mockEntry = { id: "new-entry", name: "New Hero" } as any;
      vi.spyOn(codexService, "createCodexEntry").mockResolvedValueOnce(mockEntry);

      const req = new NextRequest("http://localhost:3000/api/codex/entries", {
        method: "POST",
        body: JSON.stringify({ name: "New Hero", novelId: "novel-1" }),
      });
      const res = await createEntry(req);

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.entry).toEqual(mockEntry);
    });

    it("maps CodexError to appropriate status code", async () => {
      vi.spyOn(codexService, "createCodexEntry").mockRejectedValueOnce(
        new CodexError("Scoping error", "SCOPING_ERROR", 422),
      );

      const req = new NextRequest("http://localhost:3000/api/codex/entries", {
        method: "POST",
        body: JSON.stringify({ name: "Bad Scope" }),
      });
      const res = await createEntry(req);

      expect(res.status).toBe(422);
      const json = await res.json();
      expect(json.error).toBe("Scoping error");
      expect(json.code).toBe("SCOPING_ERROR");
    });
  });

  describe("Single Entry Operations (/api/codex/entries/[id])", () => {
    it("gets entry by id", async () => {
      const mockEntry = { id: "entry-1", name: "Found" } as any;
      vi.spyOn(codexService, "getCodexEntry").mockResolvedValueOnce(mockEntry);

      const req = new NextRequest("http://localhost:3000/api/codex/entries/entry-1");
      const res = await getEntry(req, { params: Promise.resolve({ id: "entry-1" }) });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.entry).toEqual(mockEntry);
    });

    it("updates entry by id", async () => {
      const mockUpdated = { id: "entry-1", name: "Updated Name" } as any;
      vi.spyOn(codexService, "updateCodexEntry").mockResolvedValueOnce(mockUpdated);

      const req = new NextRequest("http://localhost:3000/api/codex/entries/entry-1", {
        method: "PATCH",
        body: JSON.stringify({ name: "Updated Name" }),
      });
      const res = await updateEntry(req, { params: Promise.resolve({ id: "entry-1" }) });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.entry).toEqual(mockUpdated);
    });

    it("deletes entry by id (soft and hard)", async () => {
      vi.spyOn(codexService, "deleteCodexEntry").mockResolvedValueOnce({
        success: true,
        id: "entry-1",
        deleted: "soft",
      });

      const req = new NextRequest("http://localhost:3000/api/codex/entries/entry-1", {
        method: "DELETE",
      });
      const res = await deleteEntry(req, { params: Promise.resolve({ id: "entry-1" }) });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.deleted).toBe("soft");
    });
  });

  describe("Aliases, Tags, Relations, Progressions Endpoints", () => {
    it("handles alias creation and deletion", async () => {
      vi.spyOn(codexService, "createCodexAlias").mockResolvedValueOnce({
        id: "alias-1",
        name: "Shadow",
      } as any);
      vi.spyOn(codexService, "deleteCodexAlias").mockResolvedValueOnce({
        success: true,
        id: "alias-1",
      });

      const createReq = new NextRequest("http://localhost:3000/api/codex/entries/entry-1/aliases", {
        method: "POST",
        body: JSON.stringify({ name: "Shadow" }),
      });
      const createRes = await createAlias(createReq, {
        params: Promise.resolve({ id: "entry-1" }),
      });
      expect(createRes.status).toBe(201);

      const delReq = new NextRequest("http://localhost:3000/api/codex/aliases/alias-1", {
        method: "DELETE",
      });
      const delRes = await deleteAlias(delReq, { params: Promise.resolve({ id: "alias-1" }) });
      expect(delRes.status).toBe(200);
    });

    it("handles tag creation and deletion", async () => {
      vi.spyOn(codexService, "createCodexTag").mockResolvedValueOnce({
        id: "tag-1",
        name: "Mage",
      } as any);
      vi.spyOn(codexService, "deleteCodexTag").mockResolvedValueOnce({
        success: true,
        id: "tag-1",
      });

      const createReq = new NextRequest("http://localhost:3000/api/codex/entries/entry-1/tags", {
        method: "POST",
        body: JSON.stringify({ name: "Mage", color: "#3b82f6" }),
      });
      const createRes = await createTag(createReq, {
        params: Promise.resolve({ id: "entry-1" }),
      });
      expect(createRes.status).toBe(201);

      const delReq = new NextRequest("http://localhost:3000/api/codex/tags/tag-1", {
        method: "DELETE",
      });
      const delRes = await deleteTag(delReq, { params: Promise.resolve({ id: "tag-1" }) });
      expect(delRes.status).toBe(200);
    });

    it("handles relation creation, update, and deletion", async () => {
      vi.spyOn(codexService, "createCodexRelation").mockResolvedValueOnce({
        id: "rel-1",
        relationType: "ALLY",
      } as any);
      vi.spyOn(codexService, "updateCodexRelation").mockResolvedValueOnce({
        id: "rel-1",
        relationType: "ENEMY",
      } as any);
      vi.spyOn(codexService, "deleteCodexRelation").mockResolvedValueOnce({
        success: true,
        id: "rel-1",
      });

      const createReq = new NextRequest("http://localhost:3000/api/codex/relations", {
        method: "POST",
        body: JSON.stringify({
          sourceEntryId: "entry-1",
          targetEntryId: "entry-2",
          relationType: "ALLY",
        }),
      });
      const createRes = await createRelation(createReq);
      expect(createRes.status).toBe(201);

      const updateReq = new NextRequest("http://localhost:3000/api/codex/relations/rel-1", {
        method: "PATCH",
        body: JSON.stringify({ relationType: "ENEMY" }),
      });
      const updateRes = await updateRelation(updateReq, {
        params: Promise.resolve({ id: "rel-1" }),
      });
      expect(updateRes.status).toBe(200);

      const delReq = new NextRequest("http://localhost:3000/api/codex/relations/rel-1", {
        method: "DELETE",
      });
      const delRes = await deleteRelation(delReq, { params: Promise.resolve({ id: "rel-1" }) });
      expect(delRes.status).toBe(200);
    });

    it("handles progression creation, update, and deletion", async () => {
      vi.spyOn(codexService, "createCodexProgression").mockResolvedValueOnce({
        id: "prog-1",
        description: "Awakened",
      } as any);
      vi.spyOn(codexService, "updateCodexProgression").mockResolvedValueOnce({
        id: "prog-1",
        description: "Transformed",
      } as any);
      vi.spyOn(codexService, "deleteCodexProgression").mockResolvedValueOnce({
        success: true,
        id: "prog-1",
      });

      const createReq = new NextRequest("http://localhost:3000/api/codex/progressions", {
        method: "POST",
        body: JSON.stringify({
          entryId: "entry-1",
          sceneId: "scene-1",
          description: "Awakened",
        }),
      });
      const createRes = await createProgression(createReq);
      expect(createRes.status).toBe(201);

      const updateReq = new NextRequest("http://localhost:3000/api/codex/progressions/prog-1", {
        method: "PATCH",
        body: JSON.stringify({ description: "Transformed" }),
      });
      const updateRes = await updateProgression(updateReq, {
        params: Promise.resolve({ id: "prog-1" }),
      });
      expect(updateRes.status).toBe(200);

      const delReq = new NextRequest("http://localhost:3000/api/codex/progressions/prog-1", {
        method: "DELETE",
      });
      const delRes = await deleteProgression(delReq, {
        params: Promise.resolve({ id: "prog-1" }),
      });
      expect(delRes.status).toBe(200);
    });

    it("handles POST /api/codex/mentions with novelId or sceneId", async () => {
      vi.spyOn(codexService, "scanMentionsInNovel").mockResolvedValueOnce({
        matchedEntryIds: ["entry-1"],
        matches: [],
      });
      vi.spyOn(codexService, "scanMentionsInScene").mockResolvedValueOnce({
        matchedEntryIds: ["entry-1"],
        matches: [],
      });

      const novelReq = new NextRequest("http://localhost:3000/api/codex/mentions", {
        method: "POST",
        body: JSON.stringify({ text: "Mara appeared", novelId: "novel-1" }),
      });
      const novelRes = await scanMentions(novelReq);
      expect(novelRes.status).toBe(200);

      const sceneReq = new NextRequest("http://localhost:3000/api/codex/mentions", {
        method: "POST",
        body: JSON.stringify({ text: "Mara appeared", sceneId: "scene-1" }),
      });
      const sceneRes = await scanMentions(sceneReq);
      expect(sceneRes.status).toBe(200);

      const invalidReq = new NextRequest("http://localhost:3000/api/codex/mentions", {
        method: "POST",
        body: JSON.stringify({ text: "" }),
      });
      const invalidRes = await scanMentions(invalidReq);
      expect(invalidRes.status).toBe(400);
    });

    it("returns 400 with INVALID_JSON when request body contains malformed JSON", async () => {
      const malformedReq = new NextRequest("http://localhost:3000/api/codex/entries", {
        method: "POST",
        body: "{ malformed json: ",
        headers: { "Content-Type": "application/json" },
      });
      const res = await createEntry(malformedReq);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("INVALID_JSON");
      expect(json.error).toMatch(/Malformed or invalid JSON body/);
    });
  });
});
