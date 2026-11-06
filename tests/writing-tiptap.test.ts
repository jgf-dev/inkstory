import { describe, expect, it } from "vite-plus/test";
import {
  appendPlainTextToDoc,
  createEditorExtensions,
  docForEditor,
  docFromPlainText,
  isContentFormatValue,
  isSceneRevisionReasonValue,
  normalizeContentDoc,
  plainTextFromDoc,
} from "../src/lib/writing/tiptap";

describe("writing/tiptap helpers", () => {
  it("wraps plain text into a doc and extracts it back", () => {
    const doc = docFromPlainText("Hello world.\n\nSecond paragraph.");
    expect(doc.type).toBe("doc");
    expect(doc.content?.length).toBe(2);
    expect(plainTextFromDoc(doc)).toBe("Hello world.\n\nSecond paragraph.");
  });

  it("returns an empty paragraph doc for blank plain text", () => {
    const doc = docFromPlainText("   ");
    expect(doc).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(plainTextFromDoc(doc)).toBe("");
  });

  it("preserves hard breaks inside a paragraph", () => {
    const doc = docFromPlainText("Line one\nLine two");
    expect(plainTextFromDoc(doc)).toBe("Line one\nLine two");
  });

  it("normalizes valid docs and rejects garbage", () => {
    expect(normalizeContentDoc({ type: "doc", content: [] })).toEqual({
      type: "doc",
      content: [],
    });
    expect(normalizeContentDoc({ type: "paragraph" })).toBeNull();
    expect(normalizeContentDoc(null)).toBeNull();
    expect(normalizeContentDoc("nope")).toBeNull();
  });

  it("docForEditor prefers contentDoc when present", () => {
    const rich = {
      type: "doc" as const,
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Title" }],
        },
      ],
    };
    expect(docForEditor(rich, "ignored")).toEqual(rich);
    expect(plainTextFromDoc(docForEditor(null, "Plain only"))).toBe("Plain only");
  });

  it("extracts text from lists, hr, and marks", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Bold", marks: [{ type: "bold" }] },
            { type: "text", text: " and " },
            { type: "text", text: "hi", marks: [{ type: "highlight" }] },
          ],
        },
        { type: "horizontalRule" },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "One" }] }],
            },
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Two" }] }],
            },
          ],
        },
      ],
    };
    expect(plainTextFromDoc(doc)).toBe("Bold and hi\n\n---\n\nOne\nTwo");
  });

  it("validates content format and revision reason enums", () => {
    expect(isContentFormatValue("PLAIN")).toBe(true);
    expect(isContentFormatValue("TIPTAP_JSON")).toBe(true);
    expect(isContentFormatValue("HTML")).toBe(false);
    expect(isSceneRevisionReasonValue("AUTOSAVE")).toBe(true);
    expect(isSceneRevisionReasonValue("RESTORE")).toBe(true);
    expect(isSceneRevisionReasonValue("nope")).toBe(false);
  });

  it("appends plain insert without flattening existing marks", () => {
    const rich = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Hello", marks: [{ type: "bold" }] }],
        },
      ],
    };
    const next = appendPlainTextToDoc(rich, "AI line");
    expect(next.content?.[0]).toEqual(rich.content[0]);
    expect(plainTextFromDoc(next)).toBe("Hello\n\nAI line");
  });
  it("exposes a shared extension list including highlight", () => {
    const extensions = createEditorExtensions();
    expect(extensions.length).toBeGreaterThanOrEqual(2);
    const names = extensions.map((ext) => ext.name);
    expect(names).toContain("highlight");
  });
});
