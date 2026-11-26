import { describe, expect, it } from "vite-plus/test";
import {
  ANY,
  EXPLICIT_PATTERNS,
  GENRE_MATCH_BOOST,
  HEAT_LEVELS,
  MAX_LOCKS,
  MINOR_PATTERNS,
  NON_CONSENT_PATTERNS,
  PAIRINGS,
  PROMPT_CATALOG,
  PROMPT_GENERATOR_PATH,
  PROMPT_GENRES,
  PROMPT_SLOTS,
  PROMPT_TROPES,
  SLOT_SIZES,
  assemblePrompt,
  buildPromptGeneratorHref,
  findFragment,
  findViolations,
  fragmentWeight,
  generatePrompt,
  matchesGenre,
  matchesHardFilters,
  matchesTrope,
  parseLockedIds,
  parsePromptGeneratorParams,
  resolveLocks,
  rngKey,
  slotPool,
  statesTwoAdultAges,
  toggleLock,
  type GeneratedPrompt,
  type GenreFilter,
  type HeatFilter,
  type PairingFilter,
  type PromptCatalog,
  type PromptFragment,
  type PromptGeneratorOptions,
  type TropeFilter,
} from "../src/lib/tools/adult-prompts";

const base: PromptGeneratorOptions = {
  seed: "seed-1",
  pairing: ANY,
  heat: ANY,
  genre: ANY,
  trope: ANY,
  locked: [],
};

const PAIRING_FILTERS: PairingFilter[] = [ANY, ...PAIRINGS];
const HEAT_FILTERS: HeatFilter[] = [ANY, ...HEAT_LEVELS];
const GENRE_FILTERS: GenreFilter[] = [ANY, ...PROMPT_GENRES];
const TROPE_FILTERS: TropeFilter[] = [ANY, ...PROMPT_TROPES];
const SEEDS = Array.from({ length: 12 }, (_, i) => `s${i}`);

function fragmentIds(prompt: GeneratedPrompt): string[] {
  return prompt.slots.flatMap((slot) => slot.fragments.map(({ fragment }) => fragment.id));
}

function slotIds(prompt: GeneratedPrompt, slot: string): string[] {
  return (
    prompt.slots
      .find((entry) => entry.slot === slot)
      ?.fragments.map(({ fragment }) => fragment.id) ?? []
  );
}

function fragment(id: string, overrides: Partial<PromptFragment> = {}): PromptFragment {
  return {
    id,
    slot: "setting",
    text: `${id} text`,
    pairings: [],
    heats: [],
    genres: [],
    tropes: [],
    weight: 1,
    ...overrides,
  };
}

function* allFilterCombos() {
  for (const pairing of PAIRING_FILTERS)
    for (const heat of HEAT_FILTERS)
      for (const genre of GENRE_FILTERS)
        for (const trope of TROPE_FILTERS) yield { pairing, heat, genre, trope };
}

describe("adult prompt catalog content rules", () => {
  const { fragments } = PROMPT_CATALOG;

  it("has unique ids, valid tags and positive weights", () => {
    expect(new Set(fragments.map((f) => f.id)).size).toBe(fragments.length);
    for (const f of fragments) {
      expect(f.id).toMatch(/^[a-z0-9-]+$/);
      expect(PROMPT_SLOTS).toContain(f.slot);
      expect(f.text.trim().length).toBeGreaterThan(10);
      expect(f.weight).toBeGreaterThan(0);
      for (const p of f.pairings) expect(PAIRINGS).toContain(p);
      for (const h of f.heats) expect(HEAT_LEVELS).toContain(h);
      for (const g of f.genres) expect(PROMPT_GENRES).toContain(g);
      for (const t of f.tropes) expect(PROMPT_TROPES).toContain(t);
    }
  });

  it("covers every slot, and each pairing has exactly-one-pairing fragments", () => {
    for (const slot of PROMPT_SLOTS) {
      expect(fragments.filter((f) => f.slot === slot).length).toBeGreaterThanOrEqual(5);
    }
    for (const f of fragments.filter((entry) => entry.slot === "pairing")) {
      expect(f.pairings).toHaveLength(1);
    }
    for (const f of fragments.filter((entry) => entry.slot !== "pairing")) {
      expect(f.pairings).toEqual([]);
    }
  });

  it("states two adult ages in every pairing fragment", () => {
    for (const f of fragments.filter((entry) => entry.slot === "pairing")) {
      expect(statesTwoAdultAges(f.text), f.id).toBe(true);
    }
  });

  it("has no minors, non-consent or explicit wording in any fragment", () => {
    for (const f of fragments) {
      expect(findViolations(`${f.id} ${f.text}`), f.id).toEqual([]);
    }
  });

  it("gives every trope at least one genre-neutral setup", () => {
    for (const trope of PROMPT_TROPES) {
      expect(
        fragments.some(
          (f) => f.slot === "setup" && f.genres.length === 0 && f.tropes.includes(trope),
        ),
        trope,
      ).toBe(true);
    }
  });
});

describe("content guards", () => {
  it.each([
    "a teenager on holiday",
    "two eighteen-year-old seniors",
    "she is 17 years old",
    "a schoolgirl outfit",
    "a college dorm room",
    "the young-looking new hire",
    "a barely legal fantasy",
    "her stepbrother",
    "an underage character",
    "playing with a little girl",
  ])("flags minor or age-ambiguous framing: %s", (text) => {
    expect(findViolations(text).some((v) => v.rule === "minor")).toBe(true);
  });

  it.each([
    "a dubcon scene",
    "non-consent play",
    "he was forced to stay",
    "she is drugged at the party",
    "taken captive by bandits",
    "against her will",
    "blackmailed into it",
  ])("flags non-consent themes: %s", (text) => {
    expect(findViolations(text).some((v) => v.rule === "non-consent")).toBe(true);
  });

  it("flags explicit vocabulary and lets forced proximity through", () => {
    expect(findViolations("an nsfw smut scene").map((v) => v.rule)).toContain("explicit");
    expect(findViolations("a forced proximity romance between adults in their thirties")).toEqual(
      [],
    );
    expect(MINOR_PATTERNS.length).toBeGreaterThan(0);
    expect(NON_CONSENT_PATTERNS.length).toBeGreaterThan(0);
    expect(EXPLICIT_PATTERNS.length).toBeGreaterThan(0);
  });

  it("requires two adult ages", () => {
    expect(statesTwoAdultAges("a baker in her thirties and a chef in his forties")).toBe(true);
    expect(statesTwoAdultAges("a baker in her thirties and a chef")).toBe(false);
    expect(statesTwoAdultAges("a baker and a chef")).toBe(false);
  });
});

describe("generatePrompt", () => {
  it("is deterministic for the same seed, filters and locks", () => {
    const options = {
      ...base,
      pairing: "ff" as const,
      heat: "steamy" as const,
      locked: ["praise"],
    };
    expect(generatePrompt(options)).toEqual(generatePrompt(options));
    expect(generatePrompt(options).text).toBe(generatePrompt({ ...options }).text);
  });

  it("varies with the seed", () => {
    const texts = new Set(SEEDS.map((seed) => generatePrompt({ ...base, seed }).text));
    expect(texts.size).toBeGreaterThan(SEEDS.length / 2);
  });

  it("fills every slot with distinct, filter-respecting fragments for every filter combo", () => {
    for (const filters of allFilterCombos()) {
      for (const seed of SEEDS.slice(0, 2)) {
        const prompt = generatePrompt({ ...base, ...filters, seed });
        const ids = fragmentIds(prompt);
        expect(new Set(ids).size).toBe(ids.length);
        for (const { slot, fragments } of prompt.slots) {
          expect(fragments, `${slot} ${JSON.stringify(filters)}`).toHaveLength(SLOT_SIZES[slot]);
          for (const { fragment: f } of fragments) {
            expect(f.slot).toBe(slot);
            expect(matchesHardFilters(f, filters)).toBe(true);
            if (slot === "setup") expect(matchesTrope(f, filters)).toBe(true);
          }
        }
        expect(findViolations(prompt.text)).toEqual([]);
      }
    }
  });

  it("respects the genre filter wherever the catalog has a match", () => {
    for (const genre of PROMPT_GENRES) {
      for (const seed of SEEDS) {
        const prompt = generatePrompt({ ...base, genre, seed });
        for (const { fragment: f } of prompt.slots.flatMap((s) => s.fragments)) {
          expect(matchesGenre(f, genre), `${genre} ${f.id}`).toBe(true);
        }
      }
    }
  });

  it("keeps locked fragments across rerolls and leaves other slots on their own stream", () => {
    const first = generatePrompt(base);
    const settingId = slotIds(first, "setting")[0];
    const toneId = slotIds(first, "tone")[0];
    for (const seed of SEEDS) {
      const rerolled = generatePrompt({ ...base, seed, locked: [settingId, toneId] });
      expect(slotIds(rerolled, "setting")).toEqual([settingId]);
      expect(slotIds(rerolled, "tone")).toEqual([toneId]);
      expect(rerolled.slots.find((s) => s.slot === "setting")?.fragments[0].locked).toBe(true);
      const unlocked = generatePrompt({ ...base, seed });
      expect(slotIds(rerolled, "setup")).toEqual(slotIds(unlocked, "setup"));
      expect(slotIds(rerolled, "pairing")).toEqual(slotIds(unlocked, "pairing"));
    }
  });

  it("locks one tension tag and draws a different one beside it", () => {
    for (const seed of SEEDS) {
      const prompt = generatePrompt({ ...base, seed, locked: ["banter"] });
      const tension = slotIds(prompt, "tension");
      expect(tension[0]).toBe("banter");
      expect(tension).toHaveLength(2);
      expect(tension[1]).not.toBe("banter");
    }
  });

  it("keeps a locked fragment even when it is outside the genre or trope filter", () => {
    const prompt = generatePrompt({
      ...base,
      genre: "historical",
      trope: "rivals",
      locked: ["rooftop-bar", "storm-one-bed"],
    });
    expect(slotIds(prompt, "setting")).toEqual(["rooftop-bar"]);
    expect(slotIds(prompt, "setup")).toEqual(["storm-one-bed"]);
  });

  it("relaxes genre before trope, and both before giving up", () => {
    const catalog: PromptCatalog = {
      fragments: [
        fragment("a", { slot: "setup", genres: ["fantasy"], tropes: ["rivals"] }),
        fragment("b", { slot: "setup", genres: ["historical"], tropes: ["slow-burn"] }),
      ],
    };
    const filters = { ...base, genre: "historical" as const, trope: "rivals" as const };
    expect(slotPool("setup", filters, catalog).map((f) => f.id)).toEqual(["a"]);
    expect(slotPool("setup", { ...filters, trope: "slow-burn" }, catalog).map((f) => f.id)).toEqual(
      ["b"],
    );
    expect(
      slotPool("setup", { ...filters, trope: "grumpy-sunshine" }, catalog).map((f) => f.id),
    ).toEqual(["a", "b"]);
  });

  it("returns empty slots and a still-valid prompt for an empty catalog", () => {
    const prompt = generatePrompt(base, { fragments: [] });
    expect(prompt.slots.every((s) => s.fragments.length === 0)).toBe(true);
    expect(prompt.text).toBe(
      "Write a scene for an adult romance. Every character is a fictional, consenting adult.",
    );
  });

  it("boosts fragments written for the chosen genre", () => {
    const f = fragment("x", { genres: ["fantasy"], weight: 2 });
    expect(fragmentWeight(f, "fantasy")).toBe(2 * GENRE_MATCH_BOOST);
    expect(fragmentWeight(f, ANY)).toBe(2);
    expect(fragmentWeight(fragment("y", { weight: 2 }), "fantasy")).toBe(2);
  });
});

describe("assemblePrompt", () => {
  it("labels each part and names the genre", () => {
    const text = assemblePrompt(
      [
        {
          slot: "pairing",
          fragments: [{ fragment: fragment("p", { text: "a pair" }), locked: false }],
        },
        {
          slot: "tension",
          fragments: [
            { fragment: fragment("t1", { text: "banter" }), locked: false },
            { fragment: fragment("t2", { text: "a dare" }), locked: false },
          ],
        },
      ],
      "dark-romance",
    );
    expect(text).toBe(
      "Write a scene for a dark romance. Characters: A pair. Tension: Banter; a dare. Every character is a fictional, consenting adult.",
    );
  });
});

describe("locks", () => {
  it("drops unknown, repeated, over-capacity and hard-filter-breaking locks", () => {
    expect(
      resolveLocks(["nope", "banter", "banter", "dare", "praise", "storm-one-bed", "dare"], {
        pairing: ANY,
        heat: ANY,
      }).map((f) => f.id),
    ).toEqual(["banter", "dare", "storm-one-bed"]);
    expect(
      resolveLocks(["chef-critic-ff", "firefighter-nurse"], { pairing: "mm", heat: ANY }).map(
        (f) => f.id,
      ),
    ).toEqual(["firefighter-nurse"]);
    expect(
      resolveLocks(["safeword", "closed-door"], { pairing: ANY, heat: "sweet" }).map((f) => f.id),
    ).toEqual(["closed-door"]);
  });

  it("finds fragments by id", () => {
    expect(findFragment("banter")?.slot).toBe("tension");
    expect(findFragment("missing")).toBeUndefined();
  });

  it("caps total locks at the number of slot positions", () => {
    expect(MAX_LOCKS).toBe(6);
  });
});

describe("params", () => {
  it("parses filters, seed and locks and falls back on junk", () => {
    expect(
      parsePromptGeneratorParams({
        seed: "Abc-1",
        pairing: "MM",
        heat: "spicy",
        genre: "dark-romance",
        trope: "rivals",
        lock: ["banter,chef-critic-ff", "safeword"],
      }),
    ).toEqual({
      seed: "abc-1",
      pairing: "mm",
      heat: "spicy",
      genre: "dark-romance",
      trope: "rivals",
      locked: ["banter", "safeword"],
    });
    expect(
      parsePromptGeneratorParams({
        seed: "bad seed!",
        pairing: "xy",
        heat: "hot",
        genre: "",
        trope: "x",
      }),
    ).toEqual({ seed: null, pairing: ANY, heat: ANY, genre: ANY, trope: ANY, locked: [] });
    expect(parsePromptGeneratorParams(undefined).seed).toBeNull();
  });

  it("reads URLSearchParams with repeated locks", () => {
    const parsed = parsePromptGeneratorParams(
      new URLSearchParams("seed=x&pairing=ff&lock=banter&lock=dare"),
    );
    expect(parsed).toMatchObject({ seed: "x", pairing: "ff", locked: ["banter", "dare"] });
  });

  it("trims empty lock entries", () => {
    expect(parseLockedIds([" banter , ,DARE"], { pairing: ANY, heat: ANY })).toEqual([
      "banter",
      "dare",
    ]);
  });

  it("builds shareable hrefs that round-trip", () => {
    expect(buildPromptGeneratorHref("abc", base, [])).toBe(`${PROMPT_GENERATOR_PATH}?seed=abc`);
    const filters = {
      pairing: "mf",
      heat: "sweet",
      genre: "historical",
      trope: "slow-burn",
    } as const;
    const href = buildPromptGeneratorHref("abc", filters, ["banter", "closed-door"]);
    expect(href).toBe(
      `${PROMPT_GENERATOR_PATH}?seed=abc&pairing=mf&heat=sweet&genre=historical&trope=slow-burn&lock=banter%2Cclosed-door`,
    );
    const parsed = parsePromptGeneratorParams(new URL(href, "https://x.test").searchParams);
    expect(parsed).toEqual({ seed: "abc", ...filters, locked: ["banter", "closed-door"] });
  });

  it("toggles locks and keys the rng per slot", () => {
    expect(toggleLock(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleLock(["a", "b"], "a")).toEqual(["b"]);
    expect(rngKey(base, "tone")).toBe("seed-1|any|any|any|any|tone");
  });
});
