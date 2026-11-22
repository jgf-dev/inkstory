// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ContextInspectorDrawer } from "../src/app/dashboard/novels/[id]/_components/ContextInspectorDrawer";
import { inspectAssembledContext } from "../src/lib/codex/context-inspection";
import type { AssembledContext } from "../src/lib/codex/context-assembler";

function fixture(): AssembledContext {
  return {
    entries: [
      {
        id: "a",
        name: "Mara",
        type: "CHARACTER",
        aliases: ["Captain"],
        description: "Resolved description.",
        source: "always",
        trackingMode: "always",
        appliedProgressionIds: ["p"],
      },
      {
        id: "r",
        name: "Quay",
        type: "LOCATION",
        aliases: [],
        description: "",
        source: "relation",
        relationDepth: 2,
        trackingMode: "detected",
        appliedProgressionIds: [],
      },
    ],
    meta: { sceneId: "scene-1", finalCount: 2, totalCandidates: 3, truncated: true },
  };
}
const props = {
  sceneId: "scene-1",
  recentProse: "Mara arrived.",
  beatText: "A meeting",
  onClose: vi.fn(),
};
const response = (body: unknown, status = 200) =>
  ({ ok: status === 200, status, text: async () => JSON.stringify(body) }) as Response;
function mockFetch(body: unknown = inspectAssembledContext(fixture(), 4000)) {
  const fn = vi.fn().mockResolvedValue(response(body));
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Context Inspector", () => {
  it("loads only the inspection API, displays source stack and post-progression context, and refreshes", async () => {
    const fn = mockFetch();
    render(React.createElement(ContextInspectorDrawer, props));
    expect(screen.getByRole("status").textContent).toBe("Assembling context…");
    await screen.findByText("Resolved description.");
    expect(fn).toHaveBeenCalledWith(
      "/api/context/assemble",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sceneId: props.sceneId,
          recentProse: props.recentProse,
          beatText: props.beatText,
        }),
      }),
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(
      /Manual: 0 tokens, Always: \d+ tokens, Mention: 0 tokens, Relation: \d+ tokens, XML wrapper: \d+ tokens/,
    );
    expect(screen.getByText("Depth 2")).toBeTruthy();
    expect(screen.getByText("1 progressions applied")).toBeTruthy();
    expect(screen.getByText("Aliases: Captain")).toBeTruthy();
    expect(screen.getByText("No description.")).toBeTruthy();
    expect(screen.getByText(/Assembly entry limit reached/)).toBeTruthy();
    expect(screen.getByText(/<codex_context>/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByText("Refresh context"));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    await screen.findByText("Resolved description.");
  });

  it("shows budget drops/truncation and never displays the unbudgeted description", async () => {
    const input = fixture();
    input.entries[0].description = "Long ".repeat(1000);
    const result = inspectAssembledContext(input, 200);
    mockFetch(result);
    render(React.createElement(ContextInspectorDrawer, props));
    await screen.findByText("Shortened to fit");
    expect(
      screen.getByText(/Token budget: 1 entries dropped; 1 descriptions shortened/),
    ).toBeTruthy();
    expect(screen.queryByText(input.entries[0].description)).toBeNull();
    expect(screen.getByRole("region", { name: "Assembled entries" }).textContent).not.toContain(
      "Quay",
    );
  });

  it("handles empty context with zero-valued sources and wrapper tokens", async () => {
    mockFetch(
      inspectAssembledContext(
        {
          entries: [],
          meta: { sceneId: "scene-1", totalCandidates: 0, finalCount: 0, truncated: false },
        },
        4000,
      ),
    );
    render(
      React.createElement(ContextInspectorDrawer, { ...props, recentProse: "", beatText: "" }),
    );
    await screen.findByText("No Codex entries in this context.");
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Relation: 0 tokens");
  });

  it("shows API errors and lets the author retry", async () => {
    const fn = mockFetch();
    fn.mockResolvedValueOnce(response({ error: "Unauthorized to access this scene" }, 403));
    render(React.createElement(ContextInspectorDrawer, props));
    expect((await screen.findByRole("alert")).textContent).toContain("Unauthorized");
    fireEvent.click(screen.getByText("Refresh context"));
    await screen.findByText("Resolved description.");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows network failures", async () => {
    mockFetch().mockRejectedValue(new Error("offline"));
    render(React.createElement(ContextInspectorDrawer, props));
    expect((await screen.findByRole("alert")).textContent).toContain("offline");
  });

  it("ignores stale requests on scene/prose changes and unmount", async () => {
    let finishOld!: (response: Response) => void;
    const fn = mockFetch();
    fn.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishOld = resolve;
        }),
    );
    const view = render(React.createElement(ContextInspectorDrawer, props));
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    const newer = fixture();
    newer.entries[0].description = "New scene description.";
    fn.mockResolvedValue(response(inspectAssembledContext(newer, 4000)));
    view.rerender(
      React.createElement(ContextInspectorDrawer, {
        ...props,
        sceneId: "scene-2",
        recentProse: "New prose",
      }),
    );
    await screen.findByText("New scene description.");
    await act(async () => {
      finishOld(response(inspectAssembledContext(fixture(), 4000)));
    });
    expect(screen.queryByText("Resolved description.")).toBeNull();
    view.unmount();
  });

  it("manages focus, traps Tab, supports Escape, close and backdrop, then restores focus", async () => {
    mockFetch();
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    const view = render(React.createElement(ContextInspectorDrawer, props));
    const close = screen.getByLabelText("Close context inspector");
    expect(document.activeElement).toBe(close);
    await screen.findByText("Resolved description.");
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    const summary = screen.getByText("Formatted Codex context");
    expect(document.activeElement).toBe(summary);
    fireEvent.keyDown(summary, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "a" });
    fireEvent.keyDown(close, { key: "Escape" });
    fireEvent.click(close);
    fireEvent.click(screen.getByRole("dialog"));
    expect(props.onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByTestId("context-inspector-backdrop"));
    expect(props.onClose).toHaveBeenCalledTimes(3);
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
