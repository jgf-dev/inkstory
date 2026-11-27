// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { PlanningGrid } from "../src/app/dashboard/novels/[id]/_components/PlanningGrid";
import type { NovelOutline } from "../src/lib/writing/service";

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
              { id: "scene-1", title: "The Quay", label: "Hook", position: 0, wordCount: 120 },
              { id: "scene-2", title: "Storm", label: null, position: 1, wordCount: 0 },
            ],
          },
          { id: "chapter-2", title: "Chapter Two", position: 1, scenes: [] },
        ],
      },
      { id: "act-2", title: "Act II", position: 1, chapters: [] },
    ],
    totals: { acts: 2, chapters: 2, scenes: 2, words: 120 },
  } as NovelOutline;
}

function setup(overrides: Partial<React.ComponentProps<typeof PlanningGrid>> = {}) {
  const props = {
    outline: makeOutline(),
    selectedSceneId: "scene-1",
    busy: false,
    onSelectScene: vi.fn(),
    onCreateNode: vi.fn(),
    onMoveNode: vi.fn(),
    onReorderNode: vi.fn(),
    ...overrides,
  };
  render(React.createElement(PlanningGrid, props));
  return props;
}

function makeTransfer() {
  const store: Record<string, string> = {};
  return {
    store,
    dataTransfer: {
      effectAllowed: "move",
      dropEffect: "move",
      setData: (type: string, value: string) => {
        store[type] = value;
      },
      getData: (type: string) => store[type] ?? "",
    },
  };
}

function fireDrag(
  kind: "dragStart" | "dragOver" | "drop",
  el: HTMLElement,
  dataTransfer: unknown,
  clientY = 0,
) {
  const ev = createEvent[kind](el);
  Object.defineProperty(ev, "dataTransfer", { value: dataTransfer });
  Object.defineProperty(ev, "clientY", { value: clientY });
  fireEvent(el, ev);
}

function mockRect() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    top: 100,
    height: 40,
    bottom: 140,
    left: 0,
    right: 100,
    width: 100,
    x: 0,
    y: 100,
    toJSON() {},
  } as DOMRect);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PlanningGrid (STO-1257)", () => {
  it("renders acts, chapter columns and numbered scene cards", () => {
    setup();
    expect(screen.getByTestId("grid-act-act-1")).toBeTruthy();
    expect(screen.getByTestId("grid-chapter-chapter-1")).toBeTruthy();
    expect(screen.getByText("Scene 1")).toBeTruthy();
    expect(screen.getByText("Scene 2")).toBeTruthy();
    expect(screen.getByText("Hook")).toBeTruthy();
    expect(screen.getByText("Empty")).toBeTruthy();
    expect(screen.getByText("Empty chapter")).toBeTruthy();
    expect(screen.getByText("No chapters")).toBeTruthy();
    expect(screen.getAllByText(/2 scenes ·/)).toHaveLength(2);
    expect(screen.getByText(/0 scenes ·/)).toBeTruthy();
    const selected = screen.getByText("The Quay").closest("button");
    expect(selected?.getAttribute("aria-current")).toBe("true");
  });

  it("fires select, create and move callbacks and disables edge moves", () => {
    const p = setup();
    fireEvent.click(screen.getByText("Storm"));
    expect(p.onSelectScene).toHaveBeenCalledWith("scene-2");
    fireEvent.click(screen.getByText("+ Act"));
    expect(p.onCreateNode).toHaveBeenCalledWith("act");
    fireEvent.click(screen.getAllByText("+ Chapter")[0]);
    expect(p.onCreateNode).toHaveBeenCalledWith("chapter", "act-1");
    fireEvent.click(screen.getAllByText("+ Scene")[1]);
    expect(p.onCreateNode).toHaveBeenCalledWith("scene", "chapter-2");

    const moveFirstSceneUp = screen.getByLabelText("Move The Quay up") as HTMLButtonElement;
    const moveLastSceneDown = screen.getByLabelText("Move Storm down") as HTMLButtonElement;
    expect(moveFirstSceneUp.disabled).toBe(true);
    expect(moveFirstSceneUp.title).toBe("Already first scene");
    expect(moveLastSceneDown.disabled).toBe(true);
    expect(moveLastSceneDown.title).toBe("Already last scene");
    fireEvent.click(screen.getByLabelText("Move Storm up"));
    expect(p.onMoveNode).toHaveBeenCalledWith("scene", "scene-2", "up");
    fireEvent.click(screen.getByLabelText("Move The Quay down"));
    expect(p.onMoveNode).toHaveBeenCalledWith("scene", "scene-1", "down");

    const moveFirstChapterLeft = screen.getByLabelText(
      "Move Chapter One left",
    ) as HTMLButtonElement;
    const moveLastChapterRight = screen.getByLabelText(
      "Move Chapter Two right",
    ) as HTMLButtonElement;
    expect(moveFirstChapterLeft.disabled).toBe(true);
    expect(moveFirstChapterLeft.title).toBe("Already first chapter");
    expect(moveLastChapterRight.disabled).toBe(true);
    expect(moveLastChapterRight.title).toBe("Already last chapter");
    fireEvent.click(screen.getByLabelText("Move Chapter One right"));
    expect(p.onMoveNode).toHaveBeenCalledWith("chapter", "chapter-1", "down");
    fireEvent.click(screen.getByLabelText("Move Chapter Two left"));
    expect(p.onMoveNode).toHaveBeenCalledWith("chapter", "chapter-2", "up");
  });

  it("shows an empty state that creates the first act", () => {
    const p = setup({ outline: { ...makeOutline(), acts: [] } });
    expect(screen.getByText("Nothing to plan yet")).toBeTruthy();
    fireEvent.click(screen.getByText("Create first act"));
    expect(p.onCreateNode).toHaveBeenCalledWith("act");
  });

  it("reorders scenes within a chapter via drag-and-drop (before and after)", () => {
    const p = setup();
    mockRect();
    const { store, dataTransfer } = makeTransfer();
    const first = screen.getByTestId("grid-scene-scene-1");
    const second = screen.getByTestId("grid-scene-scene-2");
    act(() => fireDrag("dragStart", second, dataTransfer));
    expect(store["application/x-inkstory-grid-scene"]).toContain("scene-2");
    act(() => fireDrag("dragOver", first, dataTransfer, 110));
    expect(first.className).toContain("border-t-2");
    act(() => fireDrag("drop", first, dataTransfer, 110));
    expect(p.onReorderNode).toHaveBeenCalledWith("scene", "scene-2", 0);
    expect(first.className).not.toContain("border-t-2");

    // Drag first scene below second scene ("after" drop hint).
    const afterTransfer = makeTransfer().dataTransfer;
    act(() => fireDrag("dragStart", first, afterTransfer));
    act(() => fireDrag("dragOver", second, afterTransfer, 130));
    expect(second.className).toContain("border-b-2");
    act(() => fireDrag("drop", second, afterTransfer, 130));
    expect(p.onReorderNode).toHaveBeenCalledWith("scene", "scene-1", 1);
    expect(second.className).not.toContain("border-b-2");
  });

  it("ignores cross-chapter drops and clears any stale drop hint on cross-chapter hover", () => {
    const outline = makeOutline();
    outline.acts[0].chapters[1].scenes = [
      { id: "scene-3", title: "Harbor", label: null, position: 0, wordCount: 40 },
    ];
    const p = setup({ outline });
    mockRect();
    const { dataTransfer } = makeTransfer();
    const source = screen.getByTestId("grid-scene-scene-2");
    const sameChapterTarget = screen.getByTestId("grid-scene-scene-1");
    const otherChapterTarget = screen.getByTestId("grid-scene-scene-3");

    act(() => fireDrag("dragStart", source, dataTransfer));
    act(() => fireDrag("dragOver", sameChapterTarget, dataTransfer, 110));
    expect(sameChapterTarget.className).toContain("border-t-2");

    // Hovering a scene in another chapter clears the stale hint and refuses the drop.
    act(() => fireDrag("dragOver", otherChapterTarget, dataTransfer, 110));
    expect(sameChapterTarget.className).not.toContain("border-t-2");
    expect(otherChapterTarget.className).not.toContain("border-t-2");

    act(() => fireDrag("drop", otherChapterTarget, dataTransfer, 110));
    expect(p.onReorderNode).not.toHaveBeenCalled();
  });

  it("ignores no-op drops, self drops and drops without a payload", () => {
    const p = setup();
    mockRect();
    const { dataTransfer } = makeTransfer();
    const first = screen.getByTestId("grid-scene-scene-1");
    const second = screen.getByTestId("grid-scene-scene-2");
    // Dropping scene-1 just above scene-2 keeps it at index 0.
    act(() => fireDrag("dragStart", first, dataTransfer));
    act(() => fireDrag("dragOver", second, dataTransfer, 105));
    expect(second.className).not.toContain("border-t-2");
    act(() => fireDrag("drop", second, dataTransfer, 105));
    // Self drop.
    act(() => fireDrag("dragStart", first, dataTransfer));
    act(() => fireDrag("dragOver", first, dataTransfer, 130));
    act(() => fireDrag("drop", first, dataTransfer, 130));
    // No payload and no in-memory drag state.
    const empty = makeTransfer().dataTransfer;
    act(() => fireDrag("drop", second, empty, 110));
    // Corrupt payload falls back to (empty) in-memory state.
    act(() => fireDrag("drop", second, { ...empty, getData: () => "{not json" }, 110));
    expect(p.onReorderNode).not.toHaveBeenCalled();
  });

  it("does not start drags and annotates disabled buttons while busy", () => {
    setup({ busy: true });
    expect((screen.getByText("+ Act") as HTMLButtonElement).title).toBe("Saving outline changes…");
    expect((screen.getAllByText("+ Chapter")[0] as HTMLButtonElement).title).toBe(
      "Saving outline changes…",
    );
    expect((screen.getAllByText("+ Scene")[0] as HTMLButtonElement).title).toBe(
      "Saving outline changes…",
    );
    expect((screen.getByLabelText("Move Storm up") as HTMLButtonElement).title).toBe(
      "Saving outline changes…",
    );
    const { store, dataTransfer } = makeTransfer();
    const source = screen.getByTestId("grid-scene-scene-2");
    expect(source.getAttribute("draggable")).toBe("false");
    act(() => fireDrag("dragStart", source, dataTransfer));
    expect(store["application/x-inkstory-grid-scene"]).toBeUndefined();
    act(() => {
      fireEvent.dragEnd(source);
    });
  });
});
