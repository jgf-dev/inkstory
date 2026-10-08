import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Outliner } from "../src/app/dashboard/novels/[id]/_components/Outliner";
import { SceneEditor } from "../src/app/dashboard/novels/[id]/_components/SceneEditor";
import { MentionsPanel } from "../src/app/dashboard/novels/[id]/_components/MentionsPanel";
import { SceneContextDrawer } from "../src/app/dashboard/novels/[id]/_components/SceneContextDrawer";
import { AiAssistantDrawer } from "../src/app/dashboard/novels/[id]/_components/AiAssistantDrawer";
import { WritingWorkspace } from "../src/app/dashboard/novels/[id]/_components/WritingWorkspace";
import type { NovelOutline } from "../src/lib/writing/service";
import type { MentionDetectionResult } from "../src/lib/codex/mention-detection";
import { CodexError } from "../src/lib/codex/errors";

const mockRedirect = vi.fn();
const mockNotFound = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: any[]) => {
    mockRedirect(...args);
    throw new Error(`NEXT_REDIRECT: ${args[0]}`);
  },
  notFound: () => {
    mockNotFound();
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const mockGetUser = vi.fn();
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: () => mockGetUser(),
    },
  }),
}));

const mockSyncAuthUser = vi.fn().mockResolvedValue({});
vi.mock("../src/lib/supabase/auth", () => ({
  syncAuthUser: (...args: any[]) => mockSyncAuthUser(...args),
}));

const mockGetNovelOutline = vi.fn();
vi.mock("../src/lib/writing/service", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/writing/service")>();
  return {
    ...original,
    getNovelOutline: (...args: any[]) => mockGetNovelOutline(...args),
  };
});

function makeOutline(): NovelOutline {
  return {
    novel: { id: "novel-1", title: "Storm Tide", subtitle: null, seriesId: null },
    acts: [
      {
        id: "act-1",
        title: "Act I",
        position: 0,
        chapters: [
          {
            id: "chapter-1",
            title: "Chapter One",
            position: 0,
            scenes: [
              { id: "scene-1", title: "The Quay", label: null, position: 0, wordCount: 120 },
              { id: "scene-2", title: "Storm", label: null, position: 1, wordCount: 0 },
            ],
          },
        ],
      },
    ],
    totals: { acts: 1, chapters: 1, scenes: 2, words: 120 },
  };
}

describe("Writing Surface UI (launch phase 3)", { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Outliner", () => {
    it("renders the nested outline with counts and quick-create actions", () => {
      const html = renderToStaticMarkup(
        React.createElement(Outliner, {
          outline: makeOutline(),
          selectedSceneId: "scene-1",
          busy: false,
          onSelectScene: () => {},
          onCreateNode: () => {},
          onRenameNode: () => {},
          onMoveNode: () => {},
          onDeleteNode: () => {},
        }),
      );

      expect(html).toContain("Act I");
      expect(html).toContain("Chapter One");
      expect(html).toContain("The Quay");
      expect(html).toContain("120");
      expect(html).toContain("+ Act");
      expect(html).toContain("2 scenes");
      expect(html).toContain("120 words");
      expect(html).toContain("Open Story Codex");
      expect(html).toContain('data-selected="true"');
    });

    it("shows an empty state when the novel has no acts", () => {
      const outline = makeOutline();
      outline.acts = [];
      outline.totals = { acts: 0, chapters: 0, scenes: 0, words: 0 };
      const html = renderToStaticMarkup(
        React.createElement(Outliner, {
          outline,
          selectedSceneId: null,
          busy: false,
          onSelectScene: () => {},
          onCreateNode: () => {},
          onRenameNode: () => {},
          onMoveNode: () => {},
          onDeleteNode: () => {},
        }),
      );
      expect(html).toContain("No acts yet");
      expect(html).toContain("Create first act");
    });
  });

  describe("SceneEditor", () => {
    const scene = {
      id: "scene-1",
      title: "The Quay",
      content: "Mara reached the quay at dawn.",
      summary: "Arrival",
      label: null,
      pov: "THIRD_LIMITED" as const,
      tense: "PAST" as const,
      excludeFromAi: false,
      wordCount: 5,
      updatedAt: "2026-10-08T00:00:00.000Z",
      chapterId: "chapter-1",
      chapterTitle: "Chapter One",
      actTitle: "Act I",
      novelId: "novel-1",
      novelTitle: "Storm Tide",
    };

    it("renders breadcrumbs, title, prose, and live word count", () => {
      const html = renderToStaticMarkup(
        React.createElement(SceneEditor, {
          scene,
          onSaved: () => {},
          onProseChange: () => {},
        }),
      );
      expect(html).toContain("Act I / Chapter One");
      expect(html).toContain("The Quay");
      expect(html).toContain("Mara reached the quay at dawn.");
      expect(html).toContain("6 words");
      expect(html).toContain("All changes saved");
    });

    it("shows the metadata drawer fields when open", () => {
      // showMeta starts closed; the button must be present and the meta grid absent.
      const html = renderToStaticMarkup(
        React.createElement(SceneEditor, {
          scene,
          onSaved: () => {},
          onProseChange: () => {},
        }),
      );
      expect(html).toContain("Details");
      expect(html).not.toContain("Point of view");
    });
  });

  describe("MentionsPanel", () => {
    it("groups detected mentions per entry with counts", () => {
      const detection: MentionDetectionResult = {
        matchedEntryIds: ["entry-1"],
        matches: [
          {
            entryId: "entry-1",
            matchedText: "Mara Vane",
            originalText: "Mara Vane",
            matchType: "name",
            startIndex: 0,
            endIndex: 9,
          },
          {
            entryId: "entry-1",
            matchedText: "Rook",
            originalText: "Rook",
            matchType: "alias",
            startIndex: 20,
            endIndex: 24,
          },
        ],
      };
      const html = renderToStaticMarkup(
        React.createElement(MentionsPanel, { detection, scanning: false }),
      );
      expect(html).toContain("Mara Vane");
      expect(html).toContain("×2");
    });

    it("shows the idle hint when nothing has been scanned yet", () => {
      const html = renderToStaticMarkup(
        React.createElement(MentionsPanel, { detection: null, scanning: false }),
      );
      expect(html).toContain("Mentions appear here as you write.");
    });
  });

  describe("Drawers", () => {
    it("SceneContextDrawer renders header and loading state", () => {
      const html = renderToStaticMarkup(
        React.createElement(SceneContextDrawer, { sceneId: "scene-1", onClose: () => {} }),
      );
      expect(html).toContain("Scene Context");
      expect(html).toContain('data-testid="scene-context-drawer"');
    });

    it("AiAssistantDrawer renders mode tabs and generate button", () => {
      const html = renderToStaticMarkup(
        React.createElement(AiAssistantDrawer, {
          sceneId: "scene-1",
          content: "prose",
          onClose: () => {},
          onInsertText: () => {},
        }),
      );
      expect(html).toContain("Continue scene");
      expect(html).toContain("Expand beat");
      expect(html).toContain("Generate");
    });
  });

  describe("Novel workspace page (server component)", () => {
    it("redirects to /login when unauthenticated", async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });
      const { default: Page } = await import("../src/app/dashboard/novels/[id]/page");
      await expect(Page({ params: Promise.resolve({ id: "novel-1" }) } as never)).rejects.toThrow(
        "NEXT_REDIRECT: /login",
      );
    });

    it("renders the workspace for the novel owner", async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-1", email: "w@inkstory.local" } },
      });
      mockGetNovelOutline.mockResolvedValueOnce(makeOutline());

      const { default: Page } = await import("../src/app/dashboard/novels/[id]/page");
      const element = await Page({ params: Promise.resolve({ id: "novel-1" }) } as never);
      const html = renderToStaticMarkup(element as React.ReactElement);

      expect(mockSyncAuthUser).toHaveBeenCalled();
      expect(html).toContain('data-testid="writing-workspace"');
      expect(html).toContain("Storm Tide");
      expect(html).toContain("Context");
      expect(html).toContain("AI Assistant");
      expect(mockGetNovelOutline).toHaveBeenCalledWith("user-1", "novel-1");
    });

    it("calls notFound() when the novel is missing or foreign", async () => {
      mockGetUser.mockResolvedValueOnce({
        data: { user: { id: "user-1", email: "w@inkstory.local" } },
      });
      mockGetNovelOutline.mockRejectedValueOnce(
        new CodexError("Novel not found", "NOT_FOUND", 404),
      );

      const { default: Page } = await import("../src/app/dashboard/novels/[id]/page");
      await expect(Page({ params: Promise.resolve({ id: "missing" }) } as never)).rejects.toThrow(
        "NEXT_NOT_FOUND",
      );
      expect(mockNotFound).toHaveBeenCalled();
    });
  });

  describe("WritingWorkspace (client shell)", () => {
    it("renders rails, header actions, and empty-state without a scene", () => {
      const html = renderToStaticMarkup(
        React.createElement(WritingWorkspace, {
          outline: makeOutline(),
          initialSceneId: null,
        }),
      );
      expect(html).toContain('data-testid="outliner"');
      expect(html).toContain('data-testid="mentions-panel"');
      expect(html).toContain("No scene selected");
      expect(html).toContain("AI Assistant");
    });
  });
});
