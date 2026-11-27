/**
 * Crawler-facing site configuration: the canonical origin, the public pages
 * listed in `/sitemap.xml`, and the private prefixes `/robots.txt` keeps
 * crawlers out of.
 *
 * Add new public pages (e.g. a new `/tools/*` generator) to `PUBLIC_PAGES`
 * so they show up in the sitemap.
 */
import { NAME_GENERATOR_PATH } from "@/lib/tools/name-generator/params";

export const SITE_URL = "https://syncodex.xyz";
export const SITEMAP_URL = `${SITE_URL}/sitemap.xml`;

export type ChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export interface PublicPage {
  /** Absolute path on the site, starting with `/`. */
  path: string;
  changeFrequency: ChangeFrequency;
  /** Relative priority between 0 and 1. */
  priority: number;
}

export const PUBLIC_PAGES: readonly PublicPage[] = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: NAME_GENERATOR_PATH, changeFrequency: "monthly", priority: 0.8 },
  { path: "/waitlist", changeFrequency: "monthly", priority: 0.6 },
  { path: "/signup", changeFrequency: "yearly", priority: 0.4 },
  { path: "/login", changeFrequency: "yearly", priority: 0.3 },
];

/** Signed-in app surfaces, API routes and auth callbacks: not for crawlers. */
export const DISALLOWED_PREFIXES: readonly string[] = ["/api/", "/auth/", "/dashboard"];

/** Builds the canonical absolute URL for a site path. */
export function absoluteUrl(path: string): string {
  if (!path.startsWith("/")) {
    throw new Error(`Site paths must start with "/": ${path}`);
  }
  return path === "/" ? `${SITE_URL}/` : `${SITE_URL}${path}`;
}

export interface RobotsRule {
  userAgent: string;
  allow: string;
  disallow: string[];
}

export interface RobotsConfig {
  rules: RobotsRule[];
  sitemap: string;
}

export function buildRobots(): RobotsConfig {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...DISALLOWED_PREFIXES] }],
    sitemap: SITEMAP_URL,
  };
}

export interface SitemapEntry {
  url: string;
  changeFrequency: ChangeFrequency;
  priority: number;
}

export function buildSitemap(pages: readonly PublicPage[] = PUBLIC_PAGES): SitemapEntry[] {
  return pages.map((page) => ({
    url: absoluteUrl(page.path),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
