"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor, JSONContent } from "@tiptap/core";
import {
  createEditorExtensions,
  docForEditor,
  plainTextFromDoc,
  plainTextToInsertContent,
  type TiptapDoc,
} from "@/lib/writing/tiptap";

/** A non-empty text selection in the editor (ProseMirror positions + plain text). */
export interface EditorSelection {
  from: number;
  to: number;
  text: string;
}

/**
 * Imperative surface for selection-aware tools (Craft, STO-1290). Kept tiny so
 * the parent never reaches into Tiptap directly.
 */
export interface RichTextEditorHandle {
  getSelection: () => EditorSelection | null;
  /** Whether `range` still holds exactly `range.text`. */
  matches: (range: EditorSelection) => boolean;
  /**
   * Replaces `range` with plain `text` as one undoable edit. Returns false
   * (and changes nothing) if the range no longer holds `range.text`, e.g. the
   * author edited the passage after the tool ran.
   */
  replaceRange: (range: EditorSelection, text: string) => boolean;
}

/** Block separator for selection text; matches `plainTextFromDoc`. */
const BLOCK_SEPARATOR = "\n\n";

function rangeText(editor: Editor, from: number, to: number): string {
  return editor.state.doc.textBetween(from, to, BLOCK_SEPARATOR, "\n");
}

export function selectionOf(editor: Editor): EditorSelection | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const text = rangeText(editor, from, to);
  return text.trim() ? { from, to, text } : null;
}

export function createEditorHandle(editor: Editor): RichTextEditorHandle {
  const matches = (range: EditorSelection) => {
    const size = editor.state.doc.content.size;
    if (range.from < 0 || range.to > size || range.from >= range.to) return false;
    return rangeText(editor, range.from, range.to) === range.text;
  };
  return {
    getSelection: () => selectionOf(editor),
    matches,
    replaceRange: (range, text) => {
      if (!matches(range)) return false;
      const content = plainTextToInsertContent(text);
      if (content.length === 0) return false;
      return editor
        .chain()
        .focus()
        .insertContentAt({ from: range.from, to: range.to }, content as JSONContent[])
        .run();
    },
  };
}

export interface RichTextEditorProps {
  /** Initial / external doc (or null to wrap plainContent). */
  contentDoc: TiptapDoc | null;
  plainContent: string;
  /** Fires on every doc change with JSON + plain extract. */
  onChange: (next: { contentDoc: TiptapDoc; content: string }) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  placeholder?: string;
  editable?: boolean;
  /** Fires when the text selection changes (null = caret only / empty). */
  onSelectionChange?: (selection: EditorSelection | null) => void;
  /** Receives the imperative handle once the editor mounts (null on unmount). */
  onReady?: (handle: RichTextEditorHandle | null) => void;
}

/**
 * Headless Tiptap surface styled with InkStory prose-canvas chrome.
 * Toolbar lives in the parent so SceneEditor can share header space.
 */
export function RichTextEditor(props: RichTextEditorProps) {
  const onSelectionChangeRef = useRef(props.onSelectionChange);
  onSelectionChangeRef.current = props.onSelectionChange;
  const onReadyRef = useRef(props.onReady);
  onReadyRef.current = props.onReady;

  const editor = useEditor({
    immediatelyRender: false,
    extensions: createEditorExtensions(),
    content: docForEditor(props.contentDoc, props.plainContent) as JSONContent,
    editable: props.editable !== false,
    editorProps: {
      attributes: {
        class:
          "prose-canvas tiptap-editor min-h-0 flex-1 px-6 py-5 text-[17px] leading-8 text-primary focus:outline-none",
        "aria-label": "Scene text",
        "data-testid": "scene-text",
        spellcheck: "true",
      },
      handleDOMEvents: {
        keydown: (_view, event) => {
          if (props.onKeyDown) {
            props.onKeyDown(event as unknown as React.KeyboardEvent);
          }
          return false;
        },
      },
    },
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON() as TiptapDoc;
      props.onChange({ contentDoc: json, content: plainTextFromDoc(json) });
    },
    onSelectionUpdate: ({ editor: ed }) => {
      onSelectionChangeRef.current?.(selectionOf(ed));
    },
  });

  useEffect(() => {
    if (!editor) return;
    onReadyRef.current?.(createEditorHandle(editor));
    return () => onReadyRef.current?.(null);
  }, [editor]);

  // External plain inserts (AI drawer) / restore: when the parent doc or plain
  // extract drifts from the editor, reset. Plain-only equality is not enough —
  // identical text with different marks must still apply.
  useEffect(() => {
    if (!editor) return;
    const currentJson = editor.getJSON() as TiptapDoc;
    const currentPlain = plainTextFromDoc(currentJson);
    const targetDoc = docForEditor(props.contentDoc, props.plainContent);
    if (
      currentPlain === props.plainContent &&
      JSON.stringify(currentJson) === JSON.stringify(targetDoc)
    ) {
      return;
    }
    editor.commands.setContent(targetDoc as JSONContent, {
      emitUpdate: false,
    });
  }, [editor, props.plainContent, props.contentDoc]);

  if (!editor) {
    return (
      <div
        className="prose-canvas min-h-0 flex-1 px-6 py-5 text-[17px] leading-8 text-ink-300"
        data-testid="scene-text-loading"
      >
        {props.placeholder ?? "Start writing…"}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="rich-text-editor">
      <div
        className="border-ink-200 flex flex-wrap items-center gap-1 border-b px-4 py-1.5"
        data-testid="editor-toolbar"
        role="toolbar"
        aria-label="Text formatting"
      >
        <ToolbarButton
          label="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="H2"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarButton
          label="H3"
          active={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        />
        <ToolbarButton
          label="Highlight"
          active={editor.isActive("highlight")}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
        />
        <ToolbarButton
          label="Divider"
          active={false}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        />
      </div>
      <EditorContent editor={editor} className="flex min-h-0 flex-1 flex-col overflow-y-auto" />
    </div>
  );
}

function ToolbarButton(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      aria-pressed={props.active}
      className={`rounded px-2 py-1 text-xs font-medium ${
        props.active ? "bg-ink-800 text-white" : "text-ink-700 hover:bg-ink-100"
      }`}
    >
      {props.label}
    </button>
  );
}
