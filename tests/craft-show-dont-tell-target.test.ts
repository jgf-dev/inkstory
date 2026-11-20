import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_MAX_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS } from "../src/lib/ai/generate";
import {
  CRAFT_TOKENS_PER_WORD,
  DEFAULT_CRAFT_OUTPUT_WORDS,
  DIAGNOSIS_WORD_ALLOWANCE,
  SHOW_DONT_TELL_DEFAULT_TARGET_WORDS,
  craftCompletionBudget,
  listCraftTools,
  parseTargetWords,
  toCraftToolDto,
} from "../src/lib/craft";
import {
  SHOW_DONT_TELL_CONDENSE_RATIO,
  SHOW_DONT_TELL_MIN_TARGET_WORDS,
  SHOW_DONT_TELL_TARGET_GROWTH,
  TARGET_WORDS_KEY,
  initialFormValues,
  suggestedTargetWords,
  targetWordsWarning,
  withAdaptiveTarget,
  type CraftToolDto,
} from "../src/lib/craft/client";

const DIAGNOSIS = { mode: "diagnosis_and_prose", suggestedAction: "replace_selection" } as const;
const PROSE = { mode: "prose", suggestedAction: "replace_selection" } as const;

const dto = (id: string) =>
  toCraftToolDto(listCraftTools().find((t) => t.id === id)!) as CraftToolDto;
const sdt = dto("show_dont_tell");

describe("craft target_words parsing (STO-1299)", () => {
  it("treats missing, blank, zero, negative and non-numeric targets as no target", () => {
    for (const raw of [undefined, "", "  ", "0", "-5", "abc", "Infinity"]) {
      expect(parseTargetWords(raw)).toBeUndefined();
    }
    expect(parseTargetWords(" 250 ")).toBe(250);
  });
});

describe("craftCompletionBudget (STO-1299)", () => {
  it("reserves the diagnosis allowance on top of an explicit target", () => {
    const words = SHOW_DONT_TELL_DEFAULT_TARGET_WORDS + DIAGNOSIS_WORD_ALLOWANCE;
    expect(craftCompletionBudget("200", DIAGNOSIS)).toBe(words * CRAFT_TOKENS_PER_WORD);
    expect(craftCompletionBudget("2000", DIAGNOSIS)).toBe(MAX_OUTPUT_TOKENS);
  });

  it("reserves the allowance on top of the default budget when there is no target", () => {
    expect(DEFAULT_CRAFT_OUTPUT_WORDS * CRAFT_TOKENS_PER_WORD).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    const expected =
      (DEFAULT_CRAFT_OUTPUT_WORDS + DIAGNOSIS_WORD_ALLOWANCE) * CRAFT_TOKENS_PER_WORD;
    for (const raw of [undefined, "", "0"]) {
      expect(craftCompletionBudget(raw, DIAGNOSIS)).toBe(expected);
    }
    expect(expected).toBeGreaterThan(DEFAULT_MAX_OUTPUT_TOKENS);
  });

  it("keeps prose tools on the target or the platform default", () => {
    expect(craftCompletionBudget("150", PROSE)).toBe(300);
    expect(craftCompletionBudget("0", PROSE)).toBeUndefined();
    expect(craftCompletionBudget(undefined, PROSE)).toBeUndefined();
    expect(craftCompletionBudget("", null)).toBeUndefined();
  });
});

describe("Show Don't Tell adaptive target (STO-1299)", () => {
  const at = (target: string) => ({ ...initialFormValues(sdt), [TARGET_WORDS_KEY]: target });

  it("tracks the selection between the floor and the contract ceiling", () => {
    expect(SHOW_DONT_TELL_TARGET_GROWTH).toBe(1);
    expect(suggestedTargetWords(sdt, 0)).toBeNull();
    expect(suggestedTargetWords(sdt, 12)).toBe(SHOW_DONT_TELL_MIN_TARGET_WORDS);
    expect(suggestedTargetWords(sdt, 640)).toBe(640);
    expect(suggestedTargetWords(sdt, 3000)).toBe(2000);
  });

  it("seeds from the selection until edited and falls back to the default", () => {
    const values = initialFormValues(sdt);
    expect(values[TARGET_WORDS_KEY]).toBe(String(SHOW_DONT_TELL_DEFAULT_TARGET_WORDS));
    expect(withAdaptiveTarget(sdt, values, 480, false)[TARGET_WORDS_KEY]).toBe("480");
    expect(withAdaptiveTarget(sdt, at("480"), 0, false)[TARGET_WORDS_KEY]).toBe("200");
    expect(withAdaptiveTarget(sdt, at("90"), 480, true)[TARGET_WORDS_KEY]).toBe("90");
  });

  it("warns only when the target would condense the selection", () => {
    expect(SHOW_DONT_TELL_CONDENSE_RATIO).toBe(0.5);
    expect(targetWordsWarning(sdt, at("200"), 400)).toBeNull();
    expect(targetWordsWarning(sdt, at("100"), 100)).toBeNull();
    expect(targetWordsWarning(sdt, at("199"), 400)).toBe(
      "Show Don't Tell would condense this: the target is well below the selection's 400 words. Try about 400.",
    );
    expect(targetWordsWarning(sdt, at("2000"), 2000)).toBeNull();
    expect(targetWordsWarning(sdt, at("2000"), 2500)).toBe(
      "The selection is 2,500 words, above the 2,000-word maximum, so Show Don't Tell will condense it. Select a shorter passage.",
    );
    expect(targetWordsWarning(sdt, at("5"), 400)).toBeNull();
  });

  it("falls back to the contract minimum when a default-floored tool has no default", () => {
    const expand = dto("expand");
    const bare = { ...expand, defaults: {} };
    expect(suggestedTargetWords(bare, 10)).toBe(20);
  });
});
