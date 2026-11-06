/**
 * Shared Tiptap/ProseMirror helpers for STO-1156.
 *
 * Client and server both use these so plain-text extract, validation, and the
 * editor extension list stay in lockstep. AI / word-count / import keep using
 * plain `content` only — never the JSON doc stringification.
 */

import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";

/** Minimal JSON node shape we accept for `content_doc`. */
export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown> | null;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> | null }>;
  text?: string;
  content?: TiptapNode[];
}

export type TiptapDoc = TiptapNode & { type: "doc" };

export type ContentFormatValue = "PLAIN" | "TIPTAP_JSON";

export const CONTENT_FORMAT_VALUES = ["PLAIN", "TIPTAP_JSON"] as const;

export function isContentFormatValue(value: unknown): value is ContentFormatValue {
  return typeof value === "string" && (CONTENT_FORMAT_VALUES as readonly string[]).includes(value);
}

export type SceneRevisionReasonValue = "AUTOSAVE" | "MANUAL" | "RESTORE" | "IMPORT";

export const SCENE_REVISION_REASON_VALUES = ["AUTOSAVE", "MANUAL", "RESTORE", "IMPORT"] as const;

export function isSceneRevisionReasonValue(value: unknown): value is SceneRevisionReasonValue {
  return (
    typeof value === "string" && (SCENE_REVISION_REASON_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Extension list shared by the SceneEditor and any server-side schema check.
 * Keep this list small — basic formatting + highlight + headings/hr via StarterKit.
 */
export function createEditorExtensions() {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      // Code blocks / lists are fine for AC; leave StarterKit defaults on.
    }),
    Highlight.configure({ multicolor: false }),
  ];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTiptapNode(value: unknown): value is TiptapNode {
  if (!isPlainObject(value)) return false;
  if (typeof value.type !== "string" || value.type.length === 0) return false;
  if (value.content !== undefined) {
    if (!Array.isArray(value.content)) return false;
    if (!value.content.every(isTiptapNode)) return false;
  }
  if (value.text !== undefined && typeof value.text !== "string") return false;
  if (value.marks !== undefined) {
    if (!Array.isArray(value.marks)) return false;
    for (const mark of value.marks) {
      if (!isPlainObject(mark) || typeof mark.type !== "string") return false;
    }
  }
  return true;
}

/** Returns a normalized doc or null when the value is not a usable Tiptap doc. */
export function normalizeContentDoc(value: unknown): TiptapDoc | null {
  if (!isTiptapNode(value) || value.type !== "doc") {
    return null;
  }
  return value as TiptapDoc;
}

export function validateContentDoc(value: unknown): asserts value is TiptapDoc {
  if (!normalizeContentDoc(value)) {
    throw new Error("contentDoc must be a Tiptap doc JSON object");
  }
}

function textFromInline(nodes: TiptapNode[] | undefined): string {
  if (!nodes || nodes.length === 0) return "";
  let out = "";
  for (const node of nodes) {
    if (node.type === "text") {
      out += node.text ?? "";
      continue;
    }
    if (node.type === "hardBreak") {
      out += "\n";
      continue;
    }
    out += textFromInline(node.content);
  }
  return out;
}

function blockPlainText(node: TiptapNode): string {
  switch (node.type) {
    case "paragraph":
    case "heading":
    case "blockquote":
      return textFromInline(node.content);
    case "codeBlock":
      return textFromInline(node.content);
    case "horizontalRule":
      return "---";
    case "bulletList":
    case "orderedList": {
      const items = (node.content ?? []).map((item) => {
        const paragraphs = (item.content ?? []).map(blockPlainText).filter(Boolean);
        return paragraphs.join("\n");
      });
      return items.filter(Boolean).join("\n");
    }
    case "listItem":
      return (node.content ?? []).map(blockPlainText).filter(Boolean).join("\n");
    default:
      if (node.content) {
        return node.content.map(blockPlainText).filter(Boolean).join("\n\n");
      }
      return textFromInline(node.content);
  }
}

/**
 * Derive the authoritative plain-text extract from a Tiptap JSON doc.
 * Block nodes are joined with blank lines so word-count / AI see readable prose.
 */
export function plainTextFromDoc(doc: unknown): string {
  const normalized = normalizeContentDoc(doc);
  if (!normalized) {
    return "";
  }
  const blocks = (normalized.content ?? []).map(blockPlainText);
  return blocks
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Wrap plain prose as a minimal Tiptap doc (one paragraph per blank-line block). */
export function docFromPlainText(plain: string): TiptapDoc {
  const text = typeof plain === "string" ? plain : "";
  if (!text.trim()) {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  const paragraphs = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return {
    type: "doc",
    content: paragraphs.map((block) => {
      const lines = block.split("\n");
      const content: TiptapNode[] = [];
      lines.forEach((line, index) => {
        if (line.length > 0) {
          content.push({ type: "text", text: line });
        }
        if (index < lines.length - 1) {
          content.push({ type: "hardBreak" });
        }
      });
      return content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" };
    }),
  };
}

/**
 * Prefer `contentDoc` when present; otherwise wrap plain `content`.
 * Used when hydrating the editor for legacy PLAIN scenes.
 */
export function docForEditor(contentDoc: unknown, plainContent: string): TiptapDoc {
  const normalized = normalizeContentDoc(contentDoc);
  if (normalized) return normalized;
  return docFromPlainText(plainContent ?? "");
}

/** Append plain insert text as new paragraphs without flattening existing marks. */
export function appendPlainTextToDoc(doc: TiptapDoc | null, plainInsert: string): TiptapDoc {
  const base = doc ?? docFromPlainText("");
  const inserted = docFromPlainText(plainInsert);
  const baseContent = [...(base.content ?? [])];
  while (
    baseContent.length > 0 &&
    baseContent[baseContent.length - 1]?.type === "paragraph" &&
    !baseContent[baseContent.length - 1].content?.length
  ) {
    baseContent.pop();
  }
  return {
    type: "doc",
    content: [...baseContent, ...(inserted.content ?? [])],
  };
}
