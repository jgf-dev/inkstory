// @vitest-environment happy-dom
import React from "react";
import { cleanup, render, waitFor, act } from "@testing-library/react";
import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  RichTextEditor,
  createEditorHandle,
  selectionOf,
  type RichTextEditorHandle,
} from "../src/app/dashboard/novels/[id]/_components/RichTextEditor";
import {
  createEditorExtensions,
  docFromPlainText,
  plainTextFromDoc,
} from "../src/lib/writing/tiptap";

const editors: Editor[] = [];
function makeEditor(text: string) {
  const editor = new Editor({
    extensions: createEditorExtensions(),
    content: docFromPlainText(text) as JSONContent,
  });
  editors.push(editor);
  return editor;
}
const plain = (editor: Editor) => plainTextFromDoc(editor.getJSON());

afterEach(() => {
  cleanup();
  while (editors.length) editors.pop()?.destroy();
});

describe("RichTextEditor selection handle (STO-1290)", () => {
  it("reports null for a caret and plain text for a range across blocks", () => {
    const editor = makeEditor("The rain fell.\n\nMara ran.");
    expect(selectionOf(editor)).toBeNull();
    editor.commands.setTextSelection({ from: 5, to: 9 });
    expect(selectionOf(editor)).toEqual({ from: 5, to: 9, text: "rain" });
    editor.commands.selectAll();
    expect(selectionOf(editor)?.text).toBe("The rain fell.\n\nMara ran.");
  });

  it("ignores whitespace-only selections", () => {
    const editor = makeEditor("A  B");
    editor.commands.setTextSelection({ from: 2, to: 4 });
    expect(selectionOf(editor)).toBeNull();
  });

  it("replaces a mid-paragraph range inline, as one edit", () => {
    const editor = makeEditor("The rain fell. Mara ran.");
    const handle = createEditorHandle(editor);
    editor.commands.setTextSelection({ from: 1, to: 15 });
    const range = handle.getSelection()!;
    expect(range.text).toBe("The rain fell.");
    expect(handle.matches(range)).toBe(true);
    expect(handle.replaceRange(range, "Rain needled the tin roof.\n")).toBe(true);
    expect(plain(editor)).toBe("Rain needled the tin roof. Mara ran.");
    expect(editor.getJSON().content).toHaveLength(1);
  });

  it("splits multi-paragraph results into paragraphs", () => {
    const editor = makeEditor("Before.\n\nThe rain fell.\n\nAfter.");
    const handle = createEditorHandle(editor);
    const from = 10; // start of second paragraph text
    const range = { from, to: from + 14, text: "The rain fell." };
    expect(handle.matches(range)).toBe(true);
    expect(handle.replaceRange(range, "Rain hissed.\n\nThunder answered.")).toBe(true);
    expect(plain(editor)).toBe("Before.\n\nRain hissed.\n\nThunder answered.\n\nAfter.");
  });

  it("refuses stale, out-of-bounds, inverted or empty replacements", () => {
    const editor = makeEditor("The rain fell.");
    const handle = createEditorHandle(editor);
    expect(handle.replaceRange({ from: 1, to: 9, text: "The snow" }, "x")).toBe(false);
    expect(handle.matches({ from: 1, to: 999, text: "x" })).toBe(false);
    expect(handle.matches({ from: 5, to: 5, text: "" })).toBe(false);
    expect(handle.matches({ from: -1, to: 2, text: "T" })).toBe(false);
    expect(handle.replaceRange({ from: 1, to: 9, text: "The rain" }, "   ")).toBe(false);
    expect(plain(editor)).toBe("The rain fell.");
  });

  it("exposes the handle and selection changes from the mounted component", async () => {
    let handle: RichTextEditorHandle | null = null;
    const onReady = vi.fn((h: RichTextEditorHandle | null) => {
      handle = h;
    });
    const onSelectionChange = vi.fn();
    const onChange = vi.fn();
    const { unmount } = render(
      React.createElement(RichTextEditor, {
        contentDoc: docFromPlainText("The rain fell."),
        plainContent: "The rain fell.",
        onChange,
        onReady,
        onSelectionChange,
      }),
    );
    await waitFor(() => expect(handle).not.toBeNull());
    const h = handle as unknown as RichTextEditorHandle;
    expect(h.getSelection()).toBeNull();
    act(() => {
      expect(h.replaceRange({ from: 1, to: 9, text: "The rain" }, "The sleet")).toBe(true);
    });
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: "The sleet fell." }),
    );
    expect(onSelectionChange).toHaveBeenCalled();
    unmount();
    expect(onReady).toHaveBeenLastCalledWith(null);
  });
});
