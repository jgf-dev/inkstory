import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: vi.fn() }));
vi.mock("../src/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

const EXPECTED = {
  "/": {
    load: () => import("../src/app/page"),
    title: "Story Planning and Novel Writing Workspace | InkStory",
    description:
      "Plan novels in InkStory, an AI-aware writing workspace with a story bible, plot outliner, and autosaving scene editor.",
  },
  "/login": {
    load: () => import("../src/app/login/page"),
    title: "Log In to Your Writing Workspace | InkStory",
    description:
      "Log in to InkStory to return to your story projects, Codex entries, and scene drafts.",
  },
  "/signup": {
    load: () => import("../src/app/signup/page"),
    title: "Create Your Writing Workspace Account | InkStory",
    description:
      "Create an InkStory account to start planning your novel and organizing characters, locations, and lore in your story Codex.",
  },
};

describe("STO-1321 / STO-1323 page metadata", () => {
  it.each(Object.entries(EXPECTED))(
    "%s sets its own title and description",
    async (_route, spec) => {
      const { metadata } = await spec.load();
      expect(metadata.title).toBe(spec.title);
      expect(metadata.description).toBe(spec.description);
      expect(spec.title.length).toBeGreaterThan(10);
    },
  );

  it("uses distinct titles and descriptions and does not fall back to the shared root values", async () => {
    const { metadata: root } = await import("../src/app/layout");
    const pages = await Promise.all(Object.values(EXPECTED).map((spec) => spec.load()));
    const titles = pages.map((p) => p.metadata.title);
    const descriptions = pages.map((p) => p.metadata.description);
    expect(new Set(titles).size).toBe(pages.length);
    expect(new Set(descriptions).size).toBe(pages.length);
    expect(titles).not.toContain(root.title);
    expect(descriptions).not.toContain(root.description);
  });
});
