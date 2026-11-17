import { describe, expect, it } from "vite-plus/test";
import {
  EXPAND_TARGET_GROWTH,
  TARGET_WORDS_KEY,
  initialFormValues,
  suggestedTargetWords,
  targetWordsWarning,
  withAdaptiveTarget,
  type CraftToolDto,
} from "../src/lib/craft/client";
import { listCraftTools, toCraftToolDto } from "../src/lib/craft";
import { EXPAND_DEFAULT_TARGET_WORDS } from "../src/lib/craft/tools";

const dto = (id: string) =>
  toCraftToolDto(listCraftTools().find((t) => t.id === id)!) as CraftToolDto;
const expand = dto("expand");
const describeTool = dto("describe");

describe("Expand adaptive target (STO-1295)", () => {
  it("grows with the selection between the default and the contract ceiling", () => {
    expect(EXPAND_TARGET_GROWTH).toBe(1.5);
    expect(suggestedTargetWords(expand, 0)).toBeNull();
    expect(suggestedTargetWords(expand, 50)).toBe(EXPAND_DEFAULT_TARGET_WORDS);
    expect(suggestedTargetWords(expand, 300)).toBe(450);
    expect(suggestedTargetWords(expand, 301)).toBe(452);
    expect(suggestedTargetWords(expand, 1500)).toBe(2000);
  });

  it("leaves non-lengthening tools alone", () => {
    expect(suggestedTargetWords(describeTool, 500)).toBeNull();
    const values = initialFormValues(describeTool);
    expect(withAdaptiveTarget(describeTool, values, 500, false)).toBe(values);
    expect(targetWordsWarning(describeTool, values, 5000)).toBeNull();
  });

  it("follows the selection until the author edits the target", () => {
    const values = initialFormValues(expand);
    expect(values[TARGET_WORDS_KEY]).toBe("300");
    expect(withAdaptiveTarget(expand, values, 400, false)[TARGET_WORDS_KEY]).toBe("600");
    expect(withAdaptiveTarget(expand, values, 10, false)).toBe(values);
    const stale = { ...values, [TARGET_WORDS_KEY]: "600" };
    expect(withAdaptiveTarget(expand, stale, 0, false)[TARGET_WORDS_KEY]).toBe("300");
    const edited = { ...values, [TARGET_WORDS_KEY]: "250" };
    expect(withAdaptiveTarget(expand, edited, 400, true)).toBe(edited);
  });

  it("warns when the target would condense the selection", () => {
    const at = (target: string) => ({ ...initialFormValues(expand), [TARGET_WORDS_KEY]: target });
    expect(targetWordsWarning(expand, at("300"), 0)).toBeNull();
    expect(targetWordsWarning(expand, at("301"), 300)).toBeNull();
    expect(targetWordsWarning(expand, at("300"), 300)).toBe(
      "Expand would shorten this: the target is at or below the selection's 300 words. Try 450 or more.",
    );
    expect(targetWordsWarning(expand, at(" "), 1200)).toMatch(
      /selection's 1,200 words\. Try 1,800/,
    );
    expect(targetWordsWarning(expand, at("2000"), 2400)).toBe(
      "The selection is 2,400 words, at or above the 2,000-word maximum, so Expand can't lengthen it. Select a shorter passage.",
    );
  });

  it("leaves invalid targets to form validation", () => {
    const at = (target: string) => ({ ...initialFormValues(expand), [TARGET_WORDS_KEY]: target });
    expect(targetWordsWarning(expand, at("5"), 400)).toBeNull();
    expect(targetWordsWarning(expand, at("abc"), 400)).toBeNull();
    expect(targetWordsWarning(expand, at("9999"), 400)).toBeNull();
  });
});
