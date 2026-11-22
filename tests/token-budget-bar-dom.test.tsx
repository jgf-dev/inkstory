// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { TokenBudgetBar } from "../src/app/dashboard/novels/[id]/_components/TokenBudgetBar";

const SEGMENTS = [
  { id: "seed" as const, tokens: 800 },
  { id: "mentions" as const, tokens: 400 },
  { id: "relations" as const, tokens: 300 },
  { id: "progressions" as const, tokens: 100 },
];

describe("TokenBudgetBar (JGF-128)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the stacked segments with the summary label", () => {
    render(React.createElement(TokenBudgetBar, { segments: SEGMENTS, maxTokens: 4000 }));
    expect(screen.getByTestId("token-budget-summary").textContent).toBe("1,600 / 4,000 tokens");
    expect(screen.getByTestId("budget-segment-seed")).toBeTruthy();
    expect(screen.getByTestId("budget-segment-mentions")).toBeTruthy();
    expect(screen.getByTestId("budget-segment-relations")).toBeTruthy();
    expect(screen.getByTestId("budget-segment-progressions")).toBeTruthy();
    expect(screen.queryByTestId("budget-overflow-segment")).toBeNull();
  });

  it("shows the per-entity breakdown card on focus", () => {
    render(
      React.createElement(TokenBudgetBar, {
        segments: SEGMENTS,
        maxTokens: 4000,
        breakdown: {
          mentions: [
            { label: "Mara Vance", tokens: 300 },
            { label: "Harbormaster Qhu", tokens: 100 },
          ],
        },
      }),
    );
    fireEvent.focus(screen.getByTestId("budget-segment-mentions"));
    const card = screen.getByTestId("budget-breakdown-mentions");
    expect(card.textContent).toContain("Mara Vance");
    expect(card.textContent).toContain("300");
    fireEvent.blur(screen.getByTestId("budget-segment-mentions"));
    expect(screen.queryByTestId("budget-breakdown-mentions")).toBeNull();
  });

  it("caps at 100% and labels the destructive overflow band when over budget", () => {
    render(
      React.createElement(TokenBudgetBar, {
        segments: [
          { id: "seed", tokens: 3000 },
          { id: "mentions", tokens: 3000 },
          { id: "relations", tokens: 0 },
          { id: "progressions", tokens: 0 },
        ],
        maxTokens: 4000,
      }),
    );
    expect(screen.getByTestId("budget-overflow-segment")).toBeTruthy();
    expect(screen.getByTestId("budget-over-label").textContent).toContain(
      "Over budget by 2,000 tokens",
    );
  });

  it("renders loading and error states", () => {
    const { unmount } = render(
      React.createElement(TokenBudgetBar, { segments: SEGMENTS, loading: true }),
    );
    expect(screen.getByTestId("token-budget-bar").getAttribute("aria-busy")).toBe("true");
    unmount();
    render(
      React.createElement(TokenBudgetBar, {
        segments: SEGMENTS,
        error: "Couldn't estimate the context budget.",
      }),
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "Couldn't estimate the context budget.",
    );
  });

  it("opens the breakdown card on mouse enter", () => {
    render(
      React.createElement(TokenBudgetBar, {
        segments: SEGMENTS,
        maxTokens: 4000,
        breakdown: { seed: [{ label: "World Seed", tokens: 800 }] },
      }),
    );
    fireEvent.mouseEnter(screen.getByTestId("budget-segment-seed"));
    expect(screen.getByTestId("budget-breakdown-seed").textContent).toContain("World Seed");
    fireEvent.mouseLeave(screen.getByTestId("budget-segment-seed"));
    expect(screen.queryByTestId("budget-breakdown-seed")).toBeNull();
  });

  it("renders an all-buffer empty state at zero usage", () => {
    render(
      React.createElement(TokenBudgetBar, {
        segments: SEGMENTS.map((s) => ({ ...s, tokens: 0 })),
      }),
    );
    expect(screen.getByTestId("token-budget-summary").textContent).toBe("0 / 4,000 tokens");
    expect(screen.queryByTestId("budget-segment-seed")).toBeNull();
  });
});
