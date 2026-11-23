import { describe, expect, it } from "vite-plus/test";
import {
  REWRITE_CONCISE_TARGET_GROWTH,
  REWRITE_CONDENSE_RATIO,
  REWRITE_MIN_TARGET_WORDS,
  REWRITE_PRESET_KEY,
  REWRITE_TARGET_GROWTH,
  TARGET_WORDS_KEY,
  initialFormValues,
  suggestedTargetWords,
  targetWordsWarning,
  withAdaptiveTarget,
  type CraftFormValues,
  type CraftToolDto,
} from "../src/lib/craft/client";
import { getCraftTool, toCraftToolDto } from "../src/lib/craft";
import { REWRITE_DEFAULT_PRESET, REWRITE_DEFAULT_TARGET_WORDS } from "../src/lib/craft/tools";

const rewrite = toCraftToolDto(getCraftTool("rewrite")) as CraftToolDto;

/** Rewrite form values with a preset and (optionally) a typed target. */
function form(preset: string, target?: string): CraftFormValues {
  const values: CraftFormValues = { ...initialFormValues(rewrite), [REWRITE_PRESET_KEY]: preset };
  return target === undefined ? values : { ...values, [TARGET_WORDS_KEY]: target };
}

describe("Rewrite adaptive target (STO-1294)", () => {
  it("keeps about the selection's length for the default preset", () => {
    expect(REWRITE_TARGET_GROWTH).toBe(1);
    expect(REWRITE_DEFAULT_PRESET).toBe("more_vivid");
    expect(suggestedTargetWords(rewrite, 0)).toBeNull();
    expect(suggestedTargetWords(rewrite, 5)).toBe(REWRITE_MIN_TARGET_WORDS);
    expect(suggestedTargetWords(rewrite, 520)).toBe(520);
    expect(suggestedTargetWords(rewrite, 520, form("simpler"))).toBe(520);
    expect(suggestedTargetWords(rewrite, 3400, form("stronger_voice"))).toBe(2000);
  });

  it("aims shorter than the selection for more_concise", () => {
    expect(REWRITE_CONCISE_TARGET_GROWTH).toBe(0.6);
    expect(suggestedTargetWords(rewrite, 30, form("more_concise"))).toBe(REWRITE_MIN_TARGET_WORDS);
    expect(suggestedTargetWords(rewrite, 500, form("more_concise"))).toBe(300);
    expect(suggestedTargetWords(rewrite, 501, form("more_concise"))).toBe(301);
    // A blank preset falls back to the tool default (more_vivid).
    expect(suggestedTargetWords(rewrite, 500, form(" "))).toBe(500);
    // No preset and no default: the base growth applies.
    expect(suggestedTargetWords({ ...rewrite, defaults: {} }, 500)).toBe(500);
  });

  it("re-seeds when the selection or preset changes, until the author edits it", () => {
    const values = initialFormValues(rewrite);
    expect(values[TARGET_WORDS_KEY]).toBe(String(REWRITE_DEFAULT_TARGET_WORDS));
    expect(withAdaptiveTarget(rewrite, values, 30, false)[TARGET_WORDS_KEY]).toBe("30");
    expect(withAdaptiveTarget(rewrite, form("more_concise"), 30, false)[TARGET_WORDS_KEY]).toBe(
      "20",
    );
    expect(withAdaptiveTarget(rewrite, form("more_concise"), 700, false)[TARGET_WORDS_KEY]).toBe(
      "420",
    );
    expect(withAdaptiveTarget(rewrite, form("simpler", "420"), 0, false)[TARGET_WORDS_KEY]).toBe(
      "200",
    );
    const edited = form("more_concise", "650");
    expect(withAdaptiveTarget(rewrite, edited, 700, true)).toBe(edited);
  });

  it("warns when the target is well under the preset's suggested length", () => {
    expect(REWRITE_CONDENSE_RATIO).toBe(0.5);
    // more_vivid: the old fixed 200 on a 600-word passage would truncate.
    expect(targetWordsWarning(rewrite, form("more_vivid", "200"), 600)).toBe(
      "Rewrite would condense this: the target is well below the selection's 600 words. Try about 600.",
    );
    expect(targetWordsWarning(rewrite, form("more_vivid", "300"), 600)).toBeNull();
    // more_concise expects condensing, so the threshold is half of 0.6×.
    expect(targetWordsWarning(rewrite, form("more_concise", "200"), 600)).toBeNull();
    expect(targetWordsWarning(rewrite, form("more_concise", "179"), 600)).toBe(
      "Rewrite would condense this: the target is well below the selection's 600 words. Try about 360.",
    );
    expect(targetWordsWarning(rewrite, form("simpler", "2000"), 2600)).toBe(
      "The selection is 2,600 words, above the 2,000-word maximum, so Rewrite will condense it. Select a shorter passage.",
    );
    expect(targetWordsWarning(rewrite, form("simpler", "5"), 600)).toBeNull();
    expect(targetWordsWarning(rewrite, form("simpler", "200"), 0)).toBeNull();
  });
});
