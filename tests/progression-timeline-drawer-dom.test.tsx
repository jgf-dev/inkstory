// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ProgressionTimelineDrawer } from "../src/app/dashboard/novels/[id]/_components/ProgressionTimelineDrawer";
import type { NovelOutline } from "../src/lib/writing/service";
import * as api from "../src/app/dashboard/novels/[id]/_components/api";

vi.mock("../src/app/dashboard/novels/[id]/_components/api", () => ({
  apiGet: vi.fn(),
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

describe("ProgressionTimelineDrawer (JGF-128)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads progressions, highlights the open scene, and dims the future", async () => {
    (api.apiGet as any).mockImplementation(async (url: string) => {
      if (url.includes("/api/codex/entries?")) {
        return { entries: [{ id: "a", name: "Mara Vance" }] };
      }
      if (url.includes("/api/codex/entries/a")) {
        return {
          entry: {
            id: "a",
            name: "Mara Vance",
            progressions: [
              {
                id: "p-past",
                sceneId: "scene-1",
                mode: "ADDITION",
                description: "Mara gains a scar",
                notes: "from the quay fight",
              },
              {
                id: "p-future",
                sceneId: "scene-2",
                mode: "REPLACEMENT",
                description: "Mara replaces her old vow",
              },
              {
                id: "p-other-novel",
                sceneId: "scene-other",
                mode: "ADDITION",
                description: "ignored",
              },
            ],
          },
        };
      }
      throw new Error(`unexpected ${url}`);
    });

    const onClose = vi.fn();
    render(
      React.createElement(ProgressionTimelineDrawer, {
        isOpen: true,
        novelId: "novel-1",
        outline: makeOutline(),
        currentSceneId: "scene-1",
        onClose,
      }),
    );

    expect(await screen.findByTestId("progression-card-p-past")).toBeTruthy();
    expect(screen.getByTestId("progression-card-p-future")).toBeTruthy();
    expect(screen.queryByTestId("progression-card-p-other-novel")).toBeNull();

    const past = screen.getByTestId("progression-card-p-past");
    const future = screen.getByTestId("progression-card-p-future");
    expect(past.getAttribute("aria-current")).toBe("true");
    expect(future.className).toContain("opacity-55");
    expect(past.textContent).toContain("from the quay fight");
    expect(future.textContent).toContain("REPLACEMENT");

    fireEvent.change(screen.getByTestId("progression-slider"), { target: { value: "1" } });
    expect(screen.getByTestId("progression-coordinate").textContent).toContain("Storm");
    expect(future.getAttribute("aria-current")).toBe("true");

    fireEvent.click(screen.getByLabelText("Close progression timeline"));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows the empty state when no progressions exist", async () => {
    (api.apiGet as any).mockResolvedValue({ entries: [] });
    render(
      React.createElement(ProgressionTimelineDrawer, {
        isOpen: true,
        novelId: "novel-1",
        outline: makeOutline(),
        onClose: vi.fn(),
      }),
    );
    expect(await screen.findByText(/No progressions yet/)).toBeTruthy();
  });

  it("surfaces load errors with a retry path", async () => {
    (api.apiGet as any)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ entries: [] });

    render(
      React.createElement(ProgressionTimelineDrawer, {
        isOpen: true,
        novelId: "novel-1",
        outline: makeOutline(),
        onClose: vi.fn(),
      }),
    );

    expect((await screen.findByRole("alert")).textContent).toContain("network down");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(/No progressions yet/)).toBeTruthy();
  });

  it("closes when the backdrop is clicked", async () => {
    (api.apiGet as any).mockResolvedValue({ entries: [] });
    const onClose = vi.fn();
    render(
      React.createElement(ProgressionTimelineDrawer, {
        isOpen: true,
        novelId: "novel-1",
        outline: makeOutline(),
        onClose,
      }),
    );
    await screen.findByText(/No progressions yet/);
    fireEvent.click(screen.getByTestId("progression-timeline-drawer"));
    expect(onClose).toHaveBeenCalled();
  });

  it("tolerates individual entry detail failures", async () => {
    (api.apiGet as any).mockImplementation(async (url: string) => {
      if (url.includes("/api/codex/entries?")) {
        return {
          entries: [
            { id: "a", name: "Mara" },
            { id: "b", name: "Qhu" },
          ],
        };
      }
      if (url.includes("/api/codex/entries/a")) {
        throw new Error("detail boom");
      }
      if (url.includes("/api/codex/entries/b")) {
        return {
          entry: {
            id: "b",
            name: "Qhu",
            progressions: [{ id: "p1", sceneId: "scene-1", mode: "ADDITION", description: "ok" }],
          },
        };
      }
      throw new Error(url);
    });
    render(
      React.createElement(ProgressionTimelineDrawer, {
        isOpen: true,
        novelId: "novel-1",
        outline: makeOutline(),
        onClose: vi.fn(),
      }),
    );
    expect(await screen.findByTestId("progression-card-p1")).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    render(
      React.createElement(ProgressionTimelineDrawer, {
        isOpen: false,
        novelId: "novel-1",
        outline: makeOutline(),
        onClose: vi.fn(),
      }),
    );
    expect(screen.queryByTestId("progression-timeline-drawer")).toBeNull();
  });
});
