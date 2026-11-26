import { describe, expect, it } from "vite-plus/test";
import {
  isValidEmail,
  isWaitlistSelfReferrer,
  normalizeEmail,
  normalizeReferrer,
  normalizeSource,
  parseWaitlistSubmission,
  WAITLIST_EMAIL_MAX_LENGTH,
  WAITLIST_HONEYPOT_FIELD,
  WAITLIST_INVALID_EMAIL_MESSAGE,
  WAITLIST_REFERRER_MAX_LENGTH,
  WAITLIST_SOURCE_MAX_LENGTH,
} from "../src/lib/waitlist";

describe("waitlist validation", () => {
  it("trims and lowercases emails", () => {
    expect(normalizeEmail("  Writer@Example.COM \n")).toBe("writer@example.com");
  });

  it.each(["writer@example.com", "a.b+tag@sub.example.co.uk", "x@y.io"])("accepts %s", (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    "",
    "writer",
    "writer@",
    "@example.com",
    "writer@example",
    "writer@@example.com",
    "wri ter@example.com",
    "writer@.example.com",
    "writer@example..com",
    "a\u0000b@example.com",
    "a\x01b@example.com",
    "a\x7fb@example.com",
  ])("rejects %j", (email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it("enforces the address and local-part length limits", () => {
    const domain = "@example.com";
    expect(isValidEmail(`${"a".repeat(64)}${domain}`)).toBe(true);
    expect(isValidEmail(`${"a".repeat(65)}${domain}`)).toBe(false);
    const longDomain = `@${"d".repeat(WAITLIST_EMAIL_MAX_LENGTH)}.com`;
    expect(isValidEmail(`a${longDomain}`)).toBe(false);
  });

  it("keeps only short slug sources", () => {
    expect(normalizeSource(" Newsletter ")).toBe("newsletter");
    expect(normalizeSource("x_launch-1")).toBe("x_launch-1");
    expect(normalizeSource("has space")).toBeNull();
    expect(normalizeSource("<script>")).toBeNull();
    expect(normalizeSource("")).toBeNull();
    expect(normalizeSource("a".repeat(WAITLIST_SOURCE_MAX_LENGTH + 1))).toBeNull();
    expect(normalizeSource(["x"])).toBeNull();
    expect(normalizeSource(undefined)).toBeNull();
  });

  it("trims, strips control characters, and truncates referrers", () => {
    expect(normalizeReferrer(" https://syncodex.xyz/ ")).toBe("https://syncodex.xyz/");
    expect(normalizeReferrer("https://example.com/\u0000path\x7f")).toBe(
      "https://example.com/path",
    );
    expect(normalizeReferrer("\u0000\x1f")).toBeNull();
    expect(normalizeReferrer("   ")).toBeNull();
    expect(normalizeReferrer(null)).toBeNull();
    const long = `https://example.com/${"p".repeat(WAITLIST_REFERRER_MAX_LENGTH)}`;
    expect(normalizeReferrer(long)).toHaveLength(WAITLIST_REFERRER_MAX_LENGTH);
  });

  it("identifies same-origin /waitlist self-referrers", () => {
    const apiUrl = "https://syncodex.xyz/api/waitlist";
    expect(isWaitlistSelfReferrer("https://syncodex.xyz/waitlist", apiUrl)).toBe(true);
    expect(isWaitlistSelfReferrer("https://syncodex.xyz/waitlist/?source=x", apiUrl)).toBe(true);
    expect(isWaitlistSelfReferrer("https://syncodex.xyz/", apiUrl)).toBe(false);
    expect(isWaitlistSelfReferrer("https://other.example/waitlist", apiUrl)).toBe(false);
    expect(isWaitlistSelfReferrer("not-a-url", apiUrl)).toBe(false);
  });

  it("parses a valid submission and prefers explicit body referrer over fallback header", () => {
    expect(
      parseWaitlistSubmission(
        { email: " Writer@Example.com ", source: "X", [WAITLIST_HONEYPOT_FIELD]: "" },
        "https://syncodex.xyz/",
      ),
    ).toEqual({
      kind: "signup",
      signup: { email: "writer@example.com", source: "x", referrer: "https://syncodex.xyz/" },
    });

    expect(
      parseWaitlistSubmission(
        {
          email: "writer@example.com",
          referrer: "https://news.ycombinator.com/",
        },
        "https://syncodex.xyz/",
      ),
    ).toEqual({
      kind: "signup",
      signup: {
        email: "writer@example.com",
        source: null,
        referrer: "https://news.ycombinator.com/",
      },
    });
  });

  it("flags a filled honeypot before validating the email", () => {
    expect(parseWaitlistSubmission({ email: "nope", [WAITLIST_HONEYPOT_FIELD]: "spam" })).toEqual({
      kind: "honeypot",
    });
  });

  it.each([
    null,
    "writer@example.com",
    ["writer@example.com"],
    {},
    { email: 42 },
    { email: "not-an-email" },
    { email: "a\u0000b@example.com" },
    { email: `${"a".repeat(WAITLIST_EMAIL_MAX_LENGTH * 2 + 1)}@example.com` },
  ])("rejects body %j", (body) => {
    expect(parseWaitlistSubmission(body)).toEqual({
      kind: "invalid",
      error: WAITLIST_INVALID_EMAIL_MESSAGE,
    });
  });
});
