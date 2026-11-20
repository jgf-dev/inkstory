import { describe, expect, it } from "vite-plus/test";
import { AiError } from "../src/lib/ai/generate";
import {
  parseDiagnosisAndProse,
  shapeCraftResult,
  stripTrailingCommentary,
} from "../src/lib/craft/output";

// STO-1298: boundary edge cases of the diagnosis_and_prose parser.

function malformedError(fn: () => unknown): AiError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("AI_INVALID_RESPONSE");
    expect((err as AiError).status).toBe(502);
    return err as AiError;
  }
  throw new Error("expected a malformed-output error");
}

describe("trailing commentary after REWRITE:", () => {
  it.each([
    "Let me know if you'd like changes.",
    "Feel free to adjust the pacing.",
    "Hope this helps!",
    "I hope this captures the mood.",
    "Would you like me to tighten it further?",
    "If you'd like, I can make it darker.",
    "If you would like me to try another angle, just say.",
    "Happy to revise further.",
    "If you’d like me to soften it, just ask.",
    "Note: I kept the dialogue unchanged.",
    "(Note: the gull is new detail.)",
    "Changes made: replaced 'nervous' with a gesture.",
    "What changed: the emotion is now shown.",
  ])("drops a closing paragraph: %s", (commentary) => {
    expect(
      parseDiagnosisAndProse(
        `DIAGNOSIS:\n- told\nREWRITE:\nHer heel tapped the planks.\n\n${commentary}`,
      ),
    ).toEqual({ diagnosis: "- told", text: "Her heel tapped the planks." });
  });

  it("drops several commentary paragraphs and the separator before them", () => {
    expect(
      parseDiagnosisAndProse(
        "DIAGNOSIS:\n- told\nREWRITE:\nHer heel tapped.\n\nThe gull cried.\n\n---\n\nNote: kept order.\n\nLet me know!",
      ).text,
    ).toBe("Her heel tapped.\n\nThe gull cried.");
    expect(stripTrailingCommentary("Shown.\n***\n\nHope this helps.")).toBe("Shown.");
  });

  it("drops commentary after a fenced rewrite and inside a whole-reply fence", () => {
    expect(
      parseDiagnosisAndProse("DIAGNOSIS:\n- told\nREWRITE:\n```\nShown.\n```\n\nLet me know.").text,
    ).toBe("Shown.");
    expect(
      parseDiagnosisAndProse("```\nDIAGNOSIS:\n- told\nREWRITE:\nShown.\n\nHope this helps.\n```")
        .text,
    ).toBe("Shown.");
    expect(
      parseDiagnosisAndProse("```\nDIAGNOSIS:\n- told\nREWRITE:\nShown.\n```\n\nHope this helps.")
        .text,
    ).toBe("Shown.");
  });

  it("keeps fiction that merely sounds conversational", () => {
    const prose = [
      "Her heel tapped the planks.",
      "I hope she never comes back.",
      '"Let me know when the boat docks," Mara said.',
      "If you listened, you could hear the rigging.",
      "---",
      "Notes of tar drifted off the water.",
    ].join("\n\n");
    expect(parseDiagnosisAndProse(`DIAGNOSIS:\n- told\nREWRITE:\n${prose}`).text).toBe(prose);
  });

  it("never strips the only paragraph and leaves text without commentary as is", () => {
    expect(stripTrailingCommentary("Let me know when you're home, she wrote.")).toBe(
      "Let me know when you're home, she wrote.",
    );
    expect(stripTrailingCommentary("  One.\n\nTwo.\n---  ")).toBe("One.\n\nTwo.\n---");
    // Separators are only dropped once commentary was removed after them.
    expect(stripTrailingCommentary("One.\n\n---")).toBe("One.\n\n---");
    expect(stripTrailingCommentary("One.\n\n```\n\nLet me know.")).toBe("One.");
  });
});

describe("line-start marker collisions", () => {
  it("prefers the upper-case headers over a wrapped 'Rewrite:' diagnosis line", () => {
    expect(
      parseDiagnosisAndProse(
        'DIAGNOSIS:\n- "nervous" names the emotion; a better\nRewrite: would show her hands.\nREWRITE:\nHer knuckles whitened.',
      ),
    ).toEqual({
      diagnosis: '- "nervous" names the emotion; a better\nRewrite: would show her hands.',
      text: "Her knuckles whitened.",
    });
  });

  it("prefers the upper-case headers over prose that starts with 'Diagnosis:'", () => {
    expect(
      parseDiagnosisAndProse(
        "**DIAGNOSIS:**\n- told\n## REWRITE:\nThe doctor's chart read:\nDiagnosis: exhaustion.\nShe laughed.",
      ),
    ).toEqual({
      diagnosis: "- told",
      text: "The doctor's chart read:\nDiagnosis: exhaustion.\nShe laughed.",
    });
  });

  it("falls back to case-insensitive headers when the model does not shout", () => {
    expect(parseDiagnosisAndProse("Diagnosis:\n- told\nRewrite:\nShown.")).toEqual({
      diagnosis: "- told",
      text: "Shown.",
    });
    // Mixed case: strict pass finds only DIAGNOSIS, lenient pass finds one of each.
    expect(parseDiagnosisAndProse("DIAGNOSIS:\n- told\n**Rewrite:**\nShown.")).toEqual({
      diagnosis: "- told",
      text: "Shown.",
    });
  });

  it("still rejects ambiguous output in both passes", () => {
    malformedError(() =>
      parseDiagnosisAndProse("DIAGNOSIS:\n- a\nREWRITE:\nb\nREWRITE:\nc\nDiagnosis: d"),
    );
  });
});

describe("duplicate DIAGNOSIS: sections", () => {
  it("rejects two upper-case diagnosis sections", () => {
    malformedError(() => parseDiagnosisAndProse("DIAGNOSIS:\n- a\nDIAGNOSIS:\n- b\nREWRITE:\nc"));
  });

  it("rejects two diagnosis sections that differ only in case", () => {
    malformedError(() => parseDiagnosisAndProse("Diagnosis:\n- a\ndiagnosis:\n- b\nRewrite:\nc"));
  });
});

describe("malformed-output messaging", () => {
  it("is generic by default so any diagnosis_and_prose tool can use it", () => {
    const err = malformedError(() =>
      shapeCraftResult(
        { mode: "diagnosis_and_prose", suggestedAction: "replace_selection" },
        "No sections.",
      ),
    );
    expect(err.message).toBe(
      "The craft result was not in the expected format (expected one diagnosis and one rewrite section). Nothing was applied; try again.",
    );
    expect(err.message).not.toContain("Show Don't Tell");
  });

  it("names the tool when one is supplied", () => {
    const messages = [
      malformedError(() => parseDiagnosisAndProse("x".repeat(60_001), "Critique")),
      malformedError(() => parseDiagnosisAndProse("REWRITE:\nb\nDIAGNOSIS:\na", "Critique")),
      malformedError(() => parseDiagnosisAndProse("DIAGNOSIS:\n\nREWRITE:\nb", "Critique")),
      malformedError(() => parseDiagnosisAndProse("DIAGNOSIS:\na\nREWRITE:\n", "Critique")),
      malformedError(() => parseDiagnosisAndProse("nothing", "Critique")),
    ].map((err) => err.message);
    expect(messages).toEqual([
      "The Critique result was not in the expected format (output too long). Nothing was applied; try again.",
      "The Critique result was not in the expected format (diagnosis must come before the rewrite). Nothing was applied; try again.",
      "The Critique result was not in the expected format (empty diagnosis). Nothing was applied; try again.",
      "The Critique result was not in the expected format (empty rewrite). Nothing was applied; try again.",
      "The Critique result was not in the expected format (expected one diagnosis and one rewrite section). Nothing was applied; try again.",
    ]);
  });
});
