import { describe, expect, it } from "vite-plus/test";
import type { AssembledContext, AssembledContextEntry } from "../src/lib/codex/context-assembler";
import {
  estimateFormattedContextTokens,
  estimateFormattedEntryTokens,
  estimateWrapperTokens,
} from "../src/lib/codex/prompt-formatter";
import {
  applyTokenBudget,
  DEFAULT_MAX_TOKENS,
  type BudgetedAssembledContext,
} from "../src/lib/codex/token-budgeter";

function makeEntry(
  overrides: Partial<AssembledContextEntry> & { id: string; name: string },
): AssembledContextEntry {
  return {
    type: "CHARACTER",
    aliases: [],
    description: "",
    trackingMode: "detected",
    source: "mention",
    appliedProgressionIds: [],
    ...overrides,
  };
}

function makeContext(entries: AssembledContextEntry[], sceneId = "scene-1"): AssembledContext {
  return {
    entries,
    meta: {
      totalCandidates: entries.length,
      finalCount: entries.length,
      truncated: false,
      sceneId,
    },
  };
}

const wrapperTokens = estimateWrapperTokens();

describe("TokenBudgeter", () => {
  it("defaults the budget to 4,000 tokens", () => {
    expect(DEFAULT_MAX_TOKENS).toBe(4000);
  });

  it("passes through contexts already under budget", () => {
    const context = makeContext([
      makeEntry({ id: "a", name: "Elara", description: "Archmage" }),
      makeEntry({ id: "b", name: "Emberfall", type: "LOCATION" }),
    ]);

    const budgeted = applyTokenBudget(context, { maxTokens: 5000 });

    expect(budgeted.entries.map((e) => e.id)).toEqual(["a", "b"]);
    expect(budgeted.meta.droppedEntryIds).toEqual([]);
    expect(budgeted.meta.truncatedEntryIds).toEqual([]);
    expect(budgeted.meta.estimatedTokensBefore).toBe(budgeted.meta.estimatedTokensAfter);
    expect(budgeted.meta.maxTokens).toBe(5000);
  });

  it("drops lowest-priority overflow entries while keeping ranked order", () => {
    const seed = makeEntry({
      id: "seed",
      name: "Elara",
      source: "always",
      trackingMode: "always",
      description: "Archmage",
    });
    const mention = makeEntry({
      id: "mention",
      name: "Emberfall",
      type: "LOCATION",
      description: "Volcano city",
    });
    const rel1 = makeEntry({
      id: "rel-1",
      name: "Vaerin",
      source: "relation",
      relationDepth: 1,
      description: "Rival mage",
    });
    const rel2 = makeEntry({
      id: "rel-2",
      name: "The Deep Roads",
      source: "relation",
      relationDepth: 2,
      description: "Tunnels",
    });

    // Fits seed + mention but not even the skeleton of rel-1 or rel-2.
    const maxTokens =
      wrapperTokens +
      estimateFormattedEntryTokens(seed) +
      estimateFormattedEntryTokens(mention) +
      5;

    const budgeted = applyTokenBudget(makeContext([seed, mention, rel1, rel2]), { maxTokens });

    expect(budgeted.entries.map((e) => e.id)).toEqual(["seed", "mention"]);
    expect(budgeted.meta.droppedEntryIds).toEqual(["rel-1", "rel-2"]);
    expect(budgeted.meta.truncatedEntryIds).toEqual([]);
    expect(budgeted.meta.estimatedTokensAfter).toBeLessThanOrEqual(maxTokens);
  });

  it("truncates a high-priority entry's description gracefully before dropping it", () => {
    const longDescription = "Elara weaves flame. ".repeat(60);
    const big = makeEntry({
      id: "big",
      name: "Elara",
      source: "manual",
      trackingMode: "always",
      description: longDescription,
    });
    const small = makeEntry({
      id: "small",
      name: "Emberfall",
      type: "LOCATION",
      description: "Volcano city",
    });

    // Room for the big entry's skeleton plus a little prose, then nothing else.
    const maxTokens =
      wrapperTokens + estimateFormattedEntryTokens({ ...big, description: "" }) + 40;

    const budgeted: BudgetedAssembledContext = applyTokenBudget(makeContext([big, small]), {
      maxTokens,
    });

    expect(budgeted.entries).toHaveLength(1);
    expect(budgeted.entries[0].id).toBe("big");
    expect(budgeted.entries[0].description.length).toBeGreaterThan(0);
    expect(budgeted.entries[0].description.length).toBeLessThan(longDescription.length);
    expect(budgeted.meta.truncatedEntryIds).toEqual(["big"]);
    expect(budgeted.meta.droppedEntryIds).toEqual(["small"]);
    expect(budgeted.meta.estimatedTokensAfter).toBeLessThanOrEqual(maxTokens);
  });

  it("drops entries that cannot fit even with an empty description", () => {
    const small = makeEntry({ id: "small", name: "Elara", description: "Hi" });
    const fat = makeEntry({
      id: "fat",
      name: "X".repeat(60),
      type: "LORE",
      description: "Y".repeat(300),
    });

    // Fits the small entry with a sliver left over; the fat entry's skeleton
    // (long name) cannot fit in that sliver.
    const maxTokens = wrapperTokens + estimateFormattedEntryTokens(small) + 3;

    const budgeted = applyTokenBudget(makeContext([small, fat]), { maxTokens });

    expect(budgeted.entries.map((e) => e.id)).toEqual(["small"]);
    expect(budgeted.meta.droppedEntryIds).toEqual(["fat"]);
    expect(budgeted.meta.truncatedEntryIds).not.toContain("fat");
  });

  it("never exceeds the hard token limit for large contexts", () => {
    const entries: AssembledContextEntry[] = [];
    for (let i = 0; i < 30; i += 1) {
      entries.push(
        makeEntry({
          id: `entry-${i}`,
          name: `Entry ${i}`,
          description: `Description with enough prose ${i} to matter for budgeting. `.repeat(3),
          source: i < 5 ? "always" : i < 15 ? "mention" : "relation",
          relationDepth: i < 15 ? undefined : (i % 2) + 1,
          trackingMode: i < 5 ? "always" : "detected",
        }),
      );
    }
    const context = makeContext(entries);

    for (const maxTokens of [wrapperTokens + 20, 200, 600, DEFAULT_MAX_TOKENS]) {
      const budgeted = applyTokenBudget(context, { maxTokens });
      expect(estimateFormattedContextTokens(budgeted)).toBeLessThanOrEqual(maxTokens);
    }
  });

  it("allows only the wrapper when the budget cannot fit any entry", () => {
    const context = makeContext([makeEntry({ id: "a", name: "Elara", description: "Archmage" })]);

    const budgeted = applyTokenBudget(context, { maxTokens: 1 });

    expect(budgeted.entries).toEqual([]);
    expect(budgeted.meta.droppedEntryIds).toEqual(["a"]);
    // The wrapper is the floor: nothing smaller can be emitted.
    expect(budgeted.meta.estimatedTokensAfter).toBe(
      estimateFormattedContextTokens(makeContext([])),
    );
  });

  it("is deterministic for the same input", () => {
    const context = makeContext([
      makeEntry({
        id: "a",
        name: "Elara",
        source: "manual",
        trackingMode: "always",
        description: "One ".repeat(50),
      }),
      makeEntry({ id: "b", name: "Emberfall", description: "Two ".repeat(50) }),
    ]);
    expect(applyTokenBudget(context, { maxTokens: 100 })).toEqual(
      applyTokenBudget(context, { maxTokens: 100 }),
    );
  });

  it("does not mutate the input context", () => {
    const context = makeContext([
      makeEntry({ id: "a", name: "Elara", description: "One ".repeat(80) }),
      makeEntry({ id: "b", name: "Emberfall", description: "Two ".repeat(80) }),
    ]);
    const snapshot = JSON.stringify(context);

    applyTokenBudget(context, { maxTokens: 100 });

    expect(JSON.stringify(context)).toBe(snapshot);
  });
});
