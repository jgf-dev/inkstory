"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import {
  createEditorExtensions,
  docForEditor,
  plainTextFromDoc,
  type TiptapDoc,
} from "@/lib/writing/tiptap";

export interface RichTextEditorProps {
  /** Initial / external doc (or null to wrap plainContent). */
  contentDoc: TiptapDoc | null;
  plainContent: string;
  /** Fires on every doc change with JSON + plain extract. */
  onChange: (next: { contentDoc: TiptapDoc; content: string }) => void;
  onKeyDown?: (event: React.KeyboardEvent) => void;
  placeholder?: string;
  editable?: boolean;
}

/**
 * Headless Tiptap surface styled with InkStory prose-canvas chrome.
 * Toolbar lives in the parent so SceneEditor can share header space.
 */
export function RichTextEditor(props: RichTextEditorProps) {
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
  });

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
