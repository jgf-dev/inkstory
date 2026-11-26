import { describe, expect, it } from "vite-plus/test";
import {
  ANY,
  DEFAULT_COUNT,
  MAX_COUNT,
  TROPE_CATALOG,
  TROPE_CATEGORIES,
  TROPE_GENERATOR_PATH,
  TROPE_GENRES,
  areExcluded,
  buildExclusionIndex,
  buildTropeGeneratorHref,
  clampCount,
  findTrope,
  generateTropes,
  matchesFilters,
  parseLockedIds,
  parseTropeGeneratorParams,
  resolveLocks,
  rngKey,
  toggleLock,
  type CategoryFilter,
  type GenreFilter,
  type Trope,
  type TropeCatalog,
  type TropeGeneratorOptions,
} from "../src/lib/tools/story-tropes";

const base: TropeGeneratorOptions = {
  seed: "seed-1",
  genre: ANY,
  category: ANY,
  count: DEFAULT_COUNT,
  locked: [],
};

function ids(overrides: Partial<TropeGeneratorOptions> = {}, catalog?: TropeCatalog) {
  return generateTropes({ ...base, ...overrides }, catalog).map((entry) => entry.trope.id);
}

const GENRE_FILTERS: GenreFilter[] = [ANY, ...TROPE_GENRES];
const CATEGORY_FILTERS: CategoryFilter[] = [ANY, ...TROPE_CATEGORIES];
const SEEDS = Array.from({ length: 25 }, (_, i) => `s${i}`);

function hasBlockedPair(list: readonly string[]): boolean {
  return list.some((a, i) => list.slice(i + 1).some((b) => areExcluded(a, b)));
}

function trope(id: string, overrides: Partial<Trope> = {}): Trope {
  return {
    id,
    name: id,
    description: `${id} description`,
    category: "plot",
    genres: [],
    weight: 1,
    ...overrides,
  };
}

describe("trope catalog", () => {
  it("has unique ids, original short descriptions, valid tags and weights", () => {
    const seen = new Set<string>();
    expect(TROPE_CATALOG.tropes.length).toBeGreaterThanOrEqual(40);
    for (const entry of TROPE_CATALOG.tropes) {
      expect(seen.has(entry.id)).toBe(false);
      seen.add(entry.id);
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(20);
      expect(entry.description.length).toBeLessThan(200);
      expect(TROPE_CATEGORIES).toContain(entry.category);
      for (const genre of entry.genres) expect(TROPE_GENRES).toContain(genre);
      expect(entry.weight).toBeGreaterThan(0);
    }
  });

  it("covers every category and genre", () => {
    for (const category of TROPE_CATEGORIES) {
      expect(TROPE_CATALOG.tropes.some((entry) => entry.category === category)).toBe(true);
    }
    for (const genre of TROPE_GENRES) {
      expect(
        TROPE_CATALOG.tropes.filter((entry) => matchesFilters(entry, genre, ANY)).length,
      ).toBeGreaterThan(MAX_COUNT);
    }
  });

  it("lists exclusions between distinct, existing tropes", () => {
    expect(TROPE_CATALOG.exclusions.length).toBeGreaterThan(0);
    for (const [a, b] of TROPE_CATALOG.exclusions) {
      expect(a).not.toBe(b);
      expect(findTrope(a)).toBeDefined();
      expect(findTrope(b)).toBeDefined();
    }
  });

  it("indexes exclusions in both directions", () => {
    const index = buildExclusionIndex(TROPE_CATALOG);
    expect(areExcluded("cozy-low-stakes", "grimdark", index)).toBe(true);
    expect(areExcluded("grimdark", "cozy-low-stakes")).toBe(true);
    expect(areExcluded("found-family", "heist")).toBe(false);
    expect(findTrope("nope")).toBeUndefined();
  });
});

describe("generateTropes", () => {
  it("returns the same combo for the same seed, filters, count and locks", () => {
    const options = {
      seed: "story",
      genre: "fantasy",
      category: ANY,
      count: 5,
      locked: ["heist"],
    } as const;
    expect(ids(options)).toEqual(ids(options));
    expect(ids(options)).toHaveLength(5);
    expect(rngKey({ ...base, count: 99 })).toBe(rngKey({ ...base, count: MAX_COUNT }));
  });

  it("changes the combo when the seed or filters change", () => {
    const first = ids();
    expect(SEEDS.some((seed) => ids({ seed }).join() !== first.join())).toBe(true);
    expect(ids({ genre: "horror" }).join()).not.toBe(first.join());
  });

  it("never repeats a trope or emits a blocked pair, across filters and seeds", () => {
    for (const genre of GENRE_FILTERS) {
      for (const category of CATEGORY_FILTERS) {
        for (const seed of SEEDS.slice(0, 8)) {
          const combo = ids({ seed, genre, category, count: MAX_COUNT });
          expect(new Set(combo).size).toBe(combo.length);
          expect(hasBlockedPair(combo)).toBe(false);
        }
      }
    }
  });

  it("respects genre and category filters for unlocked picks", () => {
    for (const seed of SEEDS) {
      for (const entry of generateTropes({ ...base, seed, genre: "horror", count: MAX_COUNT })) {
        expect(entry.trope.genres.length === 0 || entry.trope.genres.includes("horror")).toBe(true);
      }
      for (const entry of generateTropes({ ...base, seed, category: "romance" })) {
        expect(entry.trope.category).toBe("romance");
      }
    }
  });

  it("weights common tropes above rare ones", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 400; i += 1) {
      for (const id of ids({ seed: `w${i}`, category: "romance", count: 1 })) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    expect(counts.get("enemies-to-lovers") ?? 0).toBeGreaterThan(
      counts.get("love-at-first-sight") ?? 0,
    );
  });

  it("keeps locked tropes first across rerolls, even outside the filters", () => {
    for (const seed of SEEDS) {
      const combo = generateTropes({
        ...base,
        seed,
        genre: "romance",
        locked: ["first-contact", "grimdark"],
      });
      expect(combo.slice(0, 2).map((entry) => entry.trope.id)).toEqual([
        "first-contact",
        "grimdark",
      ]);
      expect(combo.slice(0, 2).every((entry) => entry.locked)).toBe(true);
      expect(combo.slice(2).every((entry) => !entry.locked)).toBe(true);
      const all = combo.map((entry) => entry.trope.id);
      expect(all).toHaveLength(DEFAULT_COUNT);
      expect(all).not.toContain("cozy-low-stakes");
      expect(hasBlockedPair(all)).toBe(false);
    }
  });

  it("keeps the other picks stable when a shown trope is locked", () => {
    const shown = ids({ seed: "stable", count: 5 });
    const locked = ids({ seed: "stable", count: 5, locked: [shown[2]] });
    expect(locked[0]).toBe(shown[2]);
    expect(new Set(locked)).toEqual(new Set(shown));
  });

  it("grows the combo to fit more locks than the count", () => {
    const locked = ["heist", "quest", "slow-burn"];
    expect(ids({ count: 2, locked })).toEqual(locked);
  });

  it("clamps the count", () => {
    expect(clampCount(0)).toBe(1);
    expect(clampCount(100)).toBe(MAX_COUNT);
    expect(clampCount(3.7)).toBe(3);
    expect(clampCount(Number.NaN)).toBe(DEFAULT_COUNT);
    expect(ids({ count: 100 })).toHaveLength(MAX_COUNT);
  });

  it("fills from a tiny pool and stops when compatible tropes run out", () => {
    const catalog: TropeCatalog = {
      tropes: [
        trope("a", { weight: 100 }),
        trope("b"),
        trope("c"),
        trope("d", { category: "tone" }),
      ],
      exclusions: [["a", "c"]],
    };
    const combo = ids({ count: 4, category: "plot" }, catalog);
    expect(combo).toHaveLength(2);
    expect(combo).toContain("b");
    expect(hasBlockedPair(combo)).toBe(false);
    expect(ids({ genre: "horror", category: "romance" }, catalog)).toEqual([]);
    expect(ids({ count: 2, category: "romance", locked: ["d"] }, catalog)).toEqual(["d"]);
  });

  it("falls back to a deterministic scan when random draws keep clashing", () => {
    const catalog: TropeCatalog = {
      tropes: [trope("heavy", { weight: 1_000_000 }), trope("light", { weight: 0.000001 })],
      exclusions: [],
    };
    expect(ids({ count: 2 }, catalog).sort()).toEqual(["heavy", "light"]);
  });
});

describe("locks", () => {
  it("drops unknown, repeated and contradictory locks and caps the total", () => {
    expect(
      resolveLocks(["nope", "heist", "heist", "cozy-low-stakes", "grimdark"]).map((t) => t.id),
    ).toEqual(["heist", "cozy-low-stakes"]);
    const many = TROPE_CATALOG.tropes.filter((t) => t.category === "plot").map((t) => t.id);
    expect(resolveLocks(many)).toHaveLength(MAX_COUNT);
  });

  it("toggles a lock on and off", () => {
    expect(toggleLock(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleLock(["a", "b"], "a")).toEqual(["b"]);
  });

  it("parses comma-separated and repeated lock params", () => {
    expect(parseLockedIds(["heist, Quest", "", "slow-burn", "bad id"])).toEqual([
      "heist",
      "quest",
      "slow-burn",
    ]);
  });
});

describe("query params", () => {
  it("parses valid params from a record or URLSearchParams", () => {
    const expected = {
      seed: "abc-1",
      genre: "sci-fi",
      category: "plot",
      count: 6,
      locked: ["heist", "quest"],
    };
    expect(
      parseTropeGeneratorParams({
        seed: " ABC-1 ",
        genre: "Sci-Fi",
        category: ["plot", "tone"],
        count: "6",
        lock: ["heist", "quest"],
      }),
    ).toEqual(expected);
    expect(
      parseTropeGeneratorParams(
        new URLSearchParams("seed=abc-1&genre=sci-fi&category=plot&count=6&lock=heist,quest"),
      ),
    ).toEqual(expected);
  });

  it("falls back to defaults for missing or invalid values", () => {
    const defaults = { seed: null, genre: ANY, category: ANY, count: DEFAULT_COUNT, locked: [] };
    expect(parseTropeGeneratorParams(undefined)).toEqual(defaults);
    expect(parseTropeGeneratorParams({})).toEqual(defaults);
    expect(
      parseTropeGeneratorParams({
        seed: "no spaces!",
        genre: "western",
        category: "x",
        count: "-3",
        lock: "nope",
      }),
    ).toEqual(defaults);
    expect(parseTropeGeneratorParams({ count: "0" }).count).toBe(1);
    expect(parseTropeGeneratorParams({ count: "99" }).count).toBe(MAX_COUNT);
  });

  it("builds shareable hrefs that round-trip through the parser", () => {
    expect(
      buildTropeGeneratorHref("abc", { genre: ANY, category: ANY, count: DEFAULT_COUNT }, []),
    ).toBe(`${TROPE_GENERATOR_PATH}?seed=abc`);
    const filters = { genre: "horror", category: "setting", count: 3 } as const;
    const href = buildTropeGeneratorHref("xyz", filters, ["isolated-manor", "slow-dread"]);
    expect(href).toBe(
      `${TROPE_GENERATOR_PATH}?seed=xyz&genre=horror&category=setting&count=3&lock=isolated-manor%2Cslow-dread`,
    );
    const parsed = parseTropeGeneratorParams(new URL(href, "https://example.test").searchParams);
    expect(parsed).toEqual({ seed: "xyz", ...filters, locked: ["isolated-manor", "slow-dread"] });
  });
});
