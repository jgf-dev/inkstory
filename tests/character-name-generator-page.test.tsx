// @vitest-environment happy-dom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import CharacterNameGeneratorPage, {
  metadata,
} from "../src/app/tools/character-name-generator/page";
import {
  FAQS,
  INTRO,
  OG_TITLE,
  PAGE_DESCRIPTION,
  PAGE_HEADING,
  PAGE_TITLE,
} from "../src/app/tools/character-name-generator/content";
import {
  BACKSTORY_ENDPOINT,
  COPIED_FEEDBACK_MS,
  NameResults,
  type BackstoryContext,
} from "../src/app/tools/character-name-generator/NameResults";
import { templateBackstory } from "../src/lib/tools/character-backstory/template";
import {
  NAME_GENERATOR_PATH,
  NAME_GENERATOR_URL,
  buildNameGeneratorHref,
  generateNames,
  nextSeed,
  parseNameGeneratorParams,
} from "../src/lib/tools/name-generator";

const KEYWORD = /free character name generator/i;

async function renderPage(params?: Record<string, string>) {
  return renderToStaticMarkup(
    await CharacterNameGeneratorPage(
      params ? { searchParams: Promise.resolve(params) } : undefined,
    ),
  );
}

function decode(html: string) {
  return html.replace(/&amp;/g, "&");
}

describe("character name generator page", () => {
  it("targets the keyword in title, description, OG tags and H1", () => {
    expect(metadata.title).toBe(PAGE_TITLE);
    expect(PAGE_TITLE).toMatch(KEYWORD);
    expect(metadata.description).toBe(PAGE_DESCRIPTION);
    expect(PAGE_DESCRIPTION).toMatch(KEYWORD);
    expect(metadata.openGraph).toMatchObject({
      title: OG_TITLE,
      description: PAGE_DESCRIPTION,
      siteName: "syncodex",
      url: NAME_GENERATOR_URL,
    });
    expect(OG_TITLE).toMatch(KEYWORD);
    expect(metadata.twitter).toMatchObject({ title: OG_TITLE });
    expect(metadata.alternates).toEqual({ canonical: NAME_GENERATOR_URL });
    expect(PAGE_HEADING).toMatch(KEYWORD);
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
      .replace(/free character name generator/gi, "");
    expect(copy).not.toMatch(
      /\$|price|pricing|free|paid|subscription|launch|soon|coming|20\d\d|guarantee|promise|early access/i,
    );
  });

  it("server-renders H1, intro, FAQ, links and the seeded batch from query params", async () => {
    const params = {
      seed: "story",
      genre: "modern",
      gender: "feminine",
      flavor: "nordic",
      type: "first",
      count: "6",
    };
    const html = decode(await renderPage(params));
    expect(html).toMatch(/<h1[^>]*>Free Character Name Generator<\/h1>/);
    expect(html).toContain("Stuck naming a hero");
    for (const faq of FAQS) expect(html).toContain(faq.q);
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('href="/tools/story-trope-generator"');
    expect(html).toContain('href="/waitlist?source=character-name-generator"');

    const parsed = parseNameGeneratorParams(params);
    const expected = generateNames({ ...parsed, seed: "story" });
    expect(expected).toHaveLength(6);
    for (const entry of expected) expect(html).toContain(entry.name);

    expect(html).toContain(`href="${buildNameGeneratorHref(nextSeed("story"), parsed)}"`);
    expect(html).toContain(`name="seed" value="${nextSeed("story")}"`);
    expect(html).toMatch(/<option value="modern" selected="">/);
    expect(html).toMatch(/<option value="nordic" selected="">/);
  });

  it("renders the same names for the same shareable URL", async () => {
    const params = { seed: "repeat", genre: "historical" };
    expect(await renderPage(params)).toBe(await renderPage(params));
  });

  it("creates a fresh seed and a full batch when no params are given", async () => {
    const html = decode(await renderPage());
    const seed = /name="seed" value="([a-z0-9]+)"/.exec(html)?.[1];
    expect(seed).toBeTruthy();
    expect(html.match(/aria-label="Copy /g)).toHaveLength(12);
    expect(html).toMatch(/<option value="fantasy" selected="">/);
  });
});

describe("NameResults", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const shareHref = `${NAME_GENERATOR_PATH}?seed=abc&genre=fantasy`;

  it("copies a single name, all names and the share link", async () => {
    render(
      <NameResults names={["Aelira Starfall", "Brokk"]} shareHref={shareHref} moreHref="/more" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy Brokk" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Brokk"));
    expect(await screen.findByText("Copied")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("Copied to clipboard.");

    fireEvent.click(screen.getByRole("button", { name: "Copy all" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("Aelira Starfall\nBrokk"));
    expect(await screen.findByText("Copied all")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Copy share link" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(new URL(shareHref, window.location.origin).toString()),
    );
    expect(await screen.findByText("Link copied")).toBeTruthy();
    expect(screen.getByTestId("generate-more").getAttribute("href")).toBe("/more");
  });

  it("clears the copied feedback after a delay and on unmount", async () => {
    vi.useFakeTimers();
    const view = render(<NameResults names={["Rook"]} shareHref={shareHref} moreHref="/more" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy Rook" }));
    });
    expect(screen.getByText("Copied")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy Rook" }));
    });
    await act(async () => {
      vi.advanceTimersByTime(COPIED_FEEDBACK_MS);
    });
    expect(screen.queryByText("Copied")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy Rook" }));
    });
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shows an error when the clipboard rejects", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(<NameResults names={["Rook"]} shareHref={shareHref} moreHref="/more" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy Rook" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Copy failed"));
  });

  it("renders an empty state without the copy-all control", () => {
    render(<NameResults names={[]} shareHref={shareHref} moreHref="/more" />);
    expect(screen.getByText(/No names matched/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy all" })).toBeNull();
  });
});

describe("NameResults backstory (AI mode)", () => {
  const shareHref = `${NAME_GENERATOR_PATH}?seed=abc&genre=fantasy`;
  const context: BackstoryContext = {
    genre: "fantasy",
    flavor: "lyrical",
    genders: { Rook: "masculine" },
  };

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not server-render backstory controls (progressive enhancement)", () => {
    const html = renderToStaticMarkup(
      <NameResults names={["Rook"]} shareHref={shareHref} moreHref="/more" backstory={context} />,
    );
    expect(html).not.toContain("Backstory");
    expect(html).toContain("Rook");
  });

  it("hides the control when the page does not enable AI mode", () => {
    render(<NameResults names={["Rook"]} shareHref={shareHref} moreHref="/more" />);
    expect(screen.queryByRole("button", { name: /backstory/i })).toBeNull();
  });

  it("posts the name and filters and shows the returned backstory", async () => {
    let resolve: (response: Response) => void = () => {};
    const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>((r) => (resolve = r)));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <NameResults
        names={["Rook", "Mara"]}
        shareHref={shareHref}
        moreHref="/more"
        backstory={context}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Write a backstory for Rook" }));
    expect(await screen.findByText("Writing a backstory…")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(BACKSTORY_ENDPOINT, expect.anything());
    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init?.body as string)).toEqual({
      name: "Rook",
      genre: "fantasy",
      flavor: "lyrical",
      gender: "masculine",
    });
    await act(async () => {
      resolve(Response.json({ backstory: "Rook was raised by crows.", source: "ai" }));
    });
    expect(await screen.findByText("Rook was raised by crows.")).toBeTruthy();
    expect(screen.getByText("Backstory: Rook")).toBeTruthy();
  });

  it("falls back to the algorithmic backstory on network or HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValueOnce(new Response("nope", { status: 500 })),
    );
    render(
      <NameResults names={["Mara"]} shareHref={shareHref} moreHref="/more" backstory={context} />,
    );
    const expected = templateBackstory({
      name: "Mara",
      genre: "fantasy",
      flavor: "lyrical",
      gender: "neutral",
    });
    fireEvent.click(await screen.findByRole("button", { name: "Write a backstory for Mara" }));
    expect(await screen.findByText(expected)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Write a backstory for Mara" }));
    await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
    expect(screen.queryByText(/nope|offline/)).toBeNull();
  });

  it("disables the controls while loading and treats an empty backstory as a failure", async () => {
    const pending: ((response: Response) => void)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => new Promise<Response>((r) => pending.push(r))),
    );
    render(
      <NameResults
        names={["Rook", "Mara"]}
        shareHref={shareHref}
        moreHref="/more"
        backstory={context}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Write a backstory for Rook" }));
    const mara = screen.getByRole("button", { name: "Write a backstory for Mara" });
    expect((mara as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      pending[0](Response.json({ backstory: "" }));
    });
    const rookTemplate = templateBackstory({
      name: "Rook",
      genre: "fantasy",
      flavor: "lyrical",
      gender: "masculine",
    });
    expect(await screen.findByText(rookTemplate)).toBeTruthy();
  });
});
