import { describe, expect, it } from "vite-plus/test";
// vinext does not export its metadata renderers; import them directly so the
// tests check the exact text/XML the framework serves.
import { robotsToText, sitemapToXml } from "../node_modules/vinext/dist/server/metadata-routes.js";
import robots from "../src/app/robots";
import sitemap from "../src/app/sitemap";
import {
  DISALLOWED_PREFIXES,
  NOINDEX_ROBOTS,
  PUBLIC_PAGES,
  SITEMAP_URL,
  SITE_URL,
  absoluteUrl,
  buildSitemap,
  publicPageSeo,
} from "../src/lib/seo/site";
import { NAME_GENERATOR_PATH } from "../src/lib/tools/name-generator/params";
import { TROPE_GENERATOR_PATH } from "../src/lib/tools/story-tropes/params";
import { PROMPT_GENERATOR_PATH } from "../src/lib/tools/adult-prompts/params";

describe("absoluteUrl", () => {
  it("joins paths onto the canonical origin", () => {
    expect(absoluteUrl("/")).toBe("https://syncodex.xyz/");
    expect(absoluteUrl("/waitlist")).toBe("https://syncodex.xyz/waitlist");
  });

  it("rejects relative paths", () => {
    expect(() => absoluteUrl("waitlist")).toThrow(/must start with/);
  });
});

describe("publicPageSeo", () => {
  it("returns a path-only canonical and matching Open Graph URL", () => {
    expect(publicPageSeo("/")).toEqual({
      alternates: { canonical: "https://syncodex.xyz/" },
      openGraph: { url: "https://syncodex.xyz/" },
    });
    expect(publicPageSeo("/waitlist")).toEqual({
      alternates: { canonical: "https://syncodex.xyz/waitlist" },
      openGraph: { url: "https://syncodex.xyz/waitlist" },
    });
  });

  it("strips query strings and hashes so shareable filters stay out of the canonical", () => {
    expect(publicPageSeo("/tools/character-name-generator?genre=fantasy&seed=1")).toEqual(
      publicPageSeo("/tools/character-name-generator"),
    );
    expect(publicPageSeo("/waitlist#form")).toEqual(publicPageSeo("/waitlist"));
    expect(publicPageSeo("/login?error=confirmation_failed").alternates.canonical).toBe(
      "https://syncodex.xyz/login",
    );
    expect(publicPageSeo("/signup?ref=1#top").openGraph.url).not.toMatch(/[?#]/);
  });

  it("rejects relative paths", () => {
    expect(() => publicPageSeo("waitlist")).toThrow(/must start with/);
  });
});

describe("NOINDEX_ROBOTS", () => {
  it("asks crawlers not to index authenticated surfaces", () => {
    expect(NOINDEX_ROBOTS).toEqual({ index: false, follow: false });
  });
});

describe("robots.txt", () => {
  it("allows the public site, blocks private prefixes and points at the sitemap", () => {
    const config = robots();
    expect(config.sitemap).toBe(SITEMAP_URL);
    expect(config.rules).toEqual([
      { userAgent: "*", allow: "/", disallow: [...DISALLOWED_PREFIXES] },
    ]);

    const text = robotsToText(config);
    expect(text).toContain("User-Agent: *");
    expect(text).toContain("Allow: /");
    expect(text).toContain("Disallow: /api/");
    expect(text).toContain("Disallow: /auth/");
    expect(text).toContain("Disallow: /dashboard");
    expect(text).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });

  it("never disallows a page listed in the sitemap", () => {
    for (const page of PUBLIC_PAGES) {
      for (const prefix of DISALLOWED_PREFIXES) {
        expect(page.path.startsWith(prefix)).toBe(false);
      }
    }
  });
});

describe("sitemap.xml", () => {
  it("lists every public page once with an absolute canonical URL", () => {
    const entries = sitemap();
    const urls = entries.map((entry) => entry.url);
    expect(urls).toEqual([
      "https://syncodex.xyz/",
      "https://syncodex.xyz/tools/character-name-generator",
      "https://syncodex.xyz/tools/story-trope-generator",
      "https://syncodex.xyz/waitlist",
      "https://syncodex.xyz/signup",
      "https://syncodex.xyz/login",
    ]);
    expect(urls).toContain(`https://syncodex.xyz${NAME_GENERATOR_PATH}`);
    expect(urls).toContain(`https://syncodex.xyz${TROPE_GENERATOR_PATH}`);
    expect(urls).not.toContain(`https://syncodex.xyz${PROMPT_GENERATOR_PATH}`);
    expect(new Set(urls).size).toBe(urls.length);
    for (const entry of entries) {
      expect(entry.priority).toBeGreaterThanOrEqual(0);
      expect(entry.priority).toBeLessThanOrEqual(1);
    }
  });

  it("renders valid sitemap XML", () => {
    const xml = sitemapToXml(sitemap());
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
    expect(xml).toContain("<loc>https://syncodex.xyz/tools/character-name-generator</loc>");
    expect(xml).toContain("<changefreq>weekly</changefreq>");
  });

  it("builds entries from a custom page list", () => {
    expect(buildSitemap([{ path: "/x", changeFrequency: "daily", priority: 0.5 }])).toEqual([
      { url: "https://syncodex.xyz/x", changeFrequency: "daily", priority: 0.5 },
    ]);
  });
});
