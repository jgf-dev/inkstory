// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Outliner } from "../src/app/dashboard/novels/[id]/_components/Outliner";
import { SceneEditor } from "../src/app/dashboard/novels/[id]/_components/SceneEditor";
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

  it("cancels rename on Escape and starts act rename without an input", () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText("Rename Storm"));
    const input = screen.getByDisplayValue("Storm");
    fireEvent.keyDown(input, { key: "x" });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByDisplayValue("Storm")).toBeNull();
    fireEvent.click(screen.getByLabelText("Rename Act I"));
    expect(p.onRenameNode).not.toHaveBeenCalled();
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
    unmount();

    window.localStorage.setItem("inkstory.scene-draft.scene-1", JSON.stringify(draft));
    setup();
    fireEvent.click(screen.getByText("Discard"));
    expect(screen.queryByTestId("draft-restore")).toBeNull();
    expect(window.localStorage.getItem("inkstory.scene-draft.scene-1")).toBeNull();
  });

  it("appends AI insert requests once per sequence number", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, JSON.stringify({ scene }))));
    const { rerender, props } = setup({ insertRequest: { seq: 1, text: "Inserted." } });
    expect((screen.getByLabelText("Scene text") as HTMLTextAreaElement).value).toBe(
      "Mara reached the quay at dawn.\n\nInserted.",
    );
    rerender(
      React.createElement(SceneEditor, { ...props, insertRequest: { seq: 1, text: "Inserted." } }),
    );
    expect((screen.getByLabelText("Scene text") as HTMLTextAreaElement).value).toBe(
      "Mara reached the quay at dawn.\n\nInserted.",
    );
    fireEvent.change(screen.getByLabelText("Scene text"), { target: { value: "" } });
    rerender(
      React.createElement(SceneEditor, { ...props, insertRequest: { seq: 2, text: "Fresh" } }),
    );
    expect((screen.getByLabelText("Scene text") as HTMLTextAreaElement).value).toBe("Fresh");
  });
});
