import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  createCodexAliasAction,
  createCodexEntryAction,
  createCodexProgressionAction,
  createCodexRelationAction,
  createCodexTagAction,
  deleteCodexAliasAction,
  deleteCodexEntryAction,
  deleteCodexProgressionAction,
  deleteCodexRelationAction,
  deleteCodexTagAction,
  detectMentionsAction,
  getCodexEntryAction,
  listCodexEntriesForNovelAction,
  listCodexEntriesForSeriesAction,
  updateCodexEntryAction,
  updateCodexProgressionAction,
  updateCodexRelationAction,
} from "../src/lib/codex/actions";
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

describe("Codex Server Actions", () => {
  const userId = "test-action-user-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: userId, email: "action@inkstory.local" } },
    });
  });

  it("returns 401 when user is unauthenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } });

    const result = await createCodexEntryAction({ name: "Ghost Entry" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(401);
      expect(result.code).toBe("FORBIDDEN");
    }
  });

  it("handles CodexError gracefully and returns error payload", async () => {
    vi.spyOn(codexService, "createCodexEntry").mockRejectedValueOnce(
      new CodexError("Scoping validation failed", "SCOPING_ERROR", 422),
    );

    const result = await createCodexEntryAction({ name: "Invalid Scope" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("SCOPING_ERROR");
      expect(result.status).toBe(422);
      expect(result.error).toBe("Scoping validation failed");
    }
  });

  it("handles unexpected runtime errors", async () => {
    vi.spyOn(codexService, "createCodexEntry").mockRejectedValueOnce(
      new Error("Database connection dropped"),
    );

    const result = await createCodexEntryAction({ name: "Crashed" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("INTERNAL_ERROR");
      expect(result.status).toBe(500);
      expect(result.error).toBe("Database connection dropped");
    }
  });

  it("delegates createCodexEntryAction successfully", async () => {
    const mockEntry = { id: "entry-1", name: "Valid Entry" } as any;
    vi.spyOn(codexService, "createCodexEntry").mockResolvedValueOnce(mockEntry);

    const result = await createCodexEntryAction({ name: "Valid Entry", novelId: "novel-1" });
    expect(result.success).toBe(true);
    expect(result.data).toEqual(mockEntry);
  });

  it("delegates getCodexEntryAction, update, and delete actions", async () => {
    const mockEntry = { id: "entry-1", name: "Fetched" } as any;
    vi.spyOn(codexService, "getCodexEntry").mockResolvedValueOnce(mockEntry);
    vi.spyOn(codexService, "updateCodexEntry").mockResolvedValueOnce({
      ...mockEntry,
      name: "Updated",
    });
    vi.spyOn(codexService, "deleteCodexEntry").mockResolvedValueOnce({
      success: true,
      id: "entry-1",
      deleted: "soft",
    });

    const getRes = await getCodexEntryAction("entry-1");
    expect(getRes.success).toBe(true);
    expect(getRes.data).toEqual(mockEntry);

    const updateRes = await updateCodexEntryAction("entry-1", { name: "Updated" });
    expect(updateRes.success).toBe(true);
    expect(updateRes.data?.name).toBe("Updated");

    const delRes = await deleteCodexEntryAction("entry-1");
    expect(delRes.success).toBe(true);
    expect(delRes.data?.deleted).toBe("soft");
  });

  it("delegates listCodexEntriesForNovelAction and listCodexEntriesForSeriesAction", async () => {
    const mockEntries = [{ id: "entry-1", name: "Novel Entry" }] as any;
    vi.spyOn(codexService, "listCodexEntriesForNovel").mockResolvedValueOnce(mockEntries);
    vi.spyOn(codexService, "listCodexEntriesForSeries").mockResolvedValueOnce(mockEntries);

    const novelList = await listCodexEntriesForNovelAction("novel-1");
    expect(novelList.success).toBe(true);
    expect(novelList.data).toEqual(mockEntries);

    const seriesList = await listCodexEntriesForSeriesAction("series-1");
    expect(seriesList.success).toBe(true);
    expect(seriesList.data).toEqual(mockEntries);
  });

  it("delegates alias and tag actions", async () => {
    vi.spyOn(codexService, "createCodexAlias").mockResolvedValueOnce({
      id: "alias-1",
      name: "Alias",
    } as any);
    vi.spyOn(codexService, "deleteCodexAlias").mockResolvedValueOnce({
      success: true,
      id: "alias-1",
    });

    vi.spyOn(codexService, "createCodexTag").mockResolvedValueOnce({
      id: "tag-1",
      name: "Tag",
    } as any);
    vi.spyOn(codexService, "deleteCodexTag").mockResolvedValueOnce({
      success: true,
      id: "tag-1",
    });

    const aliasCreate = await createCodexAliasAction({ entryId: "entry-1", name: "Alias" });
    expect(aliasCreate.success).toBe(true);

    const aliasDel = await deleteCodexAliasAction("alias-1");
    expect(aliasDel.success).toBe(true);

    const tagCreate = await createCodexTagAction({ entryId: "entry-1", name: "Tag" });
    expect(tagCreate.success).toBe(true);

    const tagDel = await deleteCodexTagAction("tag-1");
    expect(tagDel.success).toBe(true);
  });

  it("delegates relation and progression actions", async () => {
    vi.spyOn(codexService, "createCodexRelation").mockResolvedValueOnce({
      id: "rel-1",
      relationType: "FRIEND",
    } as any);
    vi.spyOn(codexService, "updateCodexRelation").mockResolvedValueOnce({
      id: "rel-1",
      relationType: "ALLY",
    } as any);
    vi.spyOn(codexService, "deleteCodexRelation").mockResolvedValueOnce({
      success: true,
      id: "rel-1",
    });

    vi.spyOn(codexService, "createCodexProgression").mockResolvedValueOnce({
      id: "prog-1",
      description: "Step 1",
    } as any);
    vi.spyOn(codexService, "updateCodexProgression").mockResolvedValueOnce({
      id: "prog-1",
      description: "Step 2",
    } as any);
    vi.spyOn(codexService, "deleteCodexProgression").mockResolvedValueOnce({
      success: true,
      id: "prog-1",
    });

    const relCreate = await createCodexRelationAction({
      sourceEntryId: "entry-1",
      targetEntryId: "entry-2",
      relationType: "FRIEND",
    });
    expect(relCreate.success).toBe(true);

    const relUpdate = await updateCodexRelationAction("rel-1", { relationType: "ALLY" });
    expect(relUpdate.success).toBe(true);

    const relDel = await deleteCodexRelationAction("rel-1");
    expect(relDel.success).toBe(true);

    const progCreate = await createCodexProgressionAction({
      entryId: "entry-1",
      sceneId: "scene-1",
      description: "Step 1",
    });
    expect(progCreate.success).toBe(true);

    const progUpdate = await updateCodexProgressionAction("prog-1", { description: "Step 2" });
    expect(progUpdate.success).toBe(true);

    const progDel = await deleteCodexProgressionAction("prog-1");
    expect(progDel.success).toBe(true);
  });

  it("delegates detectMentionsAction with novelId or sceneId", async () => {
    vi.spyOn(codexService, "scanMentionsInNovel").mockResolvedValueOnce({
      matchedEntryIds: ["e-1"],
      matches: [],
    });
    vi.spyOn(codexService, "scanMentionsInScene").mockResolvedValueOnce({
      matchedEntryIds: ["e-1"],
      matches: [],
    });

    const novelResult = await detectMentionsAction({
      text: "Scanning novel text",
      novelId: "nov-1",
    });
    expect(novelResult.success).toBe(true);

    const sceneResult = await detectMentionsAction({
      text: "Scanning scene text",
      sceneId: "scene-1",
    });
    expect(sceneResult.success).toBe(true);

    const invalidResult = await detectMentionsAction({ text: "Missing target" });
    expect(invalidResult.success).toBe(false);
  });
});
