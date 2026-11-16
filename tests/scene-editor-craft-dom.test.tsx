// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SceneEditor } from "../src/app/dashboard/novels/[id]/_components/SceneEditor";

type Range = { from: number; to: number; text: string };

/** Fake editor handle state shared with the mocked RichTextEditor. */
const fake = {
  matches: vi.fn((_r: Range) => true),
  replace: vi.fn((_r: Range, _t: string) => true),
  ready: true,
};

vi.mock("../src/app/dashboard/novels/[id]/_components/RichTextEditor", async () => {
  const React = await import("react");
  return {
    RichTextEditor: (props: {
      plainContent: string;
      onChange: (next: { content: string; contentDoc: unknown }) => void;
      onSelectionChange?: (s: Range | null) => void;
      onReady?: (h: unknown) => void;
    }) => {
      const propsRef = React.useRef(props);
      propsRef.current = props;
      React.useEffect(() => {
        if (!fake.ready) return;
        props.onReady?.({
          getSelection: () => null,
          matches: (r: Range) => fake.matches(r),
          replaceRange: (r: Range, t: string) => {
            const ok = fake.replace(r, t);
            if (ok) {
              const next = propsRef.current.plainContent.replace(r.text, t);
              propsRef.current.onChange({
                content: next,
                contentDoc: {
                  type: "doc",
                  content: [{ type: "paragraph", content: [{ type: "text", text: next }] }],
                },
              });
            }
            return ok;
          },
        });
        return () => props.onReady?.(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return React.createElement(
        "div",
        null,
        React.createElement("textarea", {
          "aria-label": "Scene text",
          value: props.plainContent,
          onChange: (e: any) =>
            props.onChange({
              content: e.target.value,
              contentDoc: {
                type: "doc",
                content: [{ type: "paragraph", content: [{ type: "text", text: e.target.value }] }],
              },
            }),
        }),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: () => props.onSelectionChange?.({ from: 1, to: 15, text: "Mara reached" }),
          },
          "select-prose",
        ),
      );
    },
  };
});

vi.mock("../src/app/dashboard/novels/[id]/_components/CraftPanel", async () => {
  const React = await import("react");
  return {
    CraftPanel: (props: {
      selection: Range | null;
      excludeFromAi: boolean;
      content: string;
      onApply: (r: Range, t: string) => Promise<{ ok: boolean; message?: string }>;
      onClose: () => void;
    }) => {
      const [outcome, setOutcome] = React.useState("");
      return React.createElement(
        "div",
        { "data-testid": "craft-panel-mock" },
        React.createElement("p", { "data-testid": "craft-sel" }, props.selection?.text ?? "none"),
        React.createElement("p", { "data-testid": "craft-excluded" }, String(props.excludeFromAi)),
        React.createElement(
          "button",
          {
            type: "button",
            onClick: async () => {
              const res = await props.onApply(
                props.selection ?? { from: 1, to: 15, text: "Mara reached" },
                "Mara stumbled onto",
              );
              setOutcome(res.ok ? "ok" : (res.message ?? ""));
            },
          },
          "apply-now",
        ),
        React.createElement("button", { type: "button", onClick: props.onClose }, "close-craft"),
        React.createElement("p", { "data-testid": "craft-outcome" }, outcome),
      );
    },
  };
});

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
  wordCount: 6,
  updatedAt: "2026-10-08T00:00:00.000Z",
  chapterId: "chapter-1",
  chapterTitle: "Chapter One",
  actTitle: "Act I",
  novelId: "novel-1",
  novelTitle: "Storm Tide",
};

function jsonResponse(status: number, body: unknown) {
  return { ok: status < 300, status, text: async () => JSON.stringify(body) } as Response;
}

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function stubFetch(handler: Handler) {
  const fn = vi.fn(handler);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function defaultHandler(overrides: Partial<Record<string, Handler>> = {}): Handler {
  return (url, init) => {
    const method = init?.method ?? "GET";
    const key = `${method} ${url}`;
    if (overrides[key]) return overrides[key]!(url, init);
    if (method === "PATCH") return jsonResponse(200, { scene });
    if (key === "POST /api/scenes/scene-1/revisions")
      return jsonResponse(201, { revision: { id: "rev-1" } });
    if (url.startsWith("/api/scenes/scene-1/revisions"))
      return jsonResponse(200, { revisions: [] });
    return jsonResponse(404, { error: "nope" });
  };
}

function setup(extra: Record<string, unknown> = {}) {
  const props = { scene: scene as any, onSaved: vi.fn(), onProseChange: vi.fn(), ...extra };
  return { props, ...render(React.createElement(SceneEditor, props)) };
}

async function clickApply() {
  await act(async () => {
    fireEvent.click(screen.getByText("apply-now"));
    await vi.advanceTimersByTimeAsync(50);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  fake.matches.mockImplementation(() => true);
  fake.replace.mockImplementation(() => true);
  fake.ready = true;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

const sceneText = () => (screen.getByLabelText("Scene text") as HTMLTextAreaElement).value;

describe("SceneEditor Craft integration (STO-1290)", () => {
  it("toggles the Craft panel in focus chrome and forwards the live selection", () => {
    stubFetch(defaultHandler());
    setup({ chrome: "focus" });
    expect(screen.queryByText("History")).toBeNull();
    fireEvent.click(screen.getByText("Craft"));
    expect(screen.getByTestId("craft-sel").textContent).toBe("none");
    fireEvent.click(screen.getByText("select-prose"));
    expect(screen.getByTestId("craft-sel").textContent).toBe("Mara reached");
    expect(screen.getByTestId("craft-excluded").textContent).toBe("false");
    fireEvent.click(screen.getByText("Hide craft"));
    expect(screen.queryByTestId("craft-panel-mock")).toBeNull();
    fireEvent.click(screen.getByText("Craft"));
    fireEvent.click(screen.getByText("close-craft"));
    expect(screen.queryByTestId("craft-panel-mock")).toBeNull();
  });

  it("checkpoints before replacing and refreshes open history", async () => {
    const fetchMock = stubFetch(defaultHandler());
    setup();
    fireEvent.click(screen.getByText("History"));
    fireEvent.click(screen.getByText("Craft"));
    fireEvent.click(screen.getByText("select-prose"));
    await clickApply();
    expect(screen.getByTestId("craft-outcome").textContent).toBe("ok");
    const calls = fetchMock.mock.calls.map(([u, i]) => `${i?.method ?? "GET"} ${u}`);
    const checkpoint = calls.indexOf("POST /api/scenes/scene-1/revisions");
    expect(checkpoint).toBeGreaterThan(-1);
    expect(calls.slice(checkpoint + 1)).toContain("GET /api/scenes/scene-1/revisions?limit=20");
    expect(fake.replace).toHaveBeenCalledWith(
      { from: 1, to: 15, text: "Mara reached" },
      "Mara stumbled onto",
    );
    expect(sceneText()).toBe("Mara stumbled onto the quay at dawn.");
    expect(screen.getByTestId("craft-sel").textContent).toBe("none");

    // The replacement autosaves like any other edit.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    const patch = fetchMock.mock.calls.find(([, i]) => i?.method === "PATCH");
    expect(JSON.parse(patch![1]!.body as string).content).toBe(
      "Mara stumbled onto the quay at dawn.",
    );
  });

  it("flushes unsaved edits (as MANUAL) before the checkpoint", async () => {
    const order: string[] = [];
    const fetchMock = stubFetch((url, init) => {
      order.push(`${init?.method ?? "GET"} ${url}`);
      return defaultHandler()(url, init);
    });
    setup();
    fireEvent.change(screen.getByLabelText("Scene text"), {
      target: { value: "Mara reached the quay at dusk." },
    });
    fireEvent.click(screen.getByText("Craft"));
    await clickApply();
    expect(screen.getByTestId("craft-outcome").textContent).toBe("ok");
    expect(order.slice(0, 2)).toEqual([
      "PATCH /api/scenes/scene-1",
      "POST /api/scenes/scene-1/revisions",
    ]);
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.content).toBe("Mara reached the quay at dusk.");
    expect(body.revisionReason).toBe("MANUAL");
  });

  it("waits for an in-flight autosave before checkpointing", async () => {
    let releasePatch!: () => void;
    const order: string[] = [];
    stubFetch((url, init) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      order.push(key);
      if (init?.method === "PATCH" && order.filter((k) => k.startsWith("PATCH")).length === 1) {
        return new Promise<Response>((resolve) => {
          releasePatch = () => resolve(jsonResponse(200, { scene }));
        });
      }
      return defaultHandler()(url, init);
    });
    setup();
    fireEvent.change(screen.getByLabelText("Scene text"), {
      target: { value: "Mara reached the quay late." },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900); // autosave starts and hangs
    });
    fireEvent.click(screen.getByText("Craft"));
    await act(async () => {
      fireEvent.click(screen.getByText("apply-now"));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(order).not.toContain("POST /api/scenes/scene-1/revisions");
    await act(async () => {
      releasePatch();
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByTestId("craft-outcome").textContent).toBe("ok");
    expect(order.indexOf("POST /api/scenes/scene-1/revisions")).toBeGreaterThan(
      order.indexOf("PATCH /api/scenes/scene-1"),
    );
  });

  it("refuses without a checkpoint when the passage changed", async () => {
    const fetchMock = stubFetch(defaultHandler());
    fake.matches.mockImplementation(() => false);
    setup();
    fireEvent.click(screen.getByText("Craft"));
    await clickApply();
    expect(screen.getByTestId("craft-outcome").textContent).toContain("changed since the tool ran");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a passage edited during the checkpoint", async () => {
    stubFetch(defaultHandler());
    fake.replace.mockImplementation(() => false);
    setup();
    fireEvent.click(screen.getByText("Craft"));
    await clickApply();
    expect(screen.getByTestId("craft-outcome").textContent).toContain("changed since the tool ran");
    expect(sceneText()).toBe("Mara reached the quay at dawn.");
  });

  it("does not replace when saving or checkpointing fails", async () => {
    stubFetch(
      defaultHandler({
        "PATCH /api/scenes/scene-1": () => jsonResponse(500, { error: "DB down" }),
      }),
    );
    setup();
    fireEvent.change(screen.getByLabelText("Scene text"), {
      target: { value: "Mara reached it." },
    });
    fireEvent.click(screen.getByText("Craft"));
    await clickApply();
    expect(screen.getByTestId("craft-outcome").textContent).toContain("could not be saved");
    expect(fake.replace).not.toHaveBeenCalled();
    cleanup();

    stubFetch(
      defaultHandler({
        "POST /api/scenes/scene-1/revisions": () => jsonResponse(404, { error: "Scene not found" }),
      }),
    );
    setup();
    fireEvent.click(screen.getByText("Craft"));
    await clickApply();
    expect(screen.getByTestId("craft-outcome").textContent).toBe(
      "Checkpoint failed, so nothing was replaced: Scene not found",
    );
    cleanup();

    stubFetch(() => Promise.reject(new TypeError("offline")));
    setup();
    fireEvent.click(screen.getByText("Craft"));
    await clickApply();
    expect(screen.getByTestId("craft-outcome").textContent).toContain("Checkpoint failed");
    expect(fake.replace).not.toHaveBeenCalled();
  });

  it("explains when the editor is not ready", async () => {
    fake.ready = false;
    stubFetch(defaultHandler());
    setup();
    fireEvent.click(screen.getByText("Craft"));
    await clickApply();
    expect(screen.getByTestId("craft-outcome").textContent).toBe("The editor is not ready yet.");
  });
});
