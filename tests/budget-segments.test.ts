import { describe, expect, it } from "vite-plus/test";
import { computeTokenBudgetBar, formatBudgetSummary } from "../src/lib/codex/budget-segments";

describe("token budget bar segment math (JGF-128)", () => {
  it("lays out segments as true proportions of the budget with the buffer as remainder", () => {
    const model = computeTokenBudgetBar(
      [
        { id: "seed", tokens: 1000 },
        { id: "mentions", tokens: 500 },
        { id: "relations", tokens: 400 },
        { id: "progressions", tokens: 100 },
      ],
      4000,
    );
    expect(model.usedTokens).toBe(2000);
    expect(model.usedPct).toBe(50);
    expect(model.overBudget).toBe(false);
    expect(model.overflowPct).toBe(0);
    expect(model.bufferPct).toBe(50);
    const pct = Object.fromEntries(model.segments.map((s) => [s.id, s.pct]));
    expect(pct).toEqual({ seed: 25, mentions: 12.5, relations: 10, progressions: 2.5 });
    const total =
      model.segments.reduce((s, x) => s + x.pct, 0) + model.bufferPct + model.overflowPct;
    expect(total).toBeCloseTo(100);
  });

  it("handles an empty budget as 100% buffer", () => {
    const model = computeTokenBudgetBar(
      [
        { id: "seed", tokens: 0 },
        { id: "mentions", tokens: 0 },
        { id: "relations", tokens: 0 },
        { id: "progressions", tokens: 0 },
      ],
      4000,
    );
    expect(model.usedPct).toBe(0);
    expect(model.bufferPct).toBe(100);
    expect(model.segments.every((s) => s.pct === 0)).toBe(true);
  });

  it("caps the bar at 100% with a destructive overflow band when over budget", () => {
    // 8000 demanded against a 4000 budget: overflow share = 50% of the bar.
    const model = computeTokenBudgetBar(
      [
        { id: "seed", tokens: 2000 },
        { id: "mentions", tokens: 4000 },
        { id: "relations", tokens: 1600 },
        { id: "progressions", tokens: 400 },
      ],
      4000,
    );
    expect(model.overBudget).toBe(true);
    expect(model.overflowTokens).toBe(4000);
    expect(model.overflowPct).toBe(50);
    expect(model.bufferPct).toBe(0);
    // Real segments keep relative proportions inside the remaining 50%.
    const pct = Object.fromEntries(model.segments.map((s) => [s.id, s.pct]));
    expect(pct.seed).toBeCloseTo(12.5);
    expect(pct.mentions).toBeCloseTo(25);
    expect(pct.relations).toBeCloseTo(10);
    expect(pct.progressions).toBeCloseTo(2.5);
    const total = model.segments.reduce((s, x) => s + x.pct, 0) + model.overflowPct;
    expect(total).toBeCloseTo(100);
  });

  it("treats exactly-at-budget as full but not over budget", () => {
    const model = computeTokenBudgetBar([{ id: "seed", tokens: 4000 }], 4000);
    expect(model.overBudget).toBe(false);
    expect(model.usedPct).toBe(100);
    expect(model.bufferPct).toBe(0);
  });

  it("sanitizes negative/NaN input and defaults the budget to 4000", () => {
    const model = computeTokenBudgetBar([{ id: "seed", tokens: Number.NaN }], Number.NaN);
    expect(model.maxTokens).toBe(4000);
    expect(model.usedTokens).toBe(0);
    expect(model.bufferPct).toBe(100);
  });

  it("formats the summary label", () => {
    const model = computeTokenBudgetBar([{ id: "seed", tokens: 1234 }], 4000);
    expect(formatBudgetSummary(model)).toBe("1,234 / 4,000 tokens");
  });
});
