import { describe, expect, it } from "vite-plus/test";
import { estimateTokens } from "../src/lib/codex/tokens";

describe("estimateTokens", () => {
  it("returns 0 for empty strings", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("ceil-divides ASCII text by four characters per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("abcdefgh")).toBe(2);
  });

  it("counts CJK characters as one token each", () => {
    expect(estimateTokens("魔法")).toBe(2);
    expect(estimateTokens("魔法master")).toBe(2 + Math.ceil(6 / 4));
  });

  it("is subadditive under concatenation", () => {
    const parts = [
      "<entity ",
      'id="abc"',
      ' name="Elara">\n',
      "<description>",
      "弓道の達人 — arcane archer",
      "</description>\n</entity>\n",
    ];
    let sum = 0;
    for (const part of parts) {
      sum += estimateTokens(part);
    }
    expect(estimateTokens(parts.join(""))).toBeLessThanOrEqual(sum);
  });

  it("grows monotonically with length", () => {
    let previous = 0;
    for (let len = 1; len <= 40; len += 7) {
      const value = estimateTokens("x".repeat(len));
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });
});
