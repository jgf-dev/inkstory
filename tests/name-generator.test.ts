import { describe, expect, it } from "vite-plus/test";
import {
  ANY_FLAVOR,
  DEFAULT_COUNT,
  GENDERS,
  GENRES,
  GENRE_DEFINITIONS,
  MAX_COUNT,
  NAME_GENERATOR_PATH,
  NAME_TYPES,
  SEED_MAX_LENGTH,
  buildNameGeneratorHref,
  buildSyllableName,
  clampCount,
  createRandomSeed,
  createRng,
  generateNames,
  getGenreDefinition,
  hashString,
  isFlavorForGenre,
  joinSyllables,
  nextSeed,
  normalizeSeed,
  parseNameGeneratorParams,
  pickRanked,
  pickWeighted,
  randomInt,
  type NameGeneratorOptions,
} from "../src/lib/tools/name-generator";

const base: NameGeneratorOptions = {
  seed: "seed-1",
  genre: "fantasy",
  gender: "any",
  flavor: ANY_FLAVOR,
  type: "full",
  count: 12,
};

function names(overrides: Partial<NameGeneratorOptions> = {}) {
  return generateNames({ ...base, ...overrides });
}

describe("seeded rng", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = createRng("alpha");
    const b = createRng("alpha");
    const c = createRng("beta");
    const seqA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seqA);
    expect([c(), c(), c()]).not.toEqual(seqA);
    for (const value of seqA) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("hashes strings to stable unsigned 32-bit values", () => {
    expect(hashString("")).toBe(0x811c9dc5);
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
    expect(hashString("anything")).toBeGreaterThanOrEqual(0);
  });

  it("randomInt stays within bounds", () => {
    const rng = createRng("ints");
    for (let i = 0; i < 200; i += 1) {
      const value = randomInt(rng, 5);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(5);
    }
  });

  it("pickWeighted honours weights and edge cases", () => {
    expect(() => pickWeighted(createRng("x"), [])).toThrow();
    expect(pickWeighted(() => 0.5, [{ value: "only-zero", weight: 0 }])).toBe("only-zero");
    expect(
      pickWeighted(
        () => 0.99,
        [
          { value: "a", weight: 1 },
          { value: "never", weight: -5 },
          { value: "b", weight: 1 },
        ],
      ),
    ).toBe("b");
    expect(
      pickWeighted(
        () => 0,
        [
          { value: "a", weight: 1 },
          { value: "b", weight: 1 },
        ],
      ),
    ).toBe("a");
    // Guards against float drift past the last bucket.
    expect(
      pickWeighted(
        () => 1,
        [
          { value: "a", weight: 1 },
          { value: "z", weight: 1 },
        ],
      ),
    ).toBe("z");

    const rng = createRng("weights");
    let heavy = 0;
    for (let i = 0; i < 1000; i += 1) {
      if (
        pickWeighted(rng, [
          { value: "h", weight: 9 },
          { value: "l", weight: 1 },
        ]) === "h"
      ) {
        heavy += 1;
      }
    }
    expect(heavy).toBeGreaterThan(800);
  });

  it("pickRanked favours earlier entries", () => {
    expect(() => pickRanked(createRng("x"), [])).toThrow();
    expect(pickRanked(createRng("x"), ["solo"])).toBe("solo");
    const rng = createRng("ranked");
    const counts = { a: 0, b: 0 };
    for (let i = 0; i < 2000; i += 1) counts[pickRanked(rng, ["a", "b"] as const)] += 1;
    expect(counts.a).toBeGreaterThan(counts.b);
  });
});

describe("wordlists", () => {
  it("cover every genre with flavors and non-empty lists without duplicates", () => {
    expect(GENRE_DEFINITIONS.map((genre) => genre.id)).toEqual([...GENRES]);
    for (const genre of GENRE_DEFINITIONS) {
      expect(genre.flavors.length).toBeGreaterThanOrEqual(2);
      for (const flavor of genre.flavors) {
        const lists = [
          flavor.firstNames.feminine,
          flavor.firstNames.masculine,
          flavor.firstNames.neutral,
          flavor.surnames,
        ];
        for (const list of lists) {
          expect(list.length).toBeGreaterThan(0);
          expect(new Set(list).size).toBe(list.length);
        }
      }
    }
  });

  it("gives fantasy syllable-based generation", () => {
    for (const flavor of getGenreDefinition("fantasy").flavors) {
      expect(flavor.syllables).toBeDefined();
      expect(flavor.syllableShare).toBeGreaterThan(0);
    }
  });
});

describe("generateNames", () => {
  it("returns the same batch for the same seed and filters", () => {
    for (const genre of GENRES) {
      expect(names({ genre })).toEqual(names({ genre }));
    }
  });

  it("returns a different batch for a different seed or filters", () => {
    const first = names().map((entry) => entry.name);
    expect(names({ seed: "seed-2" }).map((entry) => entry.name)).not.toEqual(first);
    expect(names({ genre: "modern" }).map((entry) => entry.name)).not.toEqual(first);
  });

  it("never repeats a name within a batch, across all filter combinations", () => {
    for (const genre of GENRES) {
      for (const gender of GENDERS) {
        for (const type of NAME_TYPES) {
          const batch = names({ genre, gender, type, count: MAX_COUNT });
          const keys = batch.map((entry) => entry.name.toLowerCase());
          expect(new Set(keys).size).toBe(keys.length);
          expect(batch.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("respects the name type", () => {
    for (const entry of names({ type: "first", genre: "modern" })) {
      expect(entry.last).toBeNull();
      expect(entry.name).toBe(entry.first);
    }
    for (const entry of names({ type: "last", genre: "modern" })) {
      expect(entry.first).toBeNull();
      expect(entry.name).toBe(entry.last);
    }
    for (const entry of names({ type: "full", genre: "modern" })) {
      expect(entry.name).toBe(`${entry.first} ${entry.last}`);
    }
  });

  it("respects the gender presentation using the bundled lists", () => {
    const flavor = getGenreDefinition("modern").flavors[0];
    for (const gender of ["feminine", "masculine", "neutral"] as const) {
      const batch = names({ genre: "modern", flavor: flavor.id, gender, type: "first" });
      for (const entry of batch) {
        expect(entry.gender).toBe(gender);
        expect(flavor.firstNames[gender]).toContain(entry.first);
      }
    }
    const mixed = new Set(names({ count: MAX_COUNT }).map((entry) => entry.gender));
    expect(mixed.size).toBeGreaterThan(1);
  });

  it("respects the culture/era flavor and mixes flavors for any", () => {
    for (const genre of GENRES) {
      for (const flavor of getGenreDefinition(genre).flavors) {
        for (const entry of names({ genre, flavor: flavor.id })) {
          expect(entry.flavor).toBe(flavor.id);
        }
      }
    }
    const mixed = new Set(names({ genre: "historical", count: MAX_COUNT }).map((e) => e.flavor));
    expect(mixed.size).toBeGreaterThan(1);
  });

  it("uses list names for list-only flavors and syllable names for fantasy", () => {
    const colonist = getGenreDefinition("sci-fi").flavors.find((f) => f.id === "colonist")!;
    for (const entry of names({ genre: "sci-fi", flavor: "colonist", gender: "feminine" })) {
      expect(colonist.firstNames.feminine).toContain(entry.first);
      expect(colonist.surnames).toContain(entry.last);
    }
    const lyrical = getGenreDefinition("fantasy").flavors.find((f) => f.id === "lyrical")!;
    const firsts = names({
      flavor: "lyrical",
      gender: "feminine",
      type: "first",
      count: MAX_COUNT,
    });
    const invented = firsts.filter((entry) => !lyrical.firstNames.feminine.includes(entry.first!));
    expect(invented.length).toBeGreaterThan(0);
    const lasts = names({ flavor: "lyrical", type: "last", count: MAX_COUNT });
    expect(lasts.some((entry) => !lyrical.surnames.includes(entry.last!))).toBe(true);
  });

  it("clamps the requested count", () => {
    expect(names({ count: 3 })).toHaveLength(3);
    expect(names({ count: 0 })).toHaveLength(1);
    expect(names({ count: 999 })).toHaveLength(MAX_COUNT);
    expect(names({ count: Number.NaN })).toHaveLength(DEFAULT_COUNT);
    expect(clampCount(4.7)).toBe(4);
  });

  it("stops when a filter set runs out of unique names", () => {
    const pool = getGenreDefinition("modern").flavors.find((f) => f.id === "nordic")!;
    const batch = names({
      genre: "modern",
      flavor: "nordic",
      gender: "neutral",
      type: "first",
      count: MAX_COUNT,
    });
    expect(batch.length).toBeLessThanOrEqual(pool.firstNames.neutral.length);
    expect(batch.length).toBeGreaterThan(0);
  });
});

describe("buildSyllableName", () => {
  it("capitalizes, collapses tripled letters and caps the length", () => {
    const syllables = {
      onsets: ["aa"],
      middles: ["aaaaaaaaaaaaaa"],
      endings: { feminine: ["a"], masculine: ["a"], neutral: ["a"] },
    };
    const name = buildSyllableName(() => 0.99, syllables, "neutral");
    expect(name.startsWith("A")).toBe(true);
    expect(name).not.toMatch(/aaa/i);
    expect(name.length).toBeLessThanOrEqual(12);

    const long = { ...syllables, onsets: ["bcd"], middles: ["efghij"] };
    expect(buildSyllableName(() => 0.99, long, "feminine")).toHaveLength(12);
  });
});

describe("joinSyllables", () => {
  const rng = () => 0;
  it("adds a linking vowel after a vowelless head or before a consonant cluster", () => {
    expect(joinSyllables(rng, "Thr", "gun")).toBe("Thragun");
    expect(joinSyllables(rng, "Bal", "dris")).toBe("Baladris");
  });
  it("keeps natural joins and merges a repeated boundary vowel", () => {
    expect(joinSyllables(rng, "Ith", "wen")).toBe("Ithwen");
    expect(joinSyllables(rng, "Mir", "ael")).toBe("Mirael");
    expect(joinSyllables(rng, "Fae", "elle")).toBe("Faelle");
    expect(joinSyllables(rng, "Kyr", "ia")).toBe("Kyria");
    expect(joinSyllables(rng, "Lo", "")).toBe("Lo");
  });
});

describe("query params", () => {
  it("parses valid params from a record or URLSearchParams", () => {
    const expected = {
      seed: "abc-123",
      genre: "sci-fi",
      gender: "neutral",
      flavor: "alien",
      type: "first",
      count: 5,
    };
    expect(
      parseNameGeneratorParams({
        seed: " ABC-123 ",
        genre: "Sci-Fi",
        gender: ["neutral", "feminine"],
        flavor: "ALIEN",
        type: "first",
        count: "5",
      }),
    ).toEqual(expected);
    expect(
      parseNameGeneratorParams(
        new URLSearchParams(
          "seed=abc-123&genre=sci-fi&gender=neutral&flavor=alien&type=first&count=5",
        ),
      ),
    ).toEqual(expected);
  });

  it("falls back to defaults for missing or invalid values", () => {
    const defaults = {
      seed: null,
      genre: "fantasy",
      gender: "any",
      flavor: ANY_FLAVOR,
      type: "full",
      count: DEFAULT_COUNT,
    };
    expect(parseNameGeneratorParams(undefined)).toEqual(defaults);
    expect(parseNameGeneratorParams({})).toEqual(defaults);
    expect(parseNameGeneratorParams(new URLSearchParams())).toEqual(defaults);
    expect(
      parseNameGeneratorParams({
        seed: "bad seed!",
        genre: "western",
        gender: "other",
        flavor: "<script>",
        type: "middle",
        count: "-3",
      }),
    ).toEqual(defaults);
    expect(parseNameGeneratorParams({ count: "1e3" }).count).toBe(DEFAULT_COUNT);
    expect(parseNameGeneratorParams({ count: "500" }).count).toBe(MAX_COUNT);
  });

  it("drops a flavor that belongs to another genre", () => {
    expect(parseNameGeneratorParams({ genre: "modern", flavor: "alien" }).flavor).toBe(ANY_FLAVOR);
    expect(isFlavorForGenre("modern", "nordic")).toBe(true);
    expect(isFlavorForGenre("modern", ANY_FLAVOR)).toBe(true);
    expect(isFlavorForGenre("fantasy", "nordic")).toBe(false);
  });

  it("normalizes seeds", () => {
    expect(normalizeSeed(undefined)).toBeNull();
    expect(normalizeSeed("   ")).toBeNull();
    expect(normalizeSeed("x".repeat(SEED_MAX_LENGTH + 1))).toBeNull();
    expect(normalizeSeed("x".repeat(SEED_MAX_LENGTH))).toBe("x".repeat(SEED_MAX_LENGTH));
    expect(normalizeSeed("Dragon-7")).toBe("dragon-7");
    expect(normalizeSeed("a/b")).toBeNull();
  });

  it("builds shareable hrefs that round-trip through the parser", () => {
    const filters = {
      genre: "historical",
      gender: "feminine",
      flavor: "victorian",
      type: "last",
      count: 8,
    } as const;
    const href = buildNameGeneratorHref("s1", filters);
    expect(href).toBe(
      `${NAME_GENERATOR_PATH}?seed=s1&genre=historical&gender=feminine&flavor=victorian&type=last&count=8`,
    );
    const url = new URL(href, "https://syncodex.xyz");
    expect(url.pathname).toBe(NAME_GENERATOR_PATH);
    expect(parseNameGeneratorParams(url.searchParams)).toEqual({ seed: "s1", ...filters });

    const minimal = buildNameGeneratorHref("s2", {
      genre: "fantasy",
      gender: "any",
      flavor: ANY_FLAVOR,
      type: "full",
      count: DEFAULT_COUNT,
    });
    expect(minimal).toBe(`${NAME_GENERATOR_PATH}?seed=s2&genre=fantasy`);
  });

  it("derives a deterministic, valid next seed", () => {
    expect(nextSeed("abc")).toBe(nextSeed("abc"));
    expect(nextSeed("abc")).not.toBe("abc");
    expect(normalizeSeed(nextSeed("abc"))).toBe(nextSeed("abc"));
  });

  it("creates random seeds from Web Crypto or an injected source", () => {
    expect(createRandomSeed((array) => array.fill(35))).toBe("z");
    const seed = createRandomSeed();
    expect(normalizeSeed(seed)).toBe(seed);
  });
});
