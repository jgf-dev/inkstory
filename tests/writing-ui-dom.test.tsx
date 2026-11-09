// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Outliner } from "../src/app/dashboard/novels/[id]/_components/Outliner";
import { SceneEditor } from "../src/app/dashboard/novels/[id]/_components/SceneEditor";

vi.mock("../src/app/dashboard/novels/[id]/_components/RichTextEditor", () => ({
  RichTextEditor: (props: {
    plainContent: string;
    onChange: (next: { content: string; contentDoc: unknown }) => void;
    onKeyDown?: (e: React.KeyboardEvent) => void;
  }) =>
    React.createElement("textarea", {
      "aria-label": "Scene text",
      value: props.plainContent,
      onChange: (e: any) =>
        props.onChange({
          content: e.target.value,
          contentDoc: {
            type: "doc",
            content: e.target.value
              ? [{ type: "paragraph", content: [{ type: "text", text: e.target.value }] }]
              : [{ type: "paragraph" }],
          },
        }),
      onKeyDown: props.onKeyDown,
    }),
}));
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  ApiRequestError,
} from "../src/app/dashboard/novels/[id]/_components/api";
import type { NovelOutline } from "../src/lib/writing/service";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) =>
    React.createElement("a", { href, ...rest }, children),
}));

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
          { id: "chapter-2", title: "Chapter Two", position: 1, scenes: [] },
        ],
      },
      { id: "act-2", title: "Act II", position: 1, chapters: [] },
    ],
    totals: { acts: 2, chapters: 2, scenes: 1, words: 120 },
  } as NovelOutline;
}

function jsonResponse(status: number, body: string) {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as Response;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("writing api helpers", () => {
  it("sends each method with JSON bodies and parses the payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, '{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiGet("/a")).resolves.toEqual({ ok: true });
    await expect(apiPost("/b", { x: 1 })).resolves.toEqual({ ok: true });
    await expect(apiPatch("/c", { y: 2 })).resolves.toEqual({ ok: true });
    await expect(apiDelete("/d")).resolves.toEqual({ ok: true });
    expect(fetchMock.mock.calls[0]).toEqual([
      "/a",
      { method: "GET", headers: undefined, body: undefined },
    ]);
    expect(fetchMock.mock.calls[1][1]).toEqual({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"x":1}',
    });
    expect(fetchMock.mock.calls[2][1].method).toBe("PATCH");
    expect(fetchMock.mock.calls[3][1].method).toBe("DELETE");
  });

  it("returns null for empty bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(204, "")));
    await expect(apiGet("/empty")).resolves.toBeNull();
  });

  it("maps error payloads to ApiRequestError with code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(402, '{"error":"Quota hit","code":"QUOTA"}')),
    );
    const err: any = await apiPost("/x", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err.name).toBe("ApiRequestError");
    expect(err.message).toBe("Quota hit");
    expect(err.status).toBe(402);
    expect(err.code).toBe("QUOTA");
    expect(err.body).toEqual({ error: "Quota hit", code: "QUOTA" });
  });

  it("falls back to a generic message for non-JSON and code-less errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, "boom")));
    const err: any = await apiGet("/x").catch((e: unknown) => e);
    expect(err.message).toBe("boom");
    expect(err.code).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(503, '{"error":7}')));
    const err2: any = await apiGet("/x").catch((e: unknown) => e);
    expect(err2.message).toBe("Request failed (503)");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, "")));
    const err3: any = await apiGet("/x").catch((e: unknown) => e);
    expect(err3.message).toBe("Request failed (500)");
  });

  it("wraps network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const err: any = await apiGet("/x").catch((e: unknown) => e);
    expect(err.message).toBe("Network error: offline");
    expect(err.status).toBe(0);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue("nope"));
    const err2: any = await apiGet("/x").catch((e: unknown) => e);
    expect(err2.message).toBe("Network error: request failed");
  });
});

describe("Outliner interactions", () => {
  function setup(overrides: Partial<React.ComponentProps<typeof Outliner>> = {}) {
    const props = {
      outline: makeOutline(),
      selectedSceneId: "scene-1",
      busy: false,
      onSelectScene: vi.fn(),
      onCreateNode: vi.fn(),
      onRenameNode: vi.fn(),
      onMoveNode: vi.fn(),
      onReorderNode: vi.fn(),
      onDeleteNode: vi.fn(),
      ...overrides,
    };
    render(React.createElement(Outliner, props));
    return props;
  }

  it("fires create, select, move and delete callbacks", () => {
    const p = setup();
    fireEvent.click(screen.getByText("+ Act"));
    expect(p.onCreateNode).toHaveBeenCalledWith("act");
    fireEvent.click(screen.getAllByTitle("Add chapter")[0]);
    expect(p.onCreateNode).toHaveBeenCalledWith("chapter", "act-1");
    fireEvent.click(screen.getAllByTitle("Add scene")[0]);
    expect(p.onCreateNode).toHaveBeenCalledWith("scene", "chapter-1");
    fireEvent.click(screen.getByTestId("scene-link-scene-2"));
    expect(p.onSelectScene).toHaveBeenCalledWith("scene-2");
    fireEvent.click(screen.getByLabelText("Move Storm up"));
    expect(p.onMoveNode).toHaveBeenCalledWith("scene", "scene-2", "up");
    fireEvent.click(screen.getByLabelText("Move Act I down"));
    expect(p.onMoveNode).toHaveBeenCalledWith("act", "act-1", "down");
    fireEvent.click(screen.getByLabelText("Delete Chapter One"));
    expect(p.onDeleteNode).toHaveBeenCalledWith("chapter", "chapter-1", "Chapter One");
    expect(screen.getByText("Empty chapter")).toBeTruthy();
    expect(screen.getByText("No chapters")).toBeTruthy();
    expect(screen.getByText(/1 scene ·/)).toBeTruthy();
  });

  it("reorders siblings via drag-and-drop onto another row", () => {
    const p = setup();
    const handle = screen.getByTestId("outline-drag-scene-scene-2");
    const target = screen.getByTestId("outline-row-scene-scene-1");

    const store: Record<string, string> = {};
    const dataTransfer = {
      effectAllowed: "move",
      dropEffect: "move",
      setData: (type: string, value: string) => {
        store[type] = value;
      },
      getData: (type: string) => store[type] ?? "",
      types: [] as string[],
    };

    act(() => {
      const start = createEvent.dragStart(handle);
      Object.defineProperty(start, "dataTransfer", { value: dataTransfer });
      fireEvent(handle, start);
    });

    expect(store["application/x-inkstory-outline"] || store["text/plain"]).toContain("scene-2");

    const rect = {
      top: 100,
      height: 40,
      bottom: 140,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: 100,
      toJSON() {},
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect);

    act(() => {
      const over = createEvent.dragOver(target);
      Object.defineProperty(over, "dataTransfer", { value: dataTransfer });
      Object.defineProperty(over, "clientY", { value: 110 });
      fireEvent(target, over);

      const drop = createEvent.drop(target);
      Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
      Object.defineProperty(drop, "clientY", { value: 110 });
      fireEvent(target, drop);
    });

    expect(p.onReorderNode).toHaveBeenCalledWith("scene", "scene-2", 0);
  });

  it("ignores cross-parent drops", () => {
    const p = setup();
    const handle = screen.getByTestId("outline-drag-scene-scene-1");
    const target = screen.getByTestId("outline-row-act-act-2");
    const store: Record<string, string> = {};
    const dataTransfer = {
      effectAllowed: "move",
      dropEffect: "move",
      setData: (type: string, value: string) => {
        store[type] = value;
      },
      getData: (type: string) => store[type] ?? "",
    };
    act(() => {
      const start = createEvent.dragStart(handle);
      Object.defineProperty(start, "dataTransfer", { value: dataTransfer });
      fireEvent(handle, start);
      const drop = createEvent.drop(target);
      Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
      Object.defineProperty(drop, "clientY", { value: 10 });
      fireEvent(target, drop);
    });
    expect(p.onReorderNode).not.toHaveBeenCalled();
  });

  it("reorders acts and chapters via drag-and-drop, including 'after' drops", () => {
    const p = setup();
    const store: Record<string, string> = {};
    const dataTransfer = {
      effectAllowed: "move",
      dropEffect: "move",
      setData: (type: string, value: string) => {
        store[type] = value;
      },
      getData: (type: string) => store[type] ?? "",
      types: [] as string[],
    };
    const rect = {
      top: 100,
      height: 40,
      bottom: 140,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: 100,
      toJSON() {},
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect);

    // Act reorder: act-2 dragged before act-1
    const actHandle = screen.getByTestId("outline-drag-act-act-2");
    const actTarget = screen.getByTestId("outline-row-act-act-1");
    act(() => {
      const start = createEvent.dragStart(actHandle);
      Object.defineProperty(start, "dataTransfer", { value: dataTransfer });
      fireEvent(actHandle, start);
    });

    act(() => {
      const over = createEvent.dragOver(actTarget);
      Object.defineProperty(over, "dataTransfer", { value: dataTransfer });
      Object.defineProperty(over, "clientY", { value: 110 }); // "before"
      fireEvent(actTarget, over);
    });
    expect(actTarget.className).toContain("border-t-2");

    act(() => {
      const drop = createEvent.drop(actTarget);
      Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
      Object.defineProperty(drop, "clientY", { value: 110 });
      fireEvent(actTarget, drop);
    });
    expect(p.onReorderNode).toHaveBeenCalledWith("act", "act-2", 0);

    // Chapter reorder: chapter-1 dragged after chapter-2
    const chapHandle = screen.getByTestId("outline-drag-chapter-chapter-1");
    const chapTarget = screen.getByTestId("outline-row-chapter-chapter-2");
    act(() => {
      const start = createEvent.dragStart(chapHandle);
      Object.defineProperty(start, "dataTransfer", { value: dataTransfer });
      fireEvent(chapHandle, start);
    });

    act(() => {
      const over = createEvent.dragOver(chapTarget);
      Object.defineProperty(over, "dataTransfer", { value: dataTransfer });
      Object.defineProperty(over, "clientY", { value: 135 }); // > 120 -> "after"
      fireEvent(chapTarget, over);
    });
    expect(chapTarget.className).toContain("border-b-2");

    act(() => {
      const drop = createEvent.drop(chapTarget);
      Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
      Object.defineProperty(drop, "clientY", { value: 135 });
      fireEvent(chapTarget, drop);
    });
    expect(p.onReorderNode).toHaveBeenCalledWith("chapter", "chapter-1", 1);
  });

  it("handles drag edge cases: busy prevention, self-target, drag leave, fallback drag, and no-op drop", () => {
    setup({ busy: true });
    const handle = screen.getByTestId("outline-drag-scene-scene-1");
    const dataTransfer = {
      effectAllowed: "move",
      dropEffect: "move",
      setData: vi.fn(),
      getData: () => "",
      types: [] as string[],
    };
    act(() => {
      const start = createEvent.dragStart(handle);
      Object.defineProperty(start, "dataTransfer", { value: dataTransfer });
      fireEvent(handle, start);
    });
    expect(dataTransfer.setData).not.toHaveBeenCalled();

    cleanup();
    const p2 = setup({ busy: false });
    const handle2 = screen.getByTestId("outline-drag-scene-scene-1");
    const target2 = screen.getByTestId("outline-row-scene-scene-1");
    const actHandle = screen.getByTestId("outline-drag-act-act-2");
    const actTarget = screen.getByTestId("outline-row-act-act-1");
    const chapHandle = screen.getByTestId("outline-drag-chapter-chapter-2");
    const chapTarget = screen.getByTestId("outline-row-chapter-chapter-1");
    const scene2Target = screen.getByTestId("outline-row-scene-scene-2");

    const store: Record<string, string> = {};
    const dt2 = {
      effectAllowed: "move",
      dropEffect: "move",
      setData: (t: string, v: string) => {
        store[t] = v;
      },
      getData: (t: string) => store[t] ?? "",
      types: [] as string[],
    };
    const emptyDt = {
      effectAllowed: "move",
      dropEffect: "move",
      setData: vi.fn(),
      getData: () => "",
      types: [] as string[],
    };

    const rect = {
      top: 100,
      height: 40,
      bottom: 140,
      left: 0,
      right: 100,
      width: 100,
      x: 0,
      y: 100,
      toJSON() {},
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect as DOMRect);

    act(() => {
      // 1. Act drag leave test
      const actStart = createEvent.dragStart(actHandle);
      Object.defineProperty(actStart, "dataTransfer", { value: dt2 });
      fireEvent(actHandle, actStart);
      const actOver = createEvent.dragOver(actTarget);
      Object.defineProperty(actOver, "dataTransfer", { value: dt2 });
      Object.defineProperty(actOver, "clientY", { value: 110 });
      fireEvent(actTarget, actOver);
      fireEvent.dragLeave(actTarget);
      fireEvent.dragEnd(actHandle);

      // 2. Chapter drag leave test
      const chapStart = createEvent.dragStart(chapHandle);
      Object.defineProperty(chapStart, "dataTransfer", { value: dt2 });
      fireEvent(chapHandle, chapStart);
      const chapOver = createEvent.dragOver(chapTarget);
      Object.defineProperty(chapOver, "dataTransfer", { value: dt2 });
      Object.defineProperty(chapOver, "clientY", { value: 110 });
      fireEvent(chapTarget, chapOver);
      fireEvent.dragLeave(chapTarget);
      fireEvent.dragEnd(chapHandle);

      // 3. Scene drag with fallback getData (empty) hitting in-memory dragging state
      const start = createEvent.dragStart(handle2);
      Object.defineProperty(start, "dataTransfer", { value: dt2 });
      fireEvent(handle2, start);
    });

    act(() => {
      const overSelf = createEvent.dragOver(target2);
      Object.defineProperty(overSelf, "dataTransfer", { value: dt2 });
      fireEvent(target2, overSelf);

      fireEvent.dragLeave(target2);

      // Drag over sibling with nextTo === payload.index (scene-1 over scene-2 top half)
      const overNoOp = createEvent.dragOver(scene2Target);
      Object.defineProperty(overNoOp, "dataTransfer", { value: dt2 });
      Object.defineProperty(overNoOp, "clientY", { value: 110 });
      fireEvent(scene2Target, overNoOp);

      // No-op drop: scene-1 dropped before scene-2 results in toIndex === 0 === payload.index
      const dropNoOp = createEvent.drop(scene2Target);
      Object.defineProperty(dropNoOp, "dataTransfer", { value: emptyDt });
      Object.defineProperty(dropNoOp, "clientY", { value: 110 });
      fireEvent(scene2Target, dropNoOp);

      // Drop on self
      const dropSelf = createEvent.drop(target2);
      Object.defineProperty(dropSelf, "dataTransfer", { value: dt2 });
      fireEvent(target2, dropSelf);

      fireEvent.dragEnd(handle2);
    });
    expect(p2.onReorderNode).not.toHaveBeenCalled();
  });

  it("renames a scene inline with Enter and ignores blank titles", () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText("Rename The Quay"));
    const input = screen.getByDisplayValue("The Quay");
    fireEvent.change(input, { target: { value: "  The Harbour  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(p.onRenameNode).toHaveBeenCalledWith("scene", "scene-1", "The Harbour");

    fireEvent.click(screen.getByLabelText("Rename Storm"));
    const input2 = screen.getByDisplayValue("Storm");
    fireEvent.change(input2, { target: { value: "   " } });
    fireEvent.blur(input2);
    expect(p.onRenameNode).toHaveBeenCalledTimes(1);
  });

  it("cancels rename on Escape and supports act and chapter renames", () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText("Rename Storm"));
    const input = screen.getByDisplayValue("Storm");
    fireEvent.keyDown(input, { key: "x" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByDisplayValue("Storm")).toBeNull();

    fireEvent.click(screen.getByLabelText("Rename Act I"));
    const actInput = screen.getByDisplayValue("Act I");
    fireEvent.change(actInput, { target: { value: "Act One" } });
    fireEvent.keyDown(actInput, { key: "Enter" });
    expect(p.onRenameNode).toHaveBeenCalledWith("act", "act-1", "Act One");

    fireEvent.click(screen.getByLabelText("Rename Chapter One"));
    const chInput = screen.getByDisplayValue("Chapter One");
    fireEvent.change(chInput, { target: { value: "Chapter 1" } });
    fireEvent.keyDown(chInput, { key: "Enter" });
    expect(p.onRenameNode).toHaveBeenCalledWith("chapter", "chapter-1", "Chapter 1");
  });

  it("creates the first act from the empty state", () => {
    const outline = makeOutline();
    outline.acts = [];
    const p = setup({ outline });
    fireEvent.click(screen.getByText("Create first act"));
    expect(p.onCreateNode).toHaveBeenCalledWith("act");
  });
});

describe("SceneEditor interactions", () => {
  const scene = {
    id: "scene-1",
    title: "The Quay",
    content: "Mara reached the quay at dawn.",
    contentDoc: null,
    contentFormat: "PLAIN" as const,
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

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  function setup(extra: Record<string, unknown> = {}) {
    const props = { scene: scene as any, onSaved: vi.fn(), onProseChange: vi.fn(), ...extra };
    const utils = render(React.createElement(SceneEditor, props));
    return { props, ...utils };
  }

  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
  }

  it("autosaves only changed fields after the debounce", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, JSON.stringify({ scene })));
    vi.stubGlobal("fetch", fetchMock);
    const { props } = setup();
    expect(screen.getByTestId("save-status").textContent).toBe("All changes saved");

    fireEvent.click(screen.getByText("Details"));
    expect(screen.getByTestId("scene-meta")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Scene title"), { target: { value: "Dock" } });
    fireEvent.change(screen.getByLabelText("Scene text"), { target: { value: "New words here" } });
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[0], { target: { value: "FIRST" } });
    fireEvent.change(selects[1], { target: { value: "PRESENT" } });
    fireEvent.change(screen.getByPlaceholderText("What happens in this scene?"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByTestId("save-status").textContent).toBe("Unsaved changes");
    expect(window.localStorage.length).toBe(1);

    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/scenes/scene-1");
    const body = JSON.parse(init.body);
    expect(body.title).toBe("Dock");
    expect(body.content).toBe("New words here");
    expect(body.summary).toBeNull();
    expect(body.tense).toBe("PRESENT");
    expect(body.excludeFromAi).toBe(true);
    expect(props.onSaved).toHaveBeenCalled();
    expect(props.onProseChange).toHaveBeenCalledWith("New words here");
    expect(screen.getByTestId("save-status").textContent).toBe("All changes saved");
    expect(window.localStorage.length).toBe(0);
    fireEvent.click(screen.getByText("Hide details"));
    expect(screen.queryByTestId("scene-meta")).toBeNull();
  });

  it("keeps a local draft and shows the API error when a save fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, '{"error":"DB down"}')));
    setup();
    fireEvent.change(screen.getByLabelText("Scene text"), { target: { value: "Lost words" } });
    fireEvent.keyDown(screen.getByLabelText("Scene text"), { key: "s", ctrlKey: true });
    await flush();
    expect(screen.getByTestId("save-status").textContent).toContain("Save failed");
    expect(screen.getByText("DB down")).toBeTruthy();
    expect(window.localStorage.getItem("inkstory.scene-draft.scene-1")).toContain("Lost words");
  });

  it("uses a generic message for non-API save errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, "{}")));
    setup({
      onSaved: () => {
        throw new TypeError("bad payload");
      },
    });
    fireEvent.change(screen.getByLabelText("Scene text"), { target: { value: "x" } });
    await flush();
    expect(screen.getByText("Save failed")).toBeTruthy();
  });

  it("flushes with Cmd+S as a no-op when nothing changed", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.keyDown(screen.getByLabelText("Scene text"), { key: "S", metaKey: true });
    fireEvent.keyDown(screen.getByLabelText("Scene text"), { key: "a" });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("offers to restore or discard a newer failed draft", () => {
    const draft = {
      sceneId: "scene-1",
      title: "Draft title",
      content: "Draft prose",
      summary: "Draft summary",
      pov: "FIRST",
      tense: "PRESENT",
      excludeFromAi: true,
      savedAt: Date.parse("2026-10-09T00:00:00.000Z"),
      unsaved: true,
    };
    window.localStorage.setItem("inkstory.scene-draft.scene-1", JSON.stringify(draft));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, JSON.stringify({ scene }))));
    const { unmount } = setup();
    expect(screen.getByTestId("draft-restore")).toBeTruthy();
    fireEvent.click(screen.getByText("Restore draft"));
    expect(screen.getByDisplayValue("Draft prose")).toBeTruthy();
    expect(screen.queryByTestId("draft-restore")).toBeNull();

    fireEvent.click(screen.getByText("Details"));
    const [povSelect, tenseSelect] = screen.getAllByRole("combobox");
    if (!(povSelect instanceof HTMLSelectElement) || !(tenseSelect instanceof HTMLSelectElement)) {
      throw new Error("expected <select> elements");
    }
    expect(povSelect.value).toBe("FIRST");
    expect(tenseSelect.value).toBe("PRESENT");
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true);
    unmount();

    window.localStorage.setItem("inkstory.scene-draft.scene-1", JSON.stringify(draft));
    setup();
    fireEvent.click(screen.getByText("Discard"));
    expect(screen.queryByTestId("draft-restore")).toBeNull();
    expect(window.localStorage.getItem("inkstory.scene-draft.scene-1")).toBeNull();
  });

  it("appends AI insert requests once per sequence number", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, JSON.stringify({ scene }))));
    const { rerender, props } = setup({
      insertRequest: { seq: 1, text: "Inserted.", sceneId: "scene-1" },
    });
    expect((screen.getByLabelText("Scene text") as HTMLTextAreaElement).value).toBe(
      "Mara reached the quay at dawn.\n\nInserted.",
    );
    rerender(
      React.createElement(SceneEditor, {
        ...props,
        insertRequest: { seq: 1, text: "Inserted.", sceneId: "scene-1" },
      }),
    );
    expect((screen.getByLabelText("Scene text") as HTMLTextAreaElement).value).toBe(
      "Mara reached the quay at dawn.\n\nInserted.",
    );
    fireEvent.change(screen.getByLabelText("Scene text"), { target: { value: "" } });
    rerender(
      React.createElement(SceneEditor, {
        ...props,
        insertRequest: { seq: 2, text: "Fresh", sceneId: "scene-1" },
      }),
    );
    expect((screen.getByLabelText("Scene text") as HTMLTextAreaElement).value).toBe("Fresh");
  });

  it("ignores an AI insert request made for another scene", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, JSON.stringify({ scene }))));
    setup({ insertRequest: { seq: 1, text: "Stale.", sceneId: "scene-other" } });
    expect((screen.getByLabelText("Scene text") as HTMLTextAreaElement).value).toBe(
      "Mara reached the quay at dawn.",
    );
  });

  it("loads revision history and restores a version", async () => {
    const restored = {
      ...scene,
      content: "Older prose",
      contentDoc: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Older prose" }] }],
      },
      contentFormat: "TIPTAP_JSON" as const,
      title: "Older title",
    };
    const fetchMock = vi.fn().mockImplementation(async (url: string, _init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/revisions/") && url.endsWith("/restore")) {
        return jsonResponse(200, JSON.stringify({ scene: restored }));
      }
      if (typeof url === "string" && url.includes("/revisions")) {
        return jsonResponse(
          200,
          JSON.stringify({
            revisions: [
              {
                id: "rev-1",
                sceneId: "scene-1",
                title: "Older title",
                summary: null,
                pov: "THIRD_LIMITED",
                tense: "PAST",
                wordCount: 2,
                reason: "AUTOSAVE",
                contentFormat: "TIPTAP_JSON",
                createdAt: "2026-10-08T01:00:00.000Z",
                contentPreview: "Older prose",
              },
            ],
          }),
        );
      }
      return jsonResponse(200, JSON.stringify({ scene }));
    });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    fireEvent.click(screen.getByText("History"));
    expect(await screen.findByTestId("scene-history")).toBeTruthy();
    expect(await screen.findByTestId("revision-row")).toBeTruthy();
    fireEvent.click(screen.getByText("Restore"));
    await flush();
    expect(screen.getByDisplayValue("Older prose")).toBeTruthy();
    expect(screen.getByDisplayValue("Older title")).toBeTruthy();
  });

  it("serializes saves and keeps draft when edits occur during save", async () => {
    let resolvePatch!: (value: any) => void;
    const fetchMock = vi.fn().mockImplementation(() => {
      return new Promise((resolve) => {
        resolvePatch = resolve;
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    setup();

    fireEvent.change(screen.getByLabelText("Scene text"), { target: { value: "First edit" } });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Scene text"), { target: { value: "Second edit" } });
    fireEvent.keyDown(screen.getByLabelText("Scene text"), { key: "s", ctrlKey: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePatch(
        jsonResponse(200, JSON.stringify({ scene: { ...scene, content: "First edit" } })),
      );
    });

    expect(window.localStorage.getItem("inkstory.scene-draft.scene-1")).toContain("Second edit");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondInit] = fetchMock.mock.calls[1];
    expect(JSON.parse(secondInit.body).content).toBe("Second edit");
  });
});
