// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { RelationLinkerModal } from "../src/app/dashboard/codex/_components/RelationLinkerModal";
import * as actions from "../src/lib/codex/actions";

vi.mock("../src/lib/codex/actions", () => ({
  createCodexRelationAction: vi.fn(),
}));

/** Options of the target-entity listbox (not the predicate select's). */
function listboxOptions() {
  return within(screen.getByRole("listbox")).getAllByRole("option");
}

const ENTRIES = [
  { id: "a", name: "Mara Vance", type: "CHARACTER" },
  { id: "b", name: "Harbormaster Qhu", type: "CHARACTER" },
  { id: "c", name: "Sunken Archives", type: "LOCATION" },
];

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    isOpen: true,
    sourceEntry: { id: "a", name: "Mara Vance" },
    entries: ENTRIES,
    existingRelations: [],
    onClose: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };
  render(React.createElement(RelationLinkerModal, props));
  return props;
}

describe("RelationLinkerModal (JGF-128)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the read-only source, predicate selector, combobox and symmetry toggle", () => {
    setup();
    expect(screen.getByTestId("relation-source").textContent).toBe("Mara Vance");
    expect(screen.getByTestId("relation-predicate")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: /Target Entity/ })).toBeTruthy();
    expect(screen.getByTestId("relation-bidirectional")).toBeTruthy();
  });

  it("excludes the source entry from target candidates and filters by search", () => {
    setup();
    const input = screen.getByRole("combobox", { name: /Target Entity/ });
    fireEvent.focus(input);
    const options = listboxOptions();
    expect(options.map((o) => o.textContent)).toHaveLength(2);
    expect(options.some((o) => o.textContent?.includes("Mara Vance"))).toBe(false);

    fireEvent.change(input, { target: { value: "archive" } });
    const filtered = listboxOptions();
    expect(filtered).toHaveLength(1);
    expect(filtered[0].textContent).toContain("Sunken Archives");
  });

  it("creates a symmetric rivals relation when bidirectional is on", async () => {
    const p = setup();
    (actions.createCodexRelationAction as any).mockResolvedValueOnce({
      success: true,
      data: { id: "r-1" },
    });

    const input = screen.getByRole("combobox", { name: /Target Entity/ });
    fireEvent.change(input, { target: { value: "qhu" } });
    fireEvent.mouseDown(listboxOptions()[0]);

    fireEvent.change(screen.getByTestId("relation-predicate"), { target: { value: "rivals" } });
    fireEvent.click(screen.getByRole("button", { name: "Link Relation" }));

    await waitFor(() =>
      expect(actions.createCodexRelationAction).toHaveBeenCalledWith({
        sourceEntryId: "a",
        targetEntryId: "b",
        relationType: "rivals",
        reverseType: "rivals",
      }),
    );
    expect(p.onSaved).toHaveBeenCalled();
    expect(p.onClose).toHaveBeenCalled();
  });

  it("stores no reverse label when the symmetry toggle is off", async () => {
    setup();
    (actions.createCodexRelationAction as any).mockResolvedValueOnce({
      success: true,
      data: { id: "r-2" },
    });

    const input = screen.getByRole("combobox", { name: /Target Entity/ });
    fireEvent.change(input, { target: { value: "qhu" } });
    fireEvent.mouseDown(listboxOptions()[0]);
    fireEvent.click(screen.getByTestId("relation-bidirectional"));
    fireEvent.click(screen.getByRole("button", { name: "Link Relation" }));

    await waitFor(() =>
      expect(actions.createCodexRelationAction).toHaveBeenCalledWith({
        sourceEntryId: "a",
        targetEntryId: "b",
        relationType: "allies_with",
        reverseType: null,
      }),
    );
  });

  it("resolves parent_of + bidirectional to a child_of reverse", async () => {
    setup();
    (actions.createCodexRelationAction as any).mockResolvedValueOnce({
      success: true,
      data: { id: "r-3" },
    });

    const input = screen.getByRole("combobox", { name: /Target Entity/ });
    fireEvent.change(input, { target: { value: "qhu" } });
    fireEvent.mouseDown(listboxOptions()[0]);
    fireEvent.change(screen.getByTestId("relation-predicate"), { target: { value: "parent_of" } });
    fireEvent.click(screen.getByRole("button", { name: "Link Relation" }));

    await waitFor(() =>
      expect(actions.createCodexRelationAction).toHaveBeenCalledWith({
        sourceEntryId: "a",
        targetEntryId: "b",
        relationType: "parent_of",
        reverseType: "child_of",
      }),
    );
  });

  it("requires a custom label and target before submitting", async () => {
    setup();
    fireEvent.change(screen.getByTestId("relation-predicate"), { target: { value: "custom" } });
    fireEvent.click(screen.getByRole("button", { name: "Link Relation" }));
    expect(await screen.findByText("Please choose the target entity.")).toBeTruthy();

    const input = screen.getByRole("combobox", { name: /Target Entity/ });
    fireEvent.change(input, { target: { value: "qhu" } });
    fireEvent.mouseDown(listboxOptions()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Link Relation" }));
    expect(await screen.findByText("Please name the custom relation.")).toBeTruthy();
    expect(actions.createCodexRelationAction).not.toHaveBeenCalled();
  });

  it("renders existing relation chips with directional badges", () => {
    setup({
      existingRelations: [
        {
          id: "r-9",
          otherName: "Harbormaster Qhu",
          relationType: "rivals",
          reverseType: "rivals",
          direction: "outgoing",
        },
        {
          id: "r-10",
          otherName: "Sunken Archives",
          relationType: "located_in",
          reverseType: "home_of",
          direction: "incoming",
        },
      ],
    });
    const chips = screen.getByTestId("relation-chips");
    expect(chips.textContent).toContain("──[rivals]──▶");
    expect(chips.textContent).toContain("──[home_of]──▶");
  });

  it("navigates the target list with the keyboard", () => {
    setup();
    const input = screen.getByRole("combobox", { name: /Target Entity/ });
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect((input as HTMLInputElement).value).toBe("Harbormaster Qhu");
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("surfaces thrown action errors", async () => {
    setup();
    (actions.createCodexRelationAction as any).mockRejectedValueOnce(new Error("network failed"));
    const input = screen.getByRole("combobox", { name: /Target Entity/ });
    fireEvent.change(input, { target: { value: "qhu" } });
    fireEvent.mouseDown(listboxOptions()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Link Relation" }));
    expect(await screen.findByText("network failed")).toBeTruthy();
  });

  it("types a custom label into the custom field", () => {
    setup();
    fireEvent.change(screen.getByTestId("relation-predicate"), { target: { value: "custom" } });
    const custom = screen.getByLabelText(/Custom relation label/);
    fireEvent.change(custom, { target: { value: "bound_to" } });
    expect((custom as HTMLInputElement).value).toBe("bound_to");
  });

  it("highlights a target option on mouse enter", () => {
    setup();
    const input = screen.getByRole("combobox", { name: /Target Entity/ });
    fireEvent.focus(input);
    fireEvent.mouseEnter(listboxOptions()[1]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect((input as HTMLInputElement).value).toBe("Sunken Archives");
  });

  it("surfaces action errors and keeps the modal open", async () => {
    const p = setup();
    (actions.createCodexRelationAction as any).mockResolvedValueOnce({
      success: false,
      error: "Cycle detected",
    });

    const input = screen.getByRole("combobox", { name: /Target Entity/ });
    fireEvent.change(input, { target: { value: "qhu" } });
    fireEvent.mouseDown(listboxOptions()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Link Relation" }));

    expect(await screen.findByText("Cycle detected")).toBeTruthy();
    expect(p.onClose).not.toHaveBeenCalled();
  });
});
