import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CodexCreateModal } from "../src/app/dashboard/codex/_components/CodexCreateModal";
import { CodexEditor } from "../src/app/dashboard/codex/_components/CodexEditor";
import { CodexManager } from "../src/app/dashboard/codex/_components/CodexManager";
import { RelationEditorModal } from "../src/app/dashboard/codex/_components/RelationEditorModal";
import { ProgressionEditorModal } from "../src/app/dashboard/codex/_components/ProgressionEditorModal";

const mockRedirect = vi.fn();
vi.mock("next/navigation", () => ({
  redirect: (...args: any[]) => {
    mockRedirect(...args);
    throw new Error(`NEXT_REDIRECT: ${args[0]}`);
  },
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
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

const mockGetEntryAction = vi.fn();
vi.mock("../src/lib/codex/actions", () => ({
  getCodexEntryAction: (...args: any[]) => mockGetEntryAction(...args),
  createCodexEntryAction: vi.fn().mockResolvedValue({ success: true }),
  updateCodexEntryAction: vi.fn().mockResolvedValue({ success: true }),
  deleteCodexEntryAction: vi.fn().mockResolvedValue({ success: true }),
  createCodexAliasAction: vi.fn().mockResolvedValue({ success: true }),
  deleteCodexAliasAction: vi.fn().mockResolvedValue({ success: true }),
  createCodexTagAction: vi.fn().mockResolvedValue({ success: true }),
  deleteCodexTagAction: vi.fn().mockResolvedValue({ success: true }),
  createCodexRelationAction: vi.fn().mockResolvedValue({ success: true }),
  updateCodexRelationAction: vi.fn().mockResolvedValue({ success: true }),
  deleteCodexRelationAction: vi.fn().mockResolvedValue({ success: true }),
  createCodexProgressionAction: vi.fn().mockResolvedValue({ success: true }),
  updateCodexProgressionAction: vi.fn().mockResolvedValue({ success: true }),
  deleteCodexProgressionAction: vi.fn().mockResolvedValue({ success: true }),
}));

// Analysis suite runs under shared CI load with coverage; page dynamic import
// can exceed the default 5s (same class of flake as Codex/Prisma suite timeouts).
describe("Codex UI Components", { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("CodexPage (src/app/dashboard/codex/page.tsx)", () => {
    it("redirects to /login when unauthenticated", async () => {
      mockGetUser.mockResolvedValueOnce({ data: { user: null } });

      const { default: CodexPage } = await import("../src/app/dashboard/codex/page");
      await expect(CodexPage()).rejects.toThrow("NEXT_REDIRECT: /login");
      expect(mockRedirect).toHaveBeenCalledWith("/login");
    });

    it("renders codex manager when authenticated", async () => {
      mockGetUser.mockResolvedValueOnce({
        data: {
          user: { id: "00000000-0000-0000-0000-000000000001", email: "test@inkstory.local" },
        },
      });

      const { default: CodexPage } = await import("../src/app/dashboard/codex/page");
      const element = await CodexPage();
      const html = renderToStaticMarkup(element);

      expect(mockSyncAuthUser).toHaveBeenCalled();
      expect(html).toContain("Story Codex");
      expect(html).toContain("New Codex Entry");
    });
  });

  describe("CodexManager", () => {
    const dummyEntries = [
      {
        id: "entry-1",
        name: "Mara Vance",
        type: "CHARACTER",
        trackingMode: "ALWAYS",
        seriesScoped: false,
        description: "A glass weaver archivist.",
        color: "#3b82f6",
      },
      {
        id: "entry-2",
        name: "Sunken Archives",
        type: "LOCATION",
        trackingMode: "DETECTED",
        seriesScoped: false,
        description: "Underground library.",
        color: "#10b981",
      },
    ];

    it("renders entry cards in the sidebar", () => {
      const html = renderToStaticMarkup(
        React.createElement(CodexManager, {
          initialEntries: dummyEntries,
          novels: [{ id: "nov-1", title: "Novel 1", seriesId: null }],
          series: [{ id: "ser-1", title: "Series 1" }],
        }),
      );

      expect(html).toContain("Mara Vance");
      expect(html).toContain("Sunken Archives");
      expect(html).toContain("CHARACTER");
      expect(html).toContain("LOCATION");
      expect(html).toContain("ALWAYS");
      expect(html).toContain("DETECTED");
    });

    it("renders empty state when no entries are present", () => {
      const html = renderToStaticMarkup(
        React.createElement(CodexManager, {
          initialEntries: [],
          novels: [],
          series: [],
        }),
      );

      expect(html).toContain("No entries match the filter criteria.");
      expect(html).toContain("No Codex Entry Selected");
    });
  });

  describe("CodexEditor", () => {
    it("renders editor markup", () => {
      mockGetEntryAction.mockResolvedValueOnce({
        success: true,
        data: {
          id: "entry-1",
          name: "Mara Vance",
          type: "CHARACTER",
          trackingMode: "ALWAYS",
          seriesScoped: false,
          description: "Glass weaver",
          notes: "Secret mentor",
          color: "#3b82f6",
          aliases: [{ id: "a-1", name: "The Glass Weaver" }],
          tags: [{ id: "t-1", name: "Protagonist" }],
          sourceRelations: [],
          targetRelations: [],
          progressions: [],
        },
      });

      const html = renderToStaticMarkup(
        React.createElement(CodexEditor, {
          entryId: "entry-1",
          onEntryUpdated: vi.fn(),
          onEntryDeleted: vi.fn(),
        }),
      );

      expect(html).toBeDefined();
    });

    it("renders relations with related entity names", () => {
      const entryData = {
        id: "entry-1",
        name: "Mara Vance",
        type: "CHARACTER" as const,
        trackingMode: "ALWAYS" as const,
        seriesScoped: false,
        description: "Glass weaver",
        sourceRelations: [
          {
            id: "rel-1",
            relationType: "MENTOR_TO",
            targetEntryId: "entry-2",
            targetEntry: { id: "entry-2", name: "Kaelen", type: "CHARACTER" },
            description: "Taught arcane weaving",
          },
        ],
        targetRelations: [
          {
            id: "rel-2",
            relationType: "ALLY",
            sourceEntryId: "entry-3",
            sourceEntry: { id: "entry-3", name: "Theron", type: "CHARACTER" },
          },
        ],
        progressions: [],
        aliases: [],
        tags: [],
      };

      const html = renderToStaticMarkup(
        React.createElement(CodexEditor, {
          entryId: "entry-1",
          initialEntry: entryData,
          onEntryUpdated: vi.fn(),
          onEntryDeleted: vi.fn(),
        }),
      );

      expect(html).toContain("MENTOR_TO");
      expect(html).toContain("Kaelen");
      expect(html).toContain("Theron");
      expect(html).toContain("Taught arcane weaving");
      expect(html).toContain("Add Relation");
      expect(html).toContain("Edit");
    });

    it("renders progressions with add affordance and scene fallback labels", () => {
      const entryData = {
        id: "entry-1",
        name: "Mara Vance",
        type: "CHARACTER" as const,
        trackingMode: "DETECTED" as const,
        seriesScoped: false,
        description: "Glass weaver",
        sourceRelations: [],
        targetRelations: [],
        progressions: [
          {
            id: "prog-1",
            sceneId: "scene-9",
            mode: "REPLACEMENT",
            description: "Mara has lost her sight.",
            notes: null,
          },
        ],
        aliases: [],
        tags: [],
        novelId: "nov-1",
      };

      const html = renderToStaticMarkup(
        React.createElement(CodexEditor, {
          entryId: "entry-1",
          initialEntry: entryData,
          novels: [{ id: "nov-1", title: "Storm Tide", seriesId: null }],
          onEntryUpdated: vi.fn(),
          onEntryDeleted: vi.fn(),
        }),
      );

      expect(html).toContain("Add Progression");
      expect(html).toContain("REPLACEMENT");
      expect(html).toContain("Mara has lost her sight.");
      expect(html).toContain("scene-9");
    });

    it("renders the custom fields editor with existing fields", () => {
      const entryData = {
        id: "entry-1",
        name: "Mara Vance",
        type: "CHARACTER" as const,
        trackingMode: "DETECTED" as const,
        seriesScoped: false,
        description: "Glass weaver",
        sourceRelations: [],
        targetRelations: [],
        progressions: [],
        aliases: [],
        tags: [],
        customFields: { Age: 34, "Ship Name": "Rook's Wake", Exiled: true },
      };

      const html = renderToStaticMarkup(
        React.createElement(CodexEditor, {
          entryId: "entry-1",
          initialEntry: entryData,
          onEntryUpdated: vi.fn(),
          onEntryDeleted: vi.fn(),
        }),
      );

      expect(html).toContain("Custom Fields");
      expect(html).toContain("Add Field");
      expect(html).toContain("Age");
      expect(html).toContain("34");
      expect(html).toContain("Rook&#x27;s Wake");
      expect(html).toContain("true");
    });
  });

  describe("CodexCreateModal", () => {
    it("renders nothing when isOpen is false", () => {
      const html = renderToStaticMarkup(
        React.createElement(CodexCreateModal, {
          isOpen: false,
          onClose: vi.fn(),
          novels: [],
          series: [],
          onCreated: vi.fn(),
        }),
      );

      expect(html).toBe("");
    });

    it("renders modal form when isOpen is true with color presets and options", () => {
      const html = renderToStaticMarkup(
        React.createElement(CodexCreateModal, {
          isOpen: true,
          onClose: vi.fn(),
          novels: [{ id: "n-1", title: "Novel 1", seriesId: null }],
          series: [{ id: "s-1", title: "Series 1" }],
          onCreated: vi.fn(),
        }),
      );

      expect(html).toContain("New Codex Entry");
      expect(html).toContain("Name *");
      expect(html).toContain("Tracking Mode");
      expect(html).toContain("Target Novel *");
      expect(html).toContain("Color Theme");
      expect(html).toContain("Create Entry");
    });
  });

  describe("RelationEditorModal", () => {
    const baseProps = {
      entryId: "entry-1",
      entryName: "Mara Vance",
      entries: [
        { id: "entry-1", name: "Mara Vance", type: "CHARACTER" },
        { id: "entry-2", name: "Kaelen", type: "CHARACTER" },
        { id: "entry-3", name: "Sunken Archives", type: "LOCATION" },
      ],
      onClose: vi.fn(),
      onSaved: vi.fn(),
    };

    it("renders nothing when closed", () => {
      const html = renderToStaticMarkup(
        React.createElement(RelationEditorModal, { ...baseProps, isOpen: false, relation: null }),
      );
      expect(html).toBe("");
    });

    it("renders create mode with entry candidates excluding self", () => {
      const html = renderToStaticMarkup(
        React.createElement(RelationEditorModal, { ...baseProps, isOpen: true, relation: null }),
      );

      expect(html).toContain("Add Relation");
      expect(html).toContain("Related Entry *");
      expect(html).toContain("Kaelen (CHARACTER)");
      expect(html).toContain("Sunken Archives (LOCATION)");
      expect(html).not.toContain("Mara Vance (CHARACTER)");
      expect(html).toContain("relation-type-presets");
    });

    it("renders edit mode with fixed direction and delete affordance", () => {
      const html = renderToStaticMarkup(
        React.createElement(RelationEditorModal, {
          ...baseProps,
          isOpen: true,
          relation: {
            id: "rel-1",
            relationType: "MENTOR_TO",
            reverseType: "MENTORED_BY",
            description: "Taught weaving",
            direction: "source" as const,
            otherName: "Kaelen",
          },
        }),
      );

      expect(html).toContain("Edit Relation");
      expect(html).toContain("Delete Relation");
      expect(html).toContain("MENTORED_BY");
      expect(html).not.toContain("Related Entry *");
    });
  });

  describe("ProgressionEditorModal", () => {
    const sceneOptions = [
      { id: "scene-1", label: "Storm Tide · Act I → Chapter One → The Quay" },
      { id: "scene-2", label: "Storm Tide · Act I → Chapter One → Storm" },
    ];

    const baseProps = {
      entryId: "entry-1",
      onClose: vi.fn(),
      onSaved: vi.fn(),
    };

    it("renders nothing when closed", () => {
      expect(
        renderToStaticMarkup(
          React.createElement(ProgressionEditorModal, {
            ...baseProps,
            isOpen: false,
            progression: null,
            sceneOptions,
          }),
        ),
      ).toBe("");
    });

    it("renders create mode with reading-order scene options", () => {
      const html = renderToStaticMarkup(
        React.createElement(ProgressionEditorModal, {
          ...baseProps,
          isOpen: true,
          progression: null,
          sceneOptions,
        }),
      );

      expect(html).toContain("Add Progression");
      expect(html).toContain("Storm Tide · Act I → Chapter One → The Quay");
      expect(html).toContain("ADDITION");
      expect(html).toContain("REPLACEMENT");
    });

    it("renders edit mode with fixed scene and delete affordance", () => {
      const html = renderToStaticMarkup(
        React.createElement(ProgressionEditorModal, {
          ...baseProps,
          isOpen: true,
          progression: {
            id: "prog-1",
            sceneId: "scene-2",
            mode: "REPLACEMENT",
            description: "Mara has lost her sight.",
            notes: null,
          },
          sceneOptions,
        }),
      );

      expect(html).toContain("Edit Progression");
      expect(html).toContain("Scene (fixed)");
      expect(html).toContain("Delete Progression");
      expect(html).toContain("Mara has lost her sight.");
    });

    it("shows the empty-scene hint when no scenes exist", () => {
      const html = renderToStaticMarkup(
        React.createElement(ProgressionEditorModal, {
          ...baseProps,
          isOpen: true,
          progression: null,
          sceneOptions: [],
        }),
      );

      expect(html).toContain("No scenes found");
    });
  });
});
