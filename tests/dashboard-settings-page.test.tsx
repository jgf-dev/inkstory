import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import SettingsPage from "../src/app/dashboard/settings/page";

const mockRedirect = vi.fn().mockImplementation((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

const mockGetUser = vi.fn();
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: () => mockGetUser(),
    },
  }),
}));

vi.mock("../src/app/dashboard/settings/_components/ByokCredentialsPanel", () => ({
  ByokCredentialsPanel: () =>
    React.createElement("div", { "data-testid": "byok-panel" }, "BYOK Panel"),
}));

describe("Dashboard SettingsPage (STO-1178)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    await expect(SettingsPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(mockRedirect).toHaveBeenCalledWith("/login");
  });

  it("renders settings header and ByokCredentialsPanel when authenticated", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "user-123", email: "author@inkstory.local" } },
    });

    const jsx = await SettingsPage();
    const html = renderToStaticMarkup(jsx);

    expect(html).toContain("Settings");
    expect(html).toContain("author@inkstory.local");
    expect(html).toContain("← Dashboard");
    expect(html).toContain("BYOK Panel");
  });
});
