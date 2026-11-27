// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import StoryTropeGeneratorPage, { metadata } from "../src/app/tools/story-trope-generator/page";
import {
  FAQS,
  INTRO,
  OG_TITLE,
  PAGE_DESCRIPTION,
  PAGE_HEADING,
  PAGE_TITLE,
} from "../src/app/tools/story-trope-generator/content";
import { SelectField, SITE_ORIGIN } from "../src/app/_components/tools/ToolPage";
import {
  PREMISE_ENDPOINT,
  TropeResults,
  fetchPremise,
  formatTrope,
  type TropeResultItem,
} from "../src/app/tools/story-trope-generator/TropeResults";
import {
  TROPE_GENERATOR_PATH,
  buildTropeGeneratorHref,
  generateTropes,
  nextSeed,
  parseTropeGeneratorParams,
} from "../src/lib/tools/story-tropes";

const KEYWORD = /free story tropes generator/i;

async function renderPage(params?: Record<string, string>) {
  return renderToStaticMarkup(
    await StoryTropeGeneratorPage(params ? { searchParams: Promise.resolve(params) } : undefined),
  );
}

function decode(html: string) {
  // Decode &#x27; before & so "&#x27;" is not double-unescaped.
  return html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
}

describe("story trope generator page", () => {
  it("targets the keyword in title, description, OG tags and H1", () => {
    expect(metadata.title).toBe(PAGE_TITLE);
    expect(PAGE_TITLE).toMatch(KEYWORD);
    expect(metadata.description).toBe(PAGE_DESCRIPTION);
    expect(PAGE_DESCRIPTION).toMatch(KEYWORD);
    expect(metadata.keywords).toContain("story trope generator");
    expect(metadata.openGraph).toMatchObject({
      title: OG_TITLE,
      description: PAGE_DESCRIPTION,
      siteName: "syncodex",
      url: `https://syncodex.xyz${TROPE_GENERATOR_PATH}`,
    });
    expect(OG_TITLE).toMatch(KEYWORD);
    expect(metadata.twitter).toMatchObject({ title: OG_TITLE });
    expect(String(metadata.metadataBase)).toBe(`${SITE_ORIGIN}/`);
    expect(metadata.alternates).toEqual({
      canonical: `https://syncodex.xyz${TROPE_GENERATOR_PATH}`,
    });
    expect(PAGE_HEADING).toMatch(KEYWORD);
    expect(INTRO).toMatch(/story trope generator/i);
  });

  it("keeps all copy free of pricing, promises, dates and launch timelines", () => {
    const copy = [
      PAGE_TITLE,
      PAGE_DESCRIPTION,
      OG_TITLE,
      PAGE_HEADING,
      INTRO,
      JSON.stringify(FAQS),
      JSON.stringify(metadata),
    ]
      .join(" ")
      .replace(/free story tropes generator/gi, "");
    expect(copy).not.toMatch(
      /\$|price|pricing|free|paid|subscription|launch|soon|coming|20\d\d|guarantee|promise|early access/i,
    );
  });

  it("server-renders H1, intro, FAQ, links and the seeded combo from query params", async () => {
    const params = { seed: "story", genre: "fantasy", category: "plot", count: "3", lock: "heist" };
    const html = decode(await renderPage(params));
    expect(html).toMatch(/<h1[^>]*>Free Story Tropes Generator<\/h1>/);
    expect(html).toContain("Need a spark for your next book");
    for (const faq of FAQS) expect(html).toContain(faq.q);
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('href="/tools/character-name-generator"');
    expect(html).toContain('href="/waitlist?source=story-trope-generator"');

    const parsed = parseTropeGeneratorParams(params);
    const combo = generateTropes({ ...parsed, seed: "story" });
    expect(combo).toHaveLength(3);
    for (const entry of combo) {
      expect(html).toContain(entry.trope.name);
      expect(html).toContain(entry.trope.description);
    }
    expect(combo[0]).toMatchObject({ locked: true, trope: { id: "heist" } });

    const locked = ["heist"];
    expect(html).toContain(`href="${buildTropeGeneratorHref(nextSeed("story"), parsed, locked)}"`);
    expect(html).toContain(`href="${buildTropeGeneratorHref("story", parsed, [])}"`);
    expect(html).toContain(
      `href="${buildTropeGeneratorHref("story", parsed, ["heist", combo[1].trope.id])}"`,
    );
    expect(html).toContain(`name="seed" value="${nextSeed("story")}"`);
    expect(html).toContain('name="lock" value="heist"');
    expect(html).toMatch(/<option value="fantasy" selected="">/);
    expect(html).toMatch(/<option value="plot" selected="">/);
    expect(html).toMatch(/<option value="3" selected="">/);
  });

  it("keeps the AI premise control out of the server-rendered markup", async () => {
    const html = decode(await renderPage({ seed: "story", genre: "romance" }));
    expect(html.match(/data-trope-id=/g)).toHaveLength(4);
    expect(html).not.toContain("Write a premise");
    expect(html).not.toContain('data-testid="trope-premise"');
    expect(html).not.toContain(PREMISE_ENDPOINT);
  });

  it("renders the same combo for the same shareable URL", async () => {
    const params = { seed: "repeat", genre: "horror", lock: "slow-dread" };
    expect(await renderPage(params)).toBe(await renderPage(params));
  });

  it("creates a fresh seed and a default combo when no params are given", async () => {
    const html = decode(await renderPage());
    expect(/name="seed" value="([a-z0-9]+)"/.exec(html)?.[1]).toBeTruthy();
    expect(html.match(/data-trope-id=/g)).toHaveLength(4);
    expect(html).not.toContain('name="lock"');
    expect(html).toMatch(/<option value="any" selected="">Any genre/);
  });
});

describe("TropeResults", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();
  const shareHref = `${TROPE_GENERATOR_PATH}?seed=abc`;
  const items: TropeResultItem[] = [
    {
      id: "heist",
      name: "The heist",
      description: "A crew plans a theft.",
      category: "plot",
      locked: true,
      toggleHref: "/unlock-heist",
    },
    {
      id: "slow-burn",
      name: "Slow burn",
      description: "Attraction builds slowly.",
      category: "romance",
      locked: false,
      toggleHref: "/lock-slow-burn",
    },
  ];

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  });

  afterEach(() => cleanup());

  it("renders lock links and copies a trope, the combo and the share link", async () => {
    render(<TropeResults tropes={items} shareHref={shareHref} moreHref="/more" />);
    expect(screen.getByRole("link", { name: "Unlock The heist" }).getAttribute("href")).toBe(
      "/unlock-heist",
    );
    expect(screen.getByRole("link", { name: "Lock Slow burn" }).getAttribute("href")).toBe(
      "/lock-slow-burn",
    );
    expect(screen.getByText("Locked")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy Slow burn" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(formatTrope(items[1])));
    expect(await screen.findByText("Copied")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy all" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "The heist: A crew plans a theft.\nSlow burn: Attraction builds slowly.",
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(new URL(shareHref, window.location.origin).toString()),
    );
    expect(screen.getByTestId("generate-more").getAttribute("href")).toBe("/more");
  });

  it("renders an empty state without the copy-all control", () => {
    render(<TropeResults tropes={[]} shareHref={shareHref} moreHref="/more" />);
    expect(screen.getByText(/No tropes matched/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy all" })).toBeNull();
  });

  it("resyncs SelectField when the value prop changes across navigation", () => {
    const view = render(
      <SelectField id="genre" name="genre" label="Genre" value="fantasy">
        <option value="fantasy">Fantasy</option>
        <option value="horror">Horror</option>
      </SelectField>,
    );
    expect(screen.getByLabelText("Genre")).toHaveProperty("value", "fantasy");

    view.rerender(
      <SelectField id="genre" name="genre" label="Genre" value="horror">
        <option value="fantasy">Fantasy</option>
        <option value="horror">Horror</option>
      </SelectField>,
    );
    expect(screen.getByLabelText("Genre")).toHaveProperty("value", "horror");
  });

  describe("AI premise mode", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    function stubFetch(impl: (...args: Parameters<typeof fetch>) => Promise<Response>) {
      const fn = vi.fn<typeof fetch>(impl);
      vi.stubGlobal("fetch", fn);
      return fn;
    }

    function renderWithPremise() {
      return render(
        <TropeResults
          tropes={items}
          shareHref={shareHref}
          moreHref="/more"
          premise={{ genre: "romance" }}
        />,
      );
    }

    it("shows no premise control without the premise context or tropes", () => {
      render(<TropeResults tropes={items} shareHref={shareHref} moreHref="/more" />);
      expect(screen.queryByRole("button", { name: /Write a premise/ })).toBeNull();
      cleanup();
      render(
        <TropeResults
          tropes={[]}
          shareHref={shareHref}
          moreHref="/more"
          premise={{ genre: "any" }}
        />,
      );
      expect(screen.queryByRole("button", { name: /Write a premise/ })).toBeNull();
    });

    it("posts the combo ids and renders the AI premise", async () => {
      let resolve: (res: Response) => void = () => {};
      const fetchMock = stubFetch(() => new Promise<Response>((r) => (resolve = r)));
      renderWithPremise();
      const button = await screen.findByRole("button", { name: "Write a premise (AI)" });
      fireEvent.click(button);
      expect(await screen.findByText("Writing a premise…")).toBeTruthy();
      expect(button).toHaveProperty("disabled", true);
      expect(button.getAttribute("title")).toMatch(/Waiting/);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(PREMISE_ENDPOINT);
      expect(JSON.parse(init?.body as string)).toEqual({
        tropes: ["heist", "slow-burn"],
        genre: "romance",
      });
      resolve(Response.json({ source: "ai", premise: "A thief falls slowly for her mark." }));
      expect(await screen.findByText("A thief falls slowly for her mark.")).toBeTruthy();
      expect(button).toHaveProperty("disabled", false);
    });

    it("shows the algorithmic combo when the server falls back", async () => {
      stubFetch(async () => Response.json({ source: "combo", premise: null, tropes: [] }));
      renderWithPremise();
      fireEvent.click(await screen.findByRole("button", { name: "Write a premise (AI)" }));
      const panel = await screen.findByTestId("trope-premise");
      await waitFor(() => expect(panel.textContent).toContain(formatTrope(items[0])));
      expect(panel.textContent).toContain(formatTrope(items[1]));
    });

    it.each([
      ["a network error", () => Promise.reject(new TypeError("offline"))],
      ["an error status", async () => new Response("provider exploded", { status: 500 })],
      ["a malformed body", async () => new Response("not json", { status: 200 })],
      ["an empty premise", async () => Response.json({ source: "ai", premise: "  " })],
    ])("falls back silently on %s", async (_label, impl) => {
      stubFetch(impl as () => Promise<Response>);
      const view = await fetchPremise(items, { genre: "any" });
      expect(view).toEqual({
        kind: "combo",
        tropes: items.map(({ id, name, description }) => ({ id, name, description })),
      });
    });

    it("never renders raw provider errors", async () => {
      stubFetch(async () => new Response("upstream 402: quota exceeded", { status: 402 }));
      renderWithPremise();
      fireEvent.click(await screen.findByRole("button", { name: "Write a premise (AI)" }));
      const panel = await screen.findByTestId("trope-premise");
      await waitFor(() => expect(panel.textContent).toContain(formatTrope(items[0])));
      expect(panel.textContent).not.toMatch(/quota|402|upstream/);
    });

    it("ignores a response that arrives after unmount", async () => {
      let resolve: (res: Response) => void = () => {};
      stubFetch(() => new Promise<Response>((r) => (resolve = r)));
      const view = renderWithPremise();
      fireEvent.click(await screen.findByRole("button", { name: "Write a premise (AI)" }));
      view.unmount();
      resolve(Response.json({ source: "ai", premise: "Too late." }));
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByText("Too late.")).toBeNull();
    });
  });
});
