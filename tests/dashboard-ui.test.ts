import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { LibraryCreator } from "../src/app/dashboard/_components/LibraryCreator";
import { OnboardingWizard } from "../src/app/dashboard/_components/OnboardingWizard";

const mockUseRouter = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => mockUseRouter(),
}));

const mockCreateNovelAction = vi.fn();
const mockCreateSeriesAction = vi.fn();
const mockSeedStarterBibleAction = vi.fn();
vi.mock("../src/lib/library/actions", () => ({
  createNovelAction: (...args: any[]) => mockCreateNovelAction(...args),
  createSeriesAction: (...args: any[]) => mockCreateSeriesAction(...args),
  seedStarterBibleAction: (...args: any[]) => mockSeedStarterBibleAction(...args),
}));

describe("Dashboard LibraryCreator (launch phase 4)", { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRouter.mockReturnValue({ refresh: vi.fn(), push: vi.fn() });
  });

  it("renders New Novel and New Series controls", () => {
    const html = renderToStaticMarkup(
      React.createElement(LibraryCreator, {
        series: [{ id: "s-1", title: "The Ashfall Cycle" }],
      }),
    );

    expect(html).toContain("New Novel");
    expect(html).toContain("New Series");
    expect(html).toContain("library-creator");
  });

  it("renders modals and validation errors when open", () => {
    const html = renderToStaticMarkup(
      React.createElement(LibraryCreator, {
        series: [{ id: "s-1", title: "The Ashfall Cycle" }],
      }),
    );

    // Closed by default: no modal shells in the initial markup.
    expect(html).not.toContain("novel-create-modal");
    expect(html).not.toContain("series-create-modal");
  });
});

describe("Dashboard OnboardingWizard (launch phase 5)", { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseRouter.mockReturnValue({ refresh: vi.fn(), push: vi.fn() });
  });

  it("renders step 1 for novel-less authors (SSR shows the modal)", () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingWizard, {
        hasNovels: false,
        series: [],
      }),
    );

    expect(html).toContain("onboarding-wizard");
    expect(html).toContain("Welcome to InkStory");
    expect(html).toContain("Step 1 of 3");
  });

  it("renders nothing when the author already has novels", () => {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingWizard, {
        hasNovels: true,
        series: [],
      }),
    );

    expect(html).toBe("");
  });
});
