import { describe, expect, it } from "vite-plus/test";
import { metadata as rootMetadata } from "../src/app/layout";
import { metadata as dashboardMetadata } from "../src/app/dashboard/layout";
import { metadata as homeMetadata } from "../src/app/page";
import { metadata as loginMetadata } from "../src/app/login/page";
import { metadata as signupMetadata } from "../src/app/signup/page";
import { metadata as waitlistMetadata } from "../src/app/waitlist/page";
import { metadata as nameGeneratorMetadata } from "../src/app/tools/character-name-generator/page";
import { metadata as tropeGeneratorMetadata } from "../src/app/tools/story-trope-generator/page";
import { metadata as adultPromptMetadata } from "../src/app/tools/adult-writing-prompt-generator/page";
import { SITE_URL, absoluteUrl, publicPageSeo } from "../src/lib/seo/site";
import { NAME_GENERATOR_PATH } from "../src/lib/tools/name-generator/params";
import { TROPE_GENERATOR_PATH } from "../src/lib/tools/story-tropes/params";
import { PROMPT_GENERATOR_PATH } from "../src/lib/tools/adult-prompts/params";

const PUBLIC_PAGES = [
  { path: "/", metadata: homeMetadata },
  { path: "/waitlist", metadata: waitlistMetadata },
  { path: "/login", metadata: loginMetadata },
  { path: "/signup", metadata: signupMetadata },
  { path: NAME_GENERATOR_PATH, metadata: nameGeneratorMetadata },
  { path: TROPE_GENERATOR_PATH, metadata: tropeGeneratorMetadata },
  { path: PROMPT_GENERATOR_PATH, metadata: adultPromptMetadata },
] as const;

describe("root metadataBase", () => {
  it("uses the canonical origin from site.ts", () => {
    expect(String(rootMetadata.metadataBase)).toBe(`${SITE_URL}/`);
  });
});

describe("public page canonicals (STO-1331)", () => {
  it.each(PUBLIC_PAGES)(
    "$path sets alternates.canonical and openGraph.url to the path-only absolute URL",
    ({ path, metadata }) => {
      const expected = publicPageSeo(path);
      expect(metadata.alternates).toEqual(expected.alternates);
      expect(metadata.openGraph).toMatchObject(expected.openGraph);
      expect(expected.alternates.canonical).toBe(absoluteUrl(path));
      expect(expected.alternates.canonical).not.toMatch(/[?#]/);
      expect(expected.openGraph.url).not.toMatch(/[?#]/);
    },
  );
});

describe("authenticated route metadata", () => {
  it("noindexes /dashboard and does not emit a canonical or og:url", () => {
    expect(dashboardMetadata.robots).toEqual({ index: false, follow: false });
    expect(dashboardMetadata.alternates).toBeUndefined();
    expect(dashboardMetadata.openGraph).toBeUndefined();
  });
});
