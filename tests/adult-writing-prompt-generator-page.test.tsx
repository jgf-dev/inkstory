// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import AdultWritingPromptGeneratorPage, {
  metadata,
} from "../src/app/tools/adult-writing-prompt-generator/page";
import { SITE_ORIGIN } from "../src/app/_components/tools/ToolPage";
import {
  ADULTS_ONLY_NOTICE,
  FAQS,
  INTRO,
  OG_TITLE,
  PAGE_DESCRIPTION,
  PAGE_HEADING,
  PAGE_TITLE,
} from "../src/app/tools/adult-writing-prompt-generator/content";
import {
  PromptResults,
  type PromptPartItem,
} from "../src/app/tools/adult-writing-prompt-generator/PromptResults";
import {
  PROMPT_GENERATOR_PATH,
  buildPromptGeneratorHref,
  findViolations,
  generatePrompt,
  nextSeed,
  parsePromptGeneratorParams,
} from "../src/lib/tools/adult-prompts";

const KEYWORD = /adult writing prompt generator/i;

async function renderPage(params?: Record<string, string>) {
  return renderToStaticMarkup(
    await AdultWritingPromptGeneratorPage(
      params ? { searchParams: Promise.resolve(params) } : undefined,
    ),
  );
}

function decode(html: string) {
  // Decode &#x27; and &quot; before &amp; so "&amp;#x27;" is not double-unescaped.
  return html
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

describe("adult writing prompt generator page", () => {
  it("targets the keyword in title, description, OG tags and H1", () => {
    expect(metadata.title).toBe(PAGE_TITLE);
    expect(PAGE_TITLE).toMatch(KEYWORD);
    expect(metadata.description).toBe(PAGE_DESCRIPTION);
    expect(PAGE_DESCRIPTION).toMatch(KEYWORD);
    expect(metadata.keywords).toEqual(
      expect.arrayContaining([
        "adult writing prompt generator",
        "romance writing prompt generator",
      ]),
    );
    const canonicalUrl = `${SITE_ORIGIN}${PROMPT_GENERATOR_PATH}`;
    expect(metadata.openGraph).toMatchObject({
      title: OG_TITLE,
      description: PAGE_DESCRIPTION,
      siteName: "syncodex",
      url: canonicalUrl,
    });
    expect(OG_TITLE).toMatch(KEYWORD);
    expect(metadata.twitter).toMatchObject({ title: OG_TITLE });
    expect(metadata.alternates).toEqual({ canonical: canonicalUrl });
    expect(PAGE_HEADING).toMatch(KEYWORD);
    expect(INTRO).toMatch(KEYWORD);
    expect(INTRO).toMatch(/romance writing prompt/i);
  });

  it("stays out of search indexes until the launch blockers are cleared", () => {
    expect(metadata.robots).toEqual({ index: false, follow: true });
  });

  it("keeps all copy free of pricing, promises, dates, launch talk and explicit text", () => {
    const copy = [
      PAGE_TITLE,
      PAGE_DESCRIPTION,
      OG_TITLE,
      PAGE_HEADING,
      INTRO,
      ADULTS_ONLY_NOTICE,
      JSON.stringify(FAQS),
      JSON.stringify(metadata),
    ]
      .join(" ")
      .replace(/free adult writing prompt generator/gi, "");
    expect(copy).not.toMatch(
      /\$|price|pricing|free|paid|subscription|launch|soon|coming|20\d\d|guarantee|promise|early access|uncensored|no refusals|unfiltered/i,
    );
    // The FAQ may name the search phrase honestly; nothing else may be explicit.
    expect(
      findViolations(copy.replace(/ai smut writer/gi, "")).filter((v) => v.rule === "explicit"),
    ).toEqual([]);
    expect(ADULTS_ONLY_NOTICE).toMatch(/fictional adult characters only/i);
  });

  it("server-renders H1, intro, notice, FAQ, links and the seeded prompt from query params", async () => {
    const params = {
      seed: "steam",
      pairing: "ff",
      heat: "steamy",
      genre: "historical",
      trope: "slow-burn",
      lock: "praise",
    };
    const html = decode(await renderPage(params));
    expect(html).toMatch(/<h1[^>]*>Free Adult Writing Prompt Generator<\/h1>/);
    expect(html).toContain(INTRO);
    expect(html).toContain(ADULTS_ONLY_NOTICE);
    for (const faq of FAQS) expect(html).toContain(faq.q);
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('href="/tools/character-name-generator"');
    expect(html).toContain('href="/tools/story-trope-generator"');
    expect(html).toContain('href="/waitlist?source=adult-writing-prompt-generator"');

    const parsed = parsePromptGeneratorParams(params);
    const prompt = generatePrompt({ ...parsed, seed: "steam" });
    expect(html).toContain(prompt.text);
    expect(html.match(/data-fragment-id=/g)).toHaveLength(6);
    expect(html).toContain('data-fragment-id="praise"');

    expect(html).toContain(
      `href="${buildPromptGeneratorHref(nextSeed("steam"), parsed, ["praise"])}"`,
    );
    expect(html).toContain(`href="${buildPromptGeneratorHref("steam", parsed, [])}"`);
    const setupId = prompt.slots[0].fragments[0].fragment.id;
    expect(html).toContain(
      `href="${buildPromptGeneratorHref("steam", parsed, ["praise", setupId])}"`,
    );
    expect(html).toContain(`name="seed" value="${nextSeed("steam")}"`);
    expect(html).toContain('name="lock" value="praise"');
    expect(html).toMatch(/<option value="ff" selected="">FF/);
    expect(html).toMatch(/<option value="steamy" selected="">/);
    expect(html).toMatch(/<option value="historical" selected="">/);
    expect(html).toMatch(/<option value="slow-burn" selected="">Slow burn/);
  });

  it("renders the same prompt for the same shareable URL", async () => {
    const params = { seed: "repeat", pairing: "mm", lock: "banter" };
    expect(await renderPage(params)).toBe(await renderPage(params));
  });

  it("creates a fresh seed and a full prompt when no params are given", async () => {
    const html = decode(await renderPage());
    expect(/name="seed" value="([a-z0-9]+)"/.exec(html)?.[1]).toBeTruthy();
    expect(html.match(/data-fragment-id=/g)).toHaveLength(6);
    expect(html).not.toContain('name="lock"');
    expect(html).toMatch(/<option value="any" selected="">Any pairing/);
    expect(html).toContain("Every character is a fictional, consenting adult.");
  });
});

describe("PromptResults", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();
  const shareHref = `${PROMPT_GENERATOR_PATH}?seed=abc`;
  const parts: PromptPartItem[] = [
    { id: "banter", label: "Tension", text: "banter", locked: true, toggleHref: "/unlock" },
    { id: "lodge", label: "Setting", text: "a lodge", locked: false, toggleHref: "/lock" },
  ];

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  });

  afterEach(() => cleanup());

  it("renders lock links and copies the prompt and share link", async () => {
    render(
      <PromptResults prompt="Write it." parts={parts} shareHref={shareHref} moreHref="/more" />,
    );
    expect(screen.getByTestId("generated-prompt").textContent).toBe("Write it.");
    expect(screen.getByRole("link", { name: "Unlock tension: banter" }).getAttribute("href")).toBe(
      "/unlock",
    );
    expect(screen.getByRole("link", { name: "Lock setting: a lodge" }).getAttribute("href")).toBe(
      "/lock",
    );
    expect(screen.getByText("Locked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy all" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Copy prompt" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Write it."));
    expect(await screen.findByText("Copied prompt")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(new URL(shareHref, window.location.origin).toString()),
    );
    expect(screen.getByTestId("generate-more").getAttribute("href")).toBe("/more");
  });
});
