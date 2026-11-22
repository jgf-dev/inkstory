// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ThemeToggle } from "../src/app/_components/ThemeToggle";
import { ModeSwitcher } from "../src/app/dashboard/novels/[id]/_components/ModeSwitcher";
import { ProseFontToggle } from "../src/app/dashboard/novels/[id]/_components/ProseFontToggle";
import { StageConsolePanel } from "../src/app/dashboard/novels/[id]/_components/StageConsolePanel";
import { StatusPill } from "../src/app/dashboard/novels/[id]/_components/StatusPill";
import { ArchitectRail } from "../src/app/dashboard/novels/[id]/_components/ArchitectRail";
import { MentionsPanel } from "../src/app/dashboard/novels/[id]/_components/MentionsPanel";
import type { CodexBudgetData } from "../src/app/dashboard/novels/[id]/_components/useCodexBudget";
import { THEME_STORAGE_KEY, PROSE_FONT_STORAGE_KEY } from "../src/lib/ui/preferences";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.proseFont;
});

describe("ModeSwitcher / StatusPill / ThemeToggle / ProseFontToggle (JGF-128)", () => {
  it("switches workspace modes via aria-pressed buttons", () => {
    const onChange = vi.fn();
    render(React.createElement(ModeSwitcher, { mode: "writer", onChange }));
    fireEvent.click(screen.getByTestId("mode-stage"));
    expect(onChange).toHaveBeenCalledWith("stage");
    fireEvent.click(screen.getByTestId("mode-architect"));
    expect(onChange).toHaveBeenCalledWith("architect");
  });

  it("renders the writer status pill with word count and save state", () => {
    render(React.createElement(StatusPill, { words: 1234, saveState: "error" }));
    const pill = screen.getByTestId("writer-status-pill");
    expect(pill.textContent).toContain("1,234");
    expect(pill.textContent).toContain("Save failed");
  });

  it("toggles the theme and persists it", async () => {
    document.documentElement.dataset.theme = "light";
    render(React.createElement(ThemeToggle));
    const button = await screen.findByTestId("theme-toggle");
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("false"));
    fireEvent.click(button);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    fireEvent.click(button);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("toggles the prose font and persists it", async () => {
    render(React.createElement(ProseFontToggle));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Serif/ }).getAttribute("aria-pressed")).toBe(
        "true",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: /Sans/ }));
    expect(window.localStorage.getItem(PROSE_FONT_STORAGE_KEY)).toBe("sans");
    expect(document.documentElement.dataset.proseFont).toBe("sans");
  });
});

describe("StageConsolePanel (JGF-128)", () => {
  it("runs fixture beats and inserts them into the scene", () => {
    const onInsertBeat = vi.fn();
    render(React.createElement(StageConsolePanel, { onInsertBeat }));
    expect(screen.getByText("No rehearsal yet")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Run rehearsal" }));
    expect(screen.getByTestId("stage-transcript")).toBeTruthy();
    expect(screen.getByText(/Mara kept her voice low/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Insert beat into scene" }));
    expect(onInsertBeat).toHaveBeenCalledWith(expect.stringContaining("Mara kept her voice low"));

    fireEvent.click(screen.getByRole("button", { name: "Run next beat" }));
    expect(screen.getByText(/Qhu slid the ledger/)).toBeTruthy();
  });
});

function makeBudget(overrides: Partial<CodexBudgetData> = {}): CodexBudgetData {
  return {
    loading: false,
    error: null,
    segments: [
      { id: "seed", tokens: 100 },
      { id: "mentions", tokens: 0 },
      { id: "relations", tokens: 0 },
      { id: "progressions", tokens: 0 },
    ],
    breakdown: {},
    entries: [
      { id: "a", name: "Mara Vance", type: "CHARACTER", description: "", trackingMode: "ALWAYS" },
      {
        id: "b",
        name: "Harbormaster Qhu",
        type: "CHARACTER",
        description: "",
        trackingMode: "detected",
      },
    ],
    details: new Map([
      [
        "a",
        {
          id: "a",
          name: "Mara Vance",
          progressions: [{ id: "p1", sceneId: "s1", mode: "ADDITION", description: "scar" }],
        },
      ],
    ]),
    ensureDetail: vi.fn(),
    invalidateDetail: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  };
}

describe("ArchitectRail (JGF-128)", () => {
  it("opens the linker for a selected entry and the timeline", () => {
    const onOpenLinker = vi.fn();
    const onOpenTimeline = vi.fn();
    render(
      React.createElement(ArchitectRail, {
        budget: makeBudget(),
        onOpenLinker,
        onOpenTimeline,
      }),
    );

    expect(screen.getByText(/1 progression across mentioned entries/)).toBeTruthy();
    const select = screen.getByTestId("linker-source-select");
    fireEvent.change(select, { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: "Open Relation Linker" }));
    expect(onOpenLinker).toHaveBeenCalledWith({ id: "b", name: "Harbormaster Qhu" });

    fireEvent.click(screen.getByRole("button", { name: "Open Timeline" }));
    expect(onOpenTimeline).toHaveBeenCalled();
  });

  it("shows the empty timeline copy when there are no progressions", () => {
    render(
      React.createElement(ArchitectRail, {
        budget: makeBudget({ details: new Map() }),
        onOpenLinker: vi.fn(),
        onOpenTimeline: vi.fn(),
      }),
    );
    expect(screen.getByText("Scene-level overrides in reading order.")).toBeTruthy();
  });
});

describe("MentionsPanel link-from-mention (JGF-128)", () => {
  it("groups matches, prefers name labels, and opens the linker", () => {
    const onLinkRelation = vi.fn();
    render(
      React.createElement(MentionsPanel, {
        scanning: false,
        onLinkRelation,
        detection: {
          matchedEntryIds: ["a", "b"],
          matches: [
            {
              entryId: "a",
              matchedText: "Mara",
              originalText: "Mara",
              matchType: "alias",
              startIndex: 0,
              endIndex: 4,
            },
            {
              entryId: "a",
              matchedText: "Mara Vance",
              originalText: "Mara Vance",
              matchType: "name",
              startIndex: 10,
              endIndex: 20,
            },
            {
              entryId: "b",
              matchedText: "Qhu",
              originalText: "Qhu",
              matchType: "name",
              startIndex: 30,
              endIndex: 33,
            },
          ],
        },
      }),
    );
    const chip = screen.getByRole("button", { name: /Mara Vance/ });
    expect(chip.textContent).toContain("×2");
    fireEvent.click(chip);
    expect(onLinkRelation).toHaveBeenCalledWith({ id: "a", name: "Mara Vance" });
  });
});
