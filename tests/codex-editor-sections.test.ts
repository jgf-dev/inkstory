import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  CodexAliasItem,
  CodexAliasesSection,
  CodexProgressionCard,
  CodexProgressionsSection,
  CodexRelationsSection,
  CodexSourceRelationCard,
  CodexTagItem,
  CodexTagsSection,
  CodexTargetRelationCard,
} from "../src/app/dashboard/codex/_components/CodexEditorSections";

describe("CodexEditorSections Subcomponents", () => {
  describe("CodexAliasItem & CodexAliasesSection", () => {
    it("renders alias item and delete button", () => {
      const onDelete = vi.fn();
      const html = renderToStaticMarkup(
        React.createElement(CodexAliasItem, {
          alias: { id: "a1", name: "The Hero" },
          onDelete,
        }),
      );
      expect(html).toContain("The Hero");
      expect(html).toContain('aria-label="Remove alias The Hero"');
      expect(html).toContain("×");
    });

    it("renders empty state when no aliases are provided", () => {
      const html = renderToStaticMarkup(
        React.createElement(CodexAliasesSection, {
          aliases: [],
          onDeleteAlias: vi.fn(),
          onAddAlias: vi.fn(),
          newAliasName: "",
          setNewAliasName: vi.fn(),
          addingAlias: false,
        }),
      );
      expect(html).toContain("No aliases added yet.");
      expect(html).toContain("New alias name...");
    });

    it("renders aliases list when provided", () => {
      const html = renderToStaticMarkup(
        React.createElement(CodexAliasesSection, {
          aliases: [
            { id: "a1", name: "Alias 1" },
            { id: "a2", name: "Alias 2" },
          ],
          onDeleteAlias: vi.fn(),
          onAddAlias: vi.fn(),
          newAliasName: "New",
          setNewAliasName: vi.fn(),
          addingAlias: false,
        }),
      );
      expect(html).toContain("Alias 1");
      expect(html).toContain("Alias 2");
    });
  });

  describe("CodexTagItem & CodexTagsSection", () => {
    it("renders tag item", () => {
      const html = renderToStaticMarkup(
        React.createElement(CodexTagItem, {
          tag: { id: "t1", name: "Protagonist" },
          onDelete: vi.fn(),
        }),
      );
      expect(html).toContain("Protagonist");
      expect(html).toContain('aria-label="Remove tag Protagonist"');
    });

    it("renders empty tags state", () => {
      const html = renderToStaticMarkup(
        React.createElement(CodexTagsSection, {
          tags: [],
          onDeleteTag: vi.fn(),
          onAddTag: vi.fn(),
          newTagName: "",
          setNewTagName: vi.fn(),
          addingTag: false,
        }),
      );
      expect(html).toContain("No tags added yet.");
    });

    it("renders tags list when provided", () => {
      const html = renderToStaticMarkup(
        React.createElement(CodexTagsSection, {
          tags: [{ id: "t1", name: "Main Tag" }],
          onDeleteTag: vi.fn(),
          onAddTag: vi.fn(),
          newTagName: "Tag",
          setNewTagName: vi.fn(),
          addingTag: false,
        }),
      );
      expect(html).toContain("Main Tag");
    });
  });

  describe("CodexRelationsSection & Cards", () => {
    it("renders source relation card fallback targetEntryId when targetEntry is missing", () => {
      const html = renderToStaticMarkup(
        React.createElement(CodexSourceRelationCard, {
          relation: {
            id: "r1",
            relationType: "FRIEND_OF",
            targetEntryId: "entry-99",
            description: "A close friendship",
          },
        }),
      );
      expect(html).toContain("FRIEND_OF");
      expect(html).toContain("→ entry-99");
      expect(html).toContain("A close friendship");
    });

    it("renders target relation card with fallback sourceEntryId", () => {
      const html = renderToStaticMarkup(
        React.createElement(CodexTargetRelationCard, {
          relation: {
            id: "r2",
            relationType: "ENEMY_OF",
            sourceEntryId: "entry-88",
          },
        }),
      );
      expect(html).toContain("ENEMY_OF");
      expect(html).toContain("← entry-88");
    });

    it("renders empty relations message when no relations are passed", () => {
      const html = renderToStaticMarkup(
        React.createElement(CodexRelationsSection, {
          sourceRelations: [],
          targetRelations: [],
        }),
      );
      expect(html).toContain("No relations established yet.");
    });
  });

  describe("CodexProgressionsSection & Card", () => {
    it("renders progression card mode and description", () => {
      const html = renderToStaticMarkup(
        React.createElement(CodexProgressionCard, {
          progression: {
            id: "p1",
            mode: "ADDITION",
            description: "Gained magical sword in chapter 2",
          },
        }),
      );
      expect(html).toContain("ADDITION");
      expect(html).toContain("Gained magical sword in chapter 2");
    });

    it("renders empty progressions message", () => {
      const html = renderToStaticMarkup(
        React.createElement(CodexProgressionsSection, {
          progressions: [],
        }),
      );
      expect(html).toContain("No progressions recorded yet.");
    });
  });
});
