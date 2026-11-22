// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useCodexBudget } from "../src/app/dashboard/novels/[id]/_components/useCodexBudget";
import * as api from "../src/app/dashboard/novels/[id]/_components/api";
import type { MentionDetectionResult } from "../src/lib/codex/mention-detection";

vi.mock("../src/app/dashboard/novels/[id]/_components/api", () => ({
  apiGet: vi.fn(),
}));

const ENTRIES = [
  {
    id: "seed-1",
    name: "World Seed",
    type: "WORLD",
    description: "Always-on lore that eats tokens.",
    trackingMode: "ALWAYS",
  },
  {
    id: "mara",
    name: "Mara Vance",
    type: "CHARACTER",
    description: "Protagonist of the quay.",
    trackingMode: "detected",
  },
  {
    id: "qhu",
    name: "Harbormaster Qhu",
    type: "CHARACTER",
    description: "Antagonist at the desk.",
    trackingMode: "detected",
  },
  {
    id: "archives",
    name: "Sunken Archives",
    type: "LOCATION",
    description: "A damp library.",
    trackingMode: "detected",
  },
];

function detectionFor(...ids: string[]): MentionDetectionResult {
  return {
    matchedEntryIds: ids,
    matches: ids.map((id, i) => ({
      entryId: id,
      matchedText: id,
      originalText: id,
      matchType: "name" as const,
      startIndex: i,
      endIndex: i + 1,
    })),
  };
}

describe("useCodexBudget (JGF-128)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads entries, estimates seed/mentions/relations/progressions, and supports invalidate/reload", async () => {
    (api.apiGet as any).mockImplementation(async (url: string) => {
      if (url.includes("/api/codex/entries?")) {
        return { entries: ENTRIES };
      }
      if (url.includes("/api/codex/entries/mara")) {
        return {
          entry: {
            id: "mara",
            name: "Mara Vance",
            sourceRelations: [
              {
                id: "r1",
                relationType: "rivals",
                reverseType: "rivals",
                targetEntryId: "qhu",
                targetEntry: { name: "Harbormaster Qhu" },
              },
              {
                id: "r2",
                relationType: "located_in",
                reverseType: null,
                targetEntryId: "archives",
              },
            ],
            targetRelations: [],
            progressions: [
              {
                id: "p1",
                sceneId: "scene-1",
                mode: "ADDITION",
                description: "Mara gains a scar on her cheek.",
              },
              {
                id: "p2",
                sceneId: "scene-2",
                mode: "REPLACEMENT",
                description: "Future vow that should stay out of budget.",
              },
            ],
          },
        };
      }
      throw new Error(`unexpected ${url}`);
    });

    const sceneIndexById = new Map([
      ["scene-1", 0],
      ["scene-2", 1],
    ]);

    const { result } = renderHook(() =>
      useCodexBudget("novel-1", detectionFor("mara"), 0, sceneIndexById),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.entries).toHaveLength(4);

    await waitFor(() => expect(result.current.details.has("mara")).toBe(true));

    const byId = Object.fromEntries(result.current.segments.map((s) => [s.id, s.tokens]));
    expect(byId.seed).toBeGreaterThan(0);
    expect(byId.mentions).toBeGreaterThan(0);
    expect(byId.relations).toBeGreaterThan(0);
    expect(byId.progressions).toBeGreaterThan(0);

    expect(result.current.breakdown.relations?.map((i) => i.label).sort()).toEqual([
      "Harbormaster Qhu",
      "Sunken Archives",
    ]);
    expect(result.current.breakdown.progressions?.[0].label).toContain("adds");
    expect(result.current.breakdown.progressions?.some((i) => i.label.includes("replaces"))).toBe(
      false,
    );

    act(() => {
      result.current.ensureDetail("mara"); // cached — no extra fetch
      result.current.invalidateDetail("mara");
    });
    await waitFor(() => expect(result.current.details.has("mara")).toBe(true));

    const callsBeforeReload = (api.apiGet as any).mock.calls.length;
    act(() => {
      result.current.reload();
    });
    await waitFor(() =>
      expect((api.apiGet as any).mock.calls.length).toBeGreaterThan(callsBeforeReload),
    );
  });

  it("surfaces a budget error when the entries request fails", async () => {
    (api.apiGet as any).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useCodexBudget("novel-1", null, null, new Map()));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Couldn't estimate the context budget.");
  });

  it("ignores detail fetch failures and skips unknown neighbors", async () => {
    (api.apiGet as any).mockImplementation(async (url: string) => {
      if (url.includes("/api/codex/entries?")) {
        return { entries: [ENTRIES[1]] };
      }
      if (url.includes("/api/codex/entries/mara")) {
        return {
          entry: {
            id: "mara",
            name: "Mara Vance",
            sourceRelations: [
              { id: "r", relationType: "knows", reverseType: null, targetEntryId: "missing" },
            ],
            targetRelations: [
              { id: "r2", relationType: "knows", reverseType: null, sourceEntryId: "mara" },
            ],
            progressions: [],
          },
        };
      }
      throw new Error("detail boom");
    });

    const { result } = renderHook(() =>
      useCodexBudget("novel-1", detectionFor("mara"), 0, new Map([["scene-1", 0]])),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.details.has("mara")).toBe(true));
    expect(result.current.breakdown.relations ?? []).toEqual([]);
  });
});
