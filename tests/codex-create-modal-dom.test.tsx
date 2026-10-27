// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CodexCreateModal } from "../src/app/dashboard/codex/_components/CodexCreateModal";
import * as actions from "../src/lib/codex/actions";

vi.mock("../src/lib/codex/actions", () => ({
  createCodexEntryAction: vi.fn(),
}));

describe("CodexCreateModal DOM interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const dummyNovels = [{ id: "n-1", title: "Novel One", seriesId: null }];
  const dummySeries = [{ id: "s-1", title: "Series One" }];

  it("handles form validation for empty name", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();

    render(
      React.createElement(CodexCreateModal, {
        isOpen: true,
        onClose,
        novels: dummyNovels,
        series: dummySeries,
        onCreated,
      }),
    );

    const submitBtn = screen.getByRole("button", { name: "Create Entry" });
    const nameInput = screen.getByPlaceholderText(
      "e.g. Mara Vance, Sunken Archives",
    ) as HTMLInputElement;
    nameInput.required = false;

    fireEvent.click(submitBtn);

    expect(await screen.findByText("Please provide an entry name.")).toBeTruthy();
    expect(actions.createCodexEntryAction).not.toHaveBeenCalled();
  });

  it("handles scope toggling and form submission for book-scoped entry", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    (actions.createCodexEntryAction as any).mockResolvedValueOnce({
      success: true,
      data: { id: "entry-123", name: "Mara" },
    });

    render(
      React.createElement(CodexCreateModal, {
        isOpen: true,
        onClose,
        novels: dummyNovels,
        series: dummySeries,
        onCreated,
      }),
    );

    const nameInput = screen.getByPlaceholderText("e.g. Mara Vance, Sunken Archives");
    fireEvent.change(nameInput, { target: { value: "Mara Vance" } });

    const aliasesInput = screen.getByPlaceholderText("e.g. The Glass Weaver, Mara");
    fireEvent.change(aliasesInput, { target: { value: "Weaver, Mara" } });

    const descInput = screen.getByPlaceholderText("Primary world bible description...");
    fireEvent.change(descInput, { target: { value: "Main character" } });

    const notesInput = screen.getByPlaceholderText(
      "Secret backstory, plot triggers, author reminders...",
    );
    fireEvent.change(notesInput, { target: { value: "Private notes" } });

    const colorButtons = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("style")?.includes("background-color"));
    if (colorButtons[1]) {
      fireEvent.click(colorButtons[1]);
    }

    const submitBtn = screen.getByRole("button", { name: "Create Entry" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(actions.createCodexEntryAction).toHaveBeenCalledWith({
        name: "Mara Vance",
        type: "CHARACTER",
        trackingMode: "DETECTED",
        seriesScoped: false,
        novelId: "n-1",
        seriesId: null,
        description: "Main character",
        notes: "Private notes",
        color: "#10b981",
        aliases: ["Weaver", "Mara"],
      });
    });

    expect(onCreated).toHaveBeenCalledWith({ id: "entry-123", name: "Mara" });
    expect(onClose).toHaveBeenCalled();
  });

  it("handles scope toggling to series-wide and error handling on action failure", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    (actions.createCodexEntryAction as any).mockResolvedValueOnce({
      success: false,
      error: "Series creation error",
    });

    render(
      React.createElement(CodexCreateModal, {
        isOpen: true,
        onClose,
        novels: dummyNovels,
        series: dummySeries,
        onCreated,
      }),
    );

    const nameInput = screen.getByPlaceholderText("e.g. Mara Vance, Sunken Archives");
    fireEvent.change(nameInput, { target: { value: "Sunken Archives" } });

    const seriesRadio = screen.getByLabelText("Series-wide");
    fireEvent.click(seriesRadio);

    const submitBtn = screen.getByRole("button", { name: "Create Entry" });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(actions.createCodexEntryAction).toHaveBeenCalledWith({
        name: "Sunken Archives",
        type: "CHARACTER",
        trackingMode: "DETECTED",
        seriesScoped: true,
        novelId: null,
        seriesId: "s-1",
        description: "",
        notes: null,
        color: "#3b82f6",
        aliases: [],
      });
    });

    expect(await screen.findByText("Series creation error")).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("handles unexpected thrown errors in action", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    (actions.createCodexEntryAction as any).mockRejectedValueOnce(new Error("Network timeout"));

    render(
      React.createElement(CodexCreateModal, {
        isOpen: true,
        onClose,
        novels: dummyNovels,
        series: dummySeries,
        onCreated,
      }),
    );

    const nameInput = screen.getByPlaceholderText("e.g. Mara Vance, Sunken Archives");
    fireEvent.change(nameInput, { target: { value: "Test Entry" } });

    const submitBtn = screen.getByRole("button", { name: "Create Entry" });
    fireEvent.click(submitBtn);

    expect(await screen.findByText("Network timeout")).toBeTruthy();
  });

  it("shows error if book-scoped entry has no novel selected", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();

    render(
      React.createElement(CodexCreateModal, {
        isOpen: true,
        onClose,
        novels: [],
        series: [],
        onCreated,
      }),
    );

    const nameInput = screen.getByPlaceholderText("e.g. Mara Vance, Sunken Archives");
    fireEvent.change(nameInput, { target: { value: "No Novel Entry" } });

    const submitBtn = screen.getByRole("button", { name: "Create Entry" });
    fireEvent.click(submitBtn);

    expect(
      await screen.findByText("Book-scoped entries must be associated with a novel."),
    ).toBeTruthy();
  });

  it("shows error if series-scoped entry has no series selected", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();

    render(
      React.createElement(CodexCreateModal, {
        isOpen: true,
        onClose,
        novels: [],
        series: [],
        onCreated,
      }),
    );

    const nameInput = screen.getByPlaceholderText("e.g. Mara Vance, Sunken Archives");
    fireEvent.change(nameInput, { target: { value: "No Series Entry" } });

    const seriesRadio = screen.getByLabelText("Series-wide");
    fireEvent.click(seriesRadio);

    const submitBtn = screen.getByRole("button", { name: "Create Entry" });
    fireEvent.click(submitBtn);

    expect(
      await screen.findByText("Series-scoped entries must be associated with a series."),
    ).toBeTruthy();
  });
  it("associates every field label with its control", () => {
    render(
      React.createElement(CodexCreateModal, {
        isOpen: true,
        onClose: vi.fn(),
        novels: dummyNovels,
        series: dummySeries,
        onCreated: vi.fn(),
      }),
    );

    const expectations: Array<[string, string]> = [
      ["Name *", "INPUT"],
      ["Type", "SELECT"],
      ["Tracking Mode", "SELECT"],
      ["Target Novel *", "SELECT"],
      ["Aliases (comma separated)", "INPUT"],
      ["Description", "TEXTAREA"],
      ["Private Author Notes", "TEXTAREA"],
    ];
    const ids = new Set<string>();
    for (const [label, tag] of expectations) {
      const control = screen.getByLabelText(label);
      expect(control.tagName).toBe(tag);
      expect(control.id).not.toBe("");
      ids.add(control.id);
    }
    expect(ids.size).toBe(expectations.length);

    fireEvent.click(screen.getByLabelText("Series-wide"));
    const seriesSelect = screen.getByLabelText("Target Series *") as HTMLSelectElement;
    expect(seriesSelect.tagName).toBe("SELECT");
    expect(seriesSelect.value).toBe("s-1");
  });

  it("exposes the color presets as a labelled toggle group", () => {
    render(
      React.createElement(CodexCreateModal, {
        isOpen: true,
        onClose: vi.fn(),
        novels: dummyNovels,
        series: dummySeries,
        onCreated: vi.fn(),
      }),
    );

    const group = screen.getByRole("group", { name: "Color Theme" });
    const presets = within(group).getAllByRole("button");
    expect(presets).toHaveLength(7);
    expect(presets[0].getAttribute("aria-pressed")).toBe("true");
    expect(presets[1].getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Color #10b981" }));
    expect(screen.getByRole("button", { name: "Color #10b981" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(presets[0].getAttribute("aria-pressed")).toBe("false");
  });
});
