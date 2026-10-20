// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { WritingWorkspace } from "../src/app/dashboard/novels/[id]/_components/WritingWorkspace";
import { AiAssistantDrawer } from "../src/app/dashboard/novels/[id]/_components/AiAssistantDrawer";
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
              { id: "scene-1", title: "The Quay", label: null, position: 0, wordCount: 6 },
              { id: "scene-2", title: "Storm", label: null, position: 1, wordCount: 4 },
            ],
          },
        ],
      },
    ],
    totals: { acts: 1, chapters: 1, scenes: 2, words: 10 },
  } as NovelOutline;
}

function makeScene(id = "scene-1", content = "Mara reached the quay at dawn.") {
  return {
    id,
    title: id === "scene-1" ? "The Quay" : "Storm",
    content,
    summary: null,
    label: null,
    pov: "THIRD_LIMITED",
    tense: "PAST",
    excludeFromAi: false,
    wordCount: 6,
    updatedAt: "2026-10-08T00:00:00.000Z",
    chapterId: "chapter-1",
    chapterTitle: "Chapter One",
    actTitle: "Act I",
    novelId: "novel-1",
    novelTitle: "Storm Tide",
  };
}

type Handler = (url: string, init: any) => { status: number; body: unknown } | undefined;

function routeFetch(handler: Handler) {
  const fn = vi.fn(async (url: string, init: any = {}) => {
    const r = handler(url, init) ?? { status: 200, body: {} };
    return {
      ok: r.status < 300,
      status: r.status,
      text: async () => (r.body === undefined ? "" : JSON.stringify(r.body)),
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("WritingWorkspace", () => {
  it("loads the initial scene, scans mentions and toggles the AI drawer", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = routeFetch((url) => {
      if (url === "/api/scenes/scene-1") return { status: 200, body: { scene: makeScene() } };
      if (url === "/api/codex/mentions")
        return { status: 200, body: { matchedEntryIds: [], matches: [] } };
      return undefined;
    });
    render(
      React.createElement(WritingWorkspace, { outline: makeOutline(), initialSceneId: "scene-1" }),
    );
    await screen.findByTestId("scene-editor");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(fetchMock.mock.calls.some((c) => c[0] === "/api/codex/mentions")).toBe(true);

    fireEvent.click(screen.getByText("AI Assistant", { selector: "button" }));
    expect(screen.getByTestId("ai-assistant-drawer")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close AI assistant drawer"));
    expect(screen.queryByTestId("ai-assistant-drawer")).toBeNull();
    fireEvent.click(screen.getByText("AI Assistant", { selector: "button" }));
    fireEvent.click(screen.getByText("AI Assistant", { selector: "button" }));
  });

  it("scans empty prose locally and clears detection on scan errors", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let mentionCalls = 0;
    routeFetch((url) => {
      if (url === "/api/scenes/scene-1")
        return { status: 200, body: { scene: makeScene("scene-1", "  ") } };
      if (url === "/api/scenes/scene-2")
        return { status: 200, body: { scene: makeScene("scene-2", "Rain fell.") } };
      if (url === "/api/codex/mentions") {
        mentionCalls++;
        return { status: 500, body: { error: "scan failed" } };
      }
      return undefined;
    });
    render(
      React.createElement(WritingWorkspace, { outline: makeOutline(), initialSceneId: "scene-1" }),
    );
    await screen.findByTestId("scene-editor");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(mentionCalls).toBe(0);
    fireEvent.click(screen.getByTestId("scene-link-scene-2"));
    await screen.findByDisplayValue("Rain fell.");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1300);
    });
    expect(mentionCalls).toBe(1);
  });

  it("shows scene load errors and the empty state", async () => {
    routeFetch((url) => {
      if (url === "/api/scenes/scene-1") return { status: 404, body: { error: "Scene not found" } };
      return undefined;
    });
    render(
      React.createElement(WritingWorkspace, { outline: makeOutline(), initialSceneId: "scene-1" }),
    );
    expect(await screen.findByText("Scene not found")).toBeTruthy();
    cleanup();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.reject(new TypeError("x"))),
    );
    const empty = makeOutline();
    empty.acts = [];
    render(React.createElement(WritingWorkspace, { outline: empty, initialSceneId: null }));
    expect(screen.getByText("No scene selected")).toBeTruthy();
    fireEvent.click(screen.getAllByText("Create first act")[1]);
    expect(await screen.findByText(/Network error/)).toBeTruthy();
  });

  it("creates, renames, moves and deletes outline nodes", async () => {
    const outline = makeOutline();
    const calls: Array<[string, string, any]> = [];
    routeFetch((url, init) => {
      calls.push([init.method, url, init.body ? JSON.parse(init.body) : null]);
      if (url === "/api/novels/novel-1/outline" && init.method === "GET")
        return { status: 200, body: { outline } };
      if (url === "/api/novels/novel-1/outline" && init.method === "POST") {
        const body = JSON.parse(init.body);
        return {
          status: 200,
          body: { kind: body.kind, node: { id: body.kind === "scene" ? "scene-2" : "x" } },
        };
      }
      if (url.startsWith("/api/scenes/scene-2"))
        return { status: 200, body: { scene: makeScene("scene-2", "") } };
      if (url.startsWith("/api/novels/novel-1/outline")) return { status: 200, body: { ok: true } };
      return undefined;
    });
    render(React.createElement(WritingWorkspace, { outline, initialSceneId: null }));

    fireEvent.click(screen.getByText("+ Act"));
    await waitFor(() =>
      expect(calls.some((c) => c[0] === "POST" && c[2].kind === "act")).toBe(true),
    );
    fireEvent.click(screen.getAllByTitle("Add scene")[0]);
    expect(await screen.findByTestId("scene-editor")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Rename Storm"));
    const input = screen.getAllByDisplayValue("Storm")[0];
    fireEvent.change(input, { target: { value: "Squall" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(calls.some((c) => c[0] === "PATCH" && c[2]?.title === "Squall")).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Rename Act I")).not.toHaveProperty("disabled", true),
    );

    fireEvent.click(screen.getByLabelText("Move Act I down"));
    await waitFor(() =>
      expect(calls.some((c) => c[0] === "PATCH" && c[2]?.direction === "down")).toBe(true),
    );

    (window.confirm as any).mockReturnValueOnce(false);
    await waitFor(() =>
      expect((screen.getByLabelText("Delete Act I") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByLabelText("Delete Act I"));
    expect(calls.some((c) => c[0] === "DELETE")).toBe(false);

    fireEvent.click(screen.getByLabelText("Delete Chapter One"));
    await waitFor(() => expect(calls.some((c) => c[1].includes("kind=chapter"))).toBe(true));
    await waitFor(() =>
      expect((screen.getByLabelText("Delete Storm") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByLabelText("Delete Storm"));
    await waitFor(() =>
      expect(calls.some((c) => c[1].includes("kind=scene&nodeId=scene-2"))).toBe(true),
    );
    expect(await screen.findByText("No scene selected")).toBeTruthy();
  });

  it("closes the open scene when its act is deleted", async () => {
    const outline = makeOutline();
    routeFetch((url, init) => {
      if (url === "/api/scenes/scene-1") return { status: 200, body: { scene: makeScene() } };
      if (url === "/api/novels/novel-1/outline" && init.method === "GET")
        return { status: 200, body: { outline: { ...outline, acts: [] } } };
      if (url.startsWith("/api/novels/novel-1/outline")) return { status: 200, body: { ok: true } };
      return undefined;
    });
    render(React.createElement(WritingWorkspace, { outline, initialSceneId: "scene-1" }));
    await screen.findByTestId("scene-editor");
    fireEvent.click(screen.getByLabelText("Delete Act I"));
    expect(await screen.findByText("No scene selected")).toBeTruthy();
    expect(screen.queryByTestId("scene-editor")).toBeNull();
  });

  it("keeps the open scene when an unrelated chapter is deleted", async () => {
    const outline = makeOutline();
    outline.acts[0].chapters.push({
      id: "chapter-2",
      title: "Chapter Two",
      position: 1,
      scenes: [],
    });
    routeFetch((url, init) => {
      if (url === "/api/scenes/scene-1") return { status: 200, body: { scene: makeScene() } };
      if (url === "/api/novels/novel-1/outline" && init.method === "GET")
        return { status: 200, body: { outline } };
      if (url.startsWith("/api/novels/novel-1/outline")) return { status: 200, body: { ok: true } };
      return undefined;
    });
    render(React.createElement(WritingWorkspace, { outline, initialSceneId: "scene-1" }));
    await screen.findByTestId("scene-editor");
    fireEvent.click(screen.getByLabelText("Delete Chapter Two"));
    await waitFor(() =>
      expect((screen.getByLabelText("Delete Chapter One") as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect(screen.getByTestId("scene-editor")).toBeTruthy();
  });

  it("reports failures for outline mutations", async () => {
    routeFetch((url, init) => {
      if (init.method === "GET") return { status: 200, body: { outline: makeOutline() } };
      return { status: 409, body: { error: `nope ${init.method}` } };
    });
    render(React.createElement(WritingWorkspace, { outline: makeOutline(), initialSceneId: null }));
    fireEvent.click(screen.getByLabelText("Move Storm up"));
    expect(await screen.findByText("nope PATCH")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Delete Storm"));
    expect(await screen.findByText("nope DELETE")).toBeTruthy();
    fireEvent.click(screen.getByText("+ Act"));
    expect(await screen.findByText("nope POST")).toBeTruthy();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" }),
    );
    fireEvent.click(screen.getByLabelText("Rename The Quay"));
    const input = screen.getByDisplayValue("The Quay");
    fireEvent.change(input, { target: { value: "Dock" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(await screen.findByText("Failed to rename")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Move Storm down"));
    expect(await screen.findByText("Failed to move")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Delete Act I"));
    expect(await screen.findByText("Failed to delete")).toBeTruthy();
    fireEvent.click(screen.getByText("+ Act"));
    expect(await screen.findByText("Failed to create node")).toBeTruthy();
  });

  it("rolls saved word counts into the outline and appends AI text", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routeFetch((url, init) => {
      if (url === "/api/scenes/scene-1" && init.method === "GET")
        return { status: 200, body: { scene: makeScene() } };
      if (url === "/api/scenes/scene-1" && init.method === "PATCH")
        return {
          status: 200,
          body: { scene: { ...makeScene(), title: "Dockside", wordCount: 100 } },
        };
      if (url === "/api/ai/generate")
        return { status: 200, body: { text: "The tide turned.", model: "m1" } };
      return { status: 200, body: { matchedEntryIds: [], matches: [] } };
    });
    render(
      React.createElement(WritingWorkspace, { outline: makeOutline(), initialSceneId: "scene-1" }),
    );
    await screen.findByTestId("scene-editor");
    fireEvent.change(screen.getByLabelText("Scene title"), { target: { value: "Dockside" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    await waitFor(() => expect(screen.getByText(/104 words/)).toBeTruthy());

    fireEvent.click(screen.getByText("AI Assistant", { selector: "button" }));
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-result");
    fireEvent.click(screen.getByText("Append to scene"));
    expect((screen.getByLabelText("Scene text") as HTMLTextAreaElement).value).toContain(
      "The tide turned.",
    );
  });

  it("ignores stale loadScene responses when selection changed", async () => {
    let resolveScene1!: () => void;
    let resolveScene2!: () => void;

    const fn = vi.fn((url: string) => {
      if (url === "/api/scenes/scene-1") {
        return new Promise((resolve) => {
          resolveScene1 = () =>
            resolve({
              ok: true,
              status: 200,
              text: async () => JSON.stringify({ scene: makeScene("scene-1", "Prose One") }),
            });
        });
      }
      if (url === "/api/scenes/scene-2") {
        return new Promise((resolve) => {
          resolveScene2 = () =>
            resolve({
              ok: true,
              status: 200,
              text: async () => JSON.stringify({ scene: makeScene("scene-2", "Prose Two") }),
            });
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ matchedEntryIds: [], matches: [] }),
      });
    });
    vi.stubGlobal("fetch", fn);

    render(React.createElement(WritingWorkspace, { outline: makeOutline(), initialSceneId: null }));

    fireEvent.click(screen.getByTestId("scene-link-scene-1"));
    fireEvent.click(screen.getByTestId("scene-link-scene-2"));

    await act(async () => {
      resolveScene2();
    });

    expect(await screen.findByDisplayValue("Prose Two")).toBeTruthy();

    await act(async () => {
      resolveScene1();
    });

    expect(screen.getByDisplayValue("Prose Two")).toBeTruthy();
    expect(screen.queryByDisplayValue("Prose One")).toBeNull();
  });
});

describe("AiAssistantDrawer", () => {
  function setup() {
    const props = { sceneId: "scene-1", content: "", onClose: vi.fn(), onInsertText: vi.fn() };
    render(React.createElement(AiAssistantDrawer, props));
    return props;
  }

  it("generates, copies and inserts text", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const fetchMock = routeFetch(() => ({ status: 200, body: { text: "Out", model: "m" } }));
    const p = setup();
    fireEvent.click(screen.getByText("Expand beat"));
    expect(screen.getByText("Beat to expand")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Mara confronts/), { target: { value: "beat" } });
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-result");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      sceneId: "scene-1",
      mode: "beat_expansion",
      beatText: "beat",
      content: "",
    });
    fireEvent.click(screen.getByText("Copy"));
    expect(await screen.findByText("Copied")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(screen.getByText("Copy")).toBeTruthy();
    fireEvent.click(screen.getByText("Append to scene"));
    expect(p.onInsertText).toHaveBeenCalledWith("Out");
    fireEvent.click(screen.getByText("Continue scene"));
    expect(screen.getByText("Beat hint (optional)")).toBeTruthy();
  });

  it("falls back to the prompt builder when AI is not configured", async () => {
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    routeFetch(() => ({
      status: 503,
      body: {
        error: "AI not configured",
        code: "AI_NOT_CONFIGURED",
        prompt: { system: "SYS", user: "USR" },
      },
    }));
    setup();
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-not-configured");
    expect(screen.getByText("SYS")).toBeTruthy();
    fireEvent.click(screen.getAllByText("Copy")[0]);
    expect(await screen.findByText(/Copy failed/)).toBeTruthy();
  });

  it("handles prompt-less 503s, other API errors and unknown failures", async () => {
    routeFetch(() => ({ status: 503, body: { error: "AI off", code: "AI_NOT_CONFIGURED" } }));
    const p = setup();
    fireEvent.click(screen.getByText("Generate"));
    await screen.findByTestId("ai-not-configured");

    routeFetch(() => ({ status: 429, body: { error: "Rate limited" } }));
    fireEvent.click(screen.getByText("Generate"));
    expect(await screen.findByText("Rate limited")).toBeTruthy();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "null" }),
    );
    fireEvent.click(screen.getByText("Generate"));
    expect(await screen.findByText("Generation failed")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close AI assistant drawer"));
    expect(p.onClose).toHaveBeenCalled();
  });
});
