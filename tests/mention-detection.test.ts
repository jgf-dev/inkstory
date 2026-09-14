import { describe, expect, it } from "vite-plus/test";
import { detectMentionsInText, type CandidateEntity } from "../src/lib/codex/mention-detection";

describe("Mention Detection Service (STO-1152)", () => {
  const dummyEntries: CandidateEntity[] = [
    {
      id: "char-mara",
      name: "Mara Vance",
      aliases: [{ name: "The Glass Weaver" }, { name: "Mara" }, "Weaver"],
    },
    {
      id: "char-corvus",
      name: "Master Corvus",
      aliases: ["Corvus", { name: "The Raven Keeper" }],
    },
    {
      id: "item-quill",
      name: "Glass Weaver's Quill",
      aliases: [{ name: "The Iridescent Stylus" }],
    },
    {
      id: "loc-archives",
      name: "The Sunken Archives",
      aliases: ["Archives", "Sunken Archives"],
    },
    {
      id: "char-art",
      name: "Art",
    },
  ];

  describe("Core Detection & Properties", () => {
    it("detects primary names correctly with exact character positions", () => {
      const text = "Master Corvus arrived at dawn.";
      const result = detectMentionsInText(text, dummyEntries);

      expect(result.matchedEntryIds).toEqual(["char-corvus"]);
      expect(result.matches).toHaveLength(1);
      const match = result.matches[0];
      expect(match.entryId).toBe("char-corvus");
      expect(match.matchedText).toBe("Master Corvus");
      expect(match.originalText).toBe("Master Corvus");
      expect(match.startIndex).toBe(0);
      expect(match.endIndex).toBe(13);
      expect(text.substring(match.startIndex, match.endIndex)).toBe("Master Corvus");
    });

    it("detects aliases correctly", () => {
      const text = "He called upon The Raven Keeper for advice.";
      const result = detectMentionsInText(text, dummyEntries);

      expect(result.matchedEntryIds).toEqual(["char-corvus"]);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].matchedText).toBe("The Raven Keeper");
      expect(result.matches[0].matchType).toBe("alias");
      expect(text.substring(result.matches[0].startIndex, result.matches[0].endIndex)).toBe(
        "The Raven Keeper",
      );
    });

    it("performs case-insensitive matching while preserving original text", () => {
      const text = "mara looked up as master corvus frowned.";
      const result = detectMentionsInText(text, dummyEntries);

      expect(result.matchedEntryIds).toContain("char-mara");
      expect(result.matchedEntryIds).toContain("char-corvus");

      const maraMatch = result.matches.find((m) => m.entryId === "char-mara");
      expect(maraMatch?.originalText).toBe("mara");
      expect(maraMatch?.matchedText).toBe("Mara");

      const corvusMatch = result.matches.find((m) => m.entryId === "char-corvus");
      expect(corvusMatch?.originalText).toBe("master corvus");
      expect(corvusMatch?.matchedText).toBe("Master Corvus");
    });

    it("respects word boundaries and avoids substring false positives", () => {
      const text = "Arthur participated in a marathon without Art.";
      const result = detectMentionsInText(text, dummyEntries);

      // Should NOT match "Arthur" or "Marathon", only "Art"
      expect(result.matchedEntryIds).toEqual(["char-art"]);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].originalText).toBe("Art");
      expect(result.matches[0].startIndex).toBe(text.lastIndexOf("Art"));
    });
  });

  describe("Overlapping Match Resolution (Longer Wins)", () => {
    it("selects longer candidate when overlapping aliases or names exist", () => {
      // "Glass Weaver's Quill" contains "Glass Weaver" and "Weaver"
      const text = "She grasped the Glass Weaver's Quill firmly.";
      const result = detectMentionsInText(text, dummyEntries);

      // "Glass Weaver's Quill" is longer than "Weaver" or "The Glass Weaver"
      expect(result.matchedEntryIds).toEqual(["item-quill"]);
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].matchedText).toBe("Glass Weaver's Quill");
      expect(result.matches[0].originalText).toBe("Glass Weaver's Quill");
    });

    it("resolves nested aliases where longer alias takes precedence", () => {
      // Text has "The Glass Weaver" which contains "Weaver"
      const text = "People whispered that The Glass Weaver had returned.";
      const result = detectMentionsInText(text, dummyEntries);

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].matchedText).toBe("The Glass Weaver");
      expect(result.matches[0].entryId).toBe("char-mara");
    });

    it("resolves multiple distinct mentions in chronological order", () => {
      const text = "Mara spoke to Corvus inside the Sunken Archives.";
      const result = detectMentionsInText(text, dummyEntries);

      expect(result.matches).toHaveLength(3);
      expect(result.matches[0].matchedText).toBe("Mara");
      expect(result.matches[1].matchedText).toBe("Corvus");
      // "The Sunken Archives" matches "the Sunken Archives" (case-insensitive, longer match wins over "Sunken Archives")
      expect(result.matches[2].matchedText).toBe("The Sunken Archives");
      expect(result.matches[2].originalText).toBe("the Sunken Archives");

      expect(result.matchedEntryIds).toEqual(["char-mara", "char-corvus", "loc-archives"]);
    });
  });

  describe("Punctuation & Edge Cases", () => {
    it("handles punctuation, quotes, and brackets adjacent to words", () => {
      const text = '"Mara!" (Master Corvus) asked, "where is the quill?"';
      const result = detectMentionsInText(text, dummyEntries);

      const names = result.matches.map((m) => m.matchedText);
      expect(names).toContain("Mara");
      expect(names).toContain("Master Corvus");
    });

    it("handles possessive forms (e.g. Mara's)", () => {
      const text = "Mara's hands trembled.";
      const result = detectMentionsInText(text, dummyEntries);

      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].originalText).toBe("Mara");
      expect(result.matches[0].matchedText).toBe("Mara");
    });

    it("returns empty result safely for empty input or empty candidates", () => {
      expect(detectMentionsInText("", dummyEntries)).toEqual({
        matchedEntryIds: [],
        matches: [],
      });
      expect(detectMentionsInText("Some text", [])).toEqual({
        matchedEntryIds: [],
        matches: [],
      });
    });
  });
});
