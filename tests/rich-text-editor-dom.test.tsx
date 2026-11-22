// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { RichTextEditor } from "../src/app/dashboard/novels/[id]/_components/RichTextEditor";
import { docFromPlainText } from "../src/lib/writing/tiptap";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RichTextEditor", () => {
  it("mounts toolbar controls and the prose surface", async () => {
    const onChange = vi.fn();
    const onKeyDown = vi.fn();
    render(
      React.createElement(RichTextEditor, {
        contentDoc: docFromPlainText("Hello quay"),
        plainContent: "Hello quay",
        onChange,
        onKeyDown,
      }),
    );

    expect(await screen.findByTestId("editor-toolbar")).toBeTruthy();
    expect(screen.getByLabelText("Text formatting")).toBeTruthy();

    for (const label of ["Bold", "Italic", "H2", "H3", "Highlight", "Divider"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }

    await waitFor(() => {
      expect(screen.getByLabelText("Scene text")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Bold"));
    fireEvent.click(screen.getByText("Italic"));
    fireEvent.click(screen.getByText("Highlight"));
    fireEvent.click(screen.getByText("H2"));
    fireEvent.click(screen.getByText("H3"));
    fireEvent.click(screen.getByText("Divider"));

    const surface = screen.getByLabelText("Scene text");
    fireEvent.keyDown(surface, { key: "s", ctrlKey: true });
    expect(onKeyDown).toHaveBeenCalled();
  });

  it("syncs when plainContent is replaced externally", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      React.createElement(RichTextEditor, {
        contentDoc: null,
        plainContent: "First",
        onChange,
      }),
    );
    await screen.findByTestId("rich-text-editor");

    rerender(
      React.createElement(RichTextEditor, {
        contentDoc: docFromPlainText("Second draft"),
        plainContent: "Second draft",
        onChange,
      }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Scene text").textContent).toContain("Second draft");
    });
  });
});
