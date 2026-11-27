import { describe, expect, it } from "vite-plus/test";
// vinext does not export its metadata renderers; import them directly so the
// tests check the exact text/XML the framework serves.
import { robotsToText, sitemapToXml } from "../node_modules/vinext/dist/server/metadata-routes.js";
import robots from "../src/app/robots";
import sitemap from "../src/app/sitemap";
import {
  DISALLOWED_PREFIXES,
  PUBLIC_PAGES,
  SITEMAP_URL,
  SITE_URL,
  absoluteUrl,
  buildSitemap,
} from "../src/lib/seo/site";

describe("absoluteUrl", () => {
  it("joins paths onto the canonical origin", () => {
    expect(absoluteUrl("/")).toBe("https://syncodex.xyz/");
    expect(absoluteUrl("/waitlist")).toBe("https://syncodex.xyz/waitlist");
  });

  it("rejects relative paths", () => {
    expect(() => absoluteUrl("waitlist")).toThrow(/must start with/);
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
