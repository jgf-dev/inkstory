import { describe, expect, it } from "vite-plus/test";
import { countWords, formatWordCount } from "../src/lib/writing/word-count";
import {
  clearDraft,
  isDraftRecoverable,
  loadDraft,
  saveDraft,
  type SceneDraft,
} from "../src/lib/writing/draft";
import { toEpochMs, toIsoString } from "../src/lib/writing/dates";
import { Temporal } from "temporal-polyfill";

describe("word count helpers", () => {
  it("counts whitespace-separated words", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t  ")).toBe(0);
    expect(countWords("one two three")).toBe(3);
    expect(countWords("Mara\nclimbed  the rigging.\tQuickly.")).toBe(5);
    expect(countWords("café—naïve")).toBe(1);
  });

  it("guards non-string input", () => {
    expect(countWords(undefined as unknown as string)).toBe(0);
    expect(countWords(null as unknown as string)).toBe(0);
  });

  it("formats counts for the status bar", () => {
    expect(formatWordCount(0)).toBe("0 words");
    expect(formatWordCount(1)).toBe("1 word");
    expect(formatWordCount(1234)).toBe("1,234 words");
    expect(formatWordCount(Number.NaN)).toBe("0 words");
  });
});

describe("scene draft fallback (localStorage)", () => {
  // Minimal localStorage stub over globalThis.window.
  let store: Map<string, string>;
  function stubStorage() {
    store = new Map();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    };
  }
  function unstub() {
    delete (globalThis as { window?: unknown }).window;
  }

  const draft: SceneDraft = {
    sceneId: "scene-1",
    title: "T",
    content: "Some unsaved prose",
    summary: "",
    savedAt: 1_700_000_000_000,
    unsaved: true,
  };

  it("round-trips a draft and clears it", () => {
    stubStorage();
    try {
      saveDraft(draft);
      expect(loadDraft("scene-1")).toEqual(draft);
      clearDraft("scene-1");
      expect(loadDraft("scene-1")).toBeNull();
    } finally {
      unstub();
    }
  });

  it("drops corrupt or foreign drafts", () => {
    stubStorage();
    try {
      store.set("inkstory.scene-draft.scene-2", "not json{");
      expect(loadDraft("scene-2")).toBeNull();
      store.set(
        "inkstory.scene-draft.scene-3",
        JSON.stringify({ sceneId: "scene-4", content: "x", savedAt: 5 }),
      );
      expect(loadDraft("scene-3")).toBeNull();
    } finally {
      unstub();
    }
  });

  it("is a no-op without storage (SSR/private mode)", () => {
    expect(() => saveDraft(draft)).not.toThrow();
    expect(loadDraft("scene-1")).toBeNull();
    expect(() => clearDraft("scene-1")).not.toThrow();
  });

  it("only offers drafts that are newer than the server row and unsaved", () => {
    const serverUpdatedAtMs = 1_700_000_000_000;
    expect(isDraftRecoverable(null, serverUpdatedAtMs)).toBe(false);
    expect(isDraftRecoverable({ ...draft, unsaved: false }, serverUpdatedAtMs)).toBe(false);
    expect(isDraftRecoverable(draft, serverUpdatedAtMs)).toBe(false);
    expect(
      isDraftRecoverable({ ...draft, savedAt: serverUpdatedAtMs + 1 }, serverUpdatedAtMs),
    ).toBe(true);
  });
});

describe("timestamp helpers", () => {
  it("coerces Temporal.PlainDateTime rows to epoch millis (UTC anchor)", () => {
    const pdt = Temporal.PlainDateTime.from("2026-10-08T20:17:12.546");
    const ms = toEpochMs(pdt);
    expect(ms).toBe(Date.parse("2026-10-08T20:17:12.546Z"));
    expect(toIsoString(pdt)).toBe("2026-10-08T20:17:12.546Z");
  });

  it("passes through Date, ISO strings, and numbers", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(toEpochMs(date)).toBe(date.getTime());
    expect(toEpochMs("2026-01-01T00:00:00.000Z")).toBe(date.getTime());
    expect(toEpochMs(date.getTime())).toBe(date.getTime());
    expect(toEpochMs(null)).toBe(0);
    expect(toEpochMs({})).toBe(0);
  });

  it("keeps ordering monotonic across row shapes", () => {
    const earlier = toEpochMs(Temporal.PlainDateTime.from("2026-01-01T00:00:00"));
    const later = toEpochMs(Temporal.PlainDateTime.from("2026-01-02T00:00:00"));
    expect(earlier).toBeLessThan(later);
  });
});
