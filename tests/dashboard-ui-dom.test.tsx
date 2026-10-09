// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const actions = vi.hoisted(() => ({
  createNovelAction: vi.fn(),
  createSeriesAction: vi.fn(),
  seedStarterBibleAction: vi.fn(),
}));
vi.mock("../src/lib/library/actions", () => actions);
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) =>
    React.createElement("a", { href, ...rest }, children),
}));

import { LibraryCreator } from "../src/app/dashboard/_components/LibraryCreator";
import { OnboardingWizard } from "../src/app/dashboard/_components/OnboardingWizard";

const series = [{ id: "s1", title: "Ashfall" }];

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  refresh.mockReset();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("LibraryCreator", () => {
  it("validates and creates a novel in a series", async () => {
    render(React.createElement(LibraryCreator, { series }));
    fireEvent.click(screen.getByText("+ New Novel"));
    const form = screen.getByTestId("novel-create-modal").querySelector("form")!;
    fireEvent.submit(form);
    expect(await screen.findByText("Please provide a novel title.")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("e.g. The Glass Weaver"), {
      target: { value: " Glass " },
    });
    fireEvent.change(screen.getByPlaceholderText("e.g. Book One of the Ashfall Cycle"), {
      target: { value: "B1" },
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "s1" } });
    fireEvent.change(screen.getByPlaceholderText("Premise, genre notes, working blurb..."), {
      target: { value: " " },
    });
    actions.createNovelAction.mockResolvedValueOnce({ success: false });
    fireEvent.submit(form);
    expect(await screen.findByText("Failed to create novel.")).toBeTruthy();
    actions.createNovelAction.mockRejectedValueOnce(new Error("quota"));
    fireEvent.submit(form);
    expect(await screen.findByText("quota")).toBeTruthy();
    actions.createNovelAction.mockRejectedValueOnce("x");
    fireEvent.submit(form);
    expect(await screen.findByText("An unexpected error occurred.")).toBeTruthy();
    actions.createNovelAction.mockResolvedValueOnce({ success: true, data: { id: "n1" } });
    fireEvent.submit(form);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(actions.createNovelAction).toHaveBeenLastCalledWith({
      title: "Glass",
      subtitle: "B1",
      description: null,
      seriesId: "s1",
    });
    expect(screen.queryByTestId("novel-create-modal")).toBeNull();
  });

  it("closes the novel modal and creates a series", async () => {
    render(React.createElement(LibraryCreator, { series: [] }));
    fireEvent.click(screen.getByText("+ New Novel"));
    fireEvent.click(screen.getByText("✕"));
    expect(screen.queryByTestId("novel-create-modal")).toBeNull();
    fireEvent.click(screen.getByText("+ New Novel"));
    fireEvent.click(screen.getByText("Cancel"));

    fireEvent.click(screen.getByText("+ New Series"));
    const form = screen
      .getByText("New Series")
      .closest("div")!
      .parentElement!.querySelector("form")!;
    fireEvent.submit(form);
    expect(await screen.findByText("Please provide a series title.")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("e.g. The Ashfall Cycle"), {
      target: { value: "Ash" },
    });
    fireEvent.change(screen.getByPlaceholderText("What ties these books together?"), {
      target: { value: "fire" },
    });
    actions.createSeriesAction.mockResolvedValueOnce({ success: false, error: "dup" });
    fireEvent.submit(form);
    expect(await screen.findByText("dup")).toBeTruthy();
    actions.createSeriesAction.mockRejectedValueOnce(new Error("boom"));
    fireEvent.submit(form);
    expect(await screen.findByText("boom")).toBeTruthy();
    actions.createSeriesAction.mockRejectedValueOnce(0);
    fireEvent.submit(form);
    expect(await screen.findByText("An unexpected error occurred.")).toBeTruthy();
    actions.createSeriesAction.mockResolvedValueOnce({ success: true, data: { id: "s2" } });
    fireEvent.submit(form);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    fireEvent.click(screen.getByText("+ New Series"));
    fireEvent.click(screen.getByText("Cancel"));
    fireEvent.click(screen.getByText("+ New Series"));
    fireEvent.click(screen.getByText("✕"));
  });
});

describe("OnboardingWizard", () => {
  it("is hidden for authors with novels or after dismissal", () => {
    const { container, unmount } = render(
      React.createElement(OnboardingWizard, { hasNovels: true, series }),
    );
    expect(container.innerHTML).toBe("");
    unmount();
    window.localStorage.setItem("inkstory.onboarding.dismissed.v1", "1");
    const r = render(React.createElement(OnboardingWizard, { hasNovels: false, series }));
    expect(r.container.innerHTML).toBe("");
  });

  it("skips and persists the dismissal", () => {
    render(React.createElement(OnboardingWizard, { hasNovels: false, series }));
    fireEvent.click(screen.getByText("Skip"));
    expect(screen.queryByTestId("onboarding-wizard")).toBeNull();
    expect(window.localStorage.getItem("inkstory.onboarding.dismissed.v1")).toBe("1");
  });

  it("creates a first novel and links to the writing desk", async () => {
    render(React.createElement(OnboardingWizard, { hasNovels: false, series }));
    fireEvent.click(screen.getByText("Next →"));
    fireEvent.click(screen.getByText("← Back"));
    fireEvent.click(screen.getByText("Next →"));
    const form = screen.getByPlaceholderText("e.g. The Glass Weaver").closest("form")!;
    fireEvent.submit(form);
    expect(await screen.findByText("Please give your novel a title.")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("e.g. The Glass Weaver"), {
      target: { value: "Glass" },
    });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "s1" } });
    actions.createNovelAction.mockResolvedValueOnce({ success: false });
    fireEvent.submit(form);
    expect(await screen.findByText("Failed to create novel.")).toBeTruthy();
    actions.createNovelAction.mockRejectedValueOnce(new Error("nope"));
    fireEvent.submit(form);
    expect(await screen.findByText("nope")).toBeTruthy();
    actions.createNovelAction.mockResolvedValueOnce({ success: true, data: { id: "n9" } });
    fireEvent.submit(form);
    const link = await screen.findByText("Open the writing desk →");
    expect(link.getAttribute("href")).toBe("/dashboard/novels/n9");
    expect(actions.createNovelAction).toHaveBeenLastCalledWith({ title: "Glass", seriesId: "s1" });
    expect(refresh).toHaveBeenCalled();
    fireEvent.click(screen.getByText("Done"));
    expect(screen.queryByTestId("onboarding-wizard")).toBeNull();
  });

  it("seeds the sample bible and handles seed failures", async () => {
    render(React.createElement(OnboardingWizard, { hasNovels: false, series: [] }));
    fireEvent.click(screen.getByText("Next →"));
    expect(screen.queryByRole("combobox")).toBeNull();
    const seed = () => fireEvent.click(screen.getByText(/Seed a sample fantasy bible/));
    actions.seedStarterBibleAction.mockResolvedValueOnce({ success: false });
    seed();
    expect(await screen.findByText("Failed to seed the sample bible.")).toBeTruthy();
    actions.seedStarterBibleAction.mockRejectedValueOnce("x");
    seed();
    expect(await screen.findByText("An unexpected error occurred.")).toBeTruthy();
    actions.seedStarterBibleAction.mockResolvedValueOnce({ success: true, data: {} });
    seed();
    expect(await screen.findByText("Meet your writing desk")).toBeTruthy();
    expect(screen.queryByText("Open the writing desk →")).toBeNull();
  });
});
