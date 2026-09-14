import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mockRedirect = vi.fn();
const mockPush = vi.fn();
const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (...args: any[]) => {
    mockRedirect(...args);
    throw new Error(`NEXT_REDIRECT: ${args[0]}`);
  },
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
    back: vi.fn(),
    forward: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

const mockGetUser = vi.fn();
vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: () => mockGetUser(),
    },
  }),
}));

const mockSyncAuthUser = vi.fn().mockResolvedValue({});
vi.mock("../src/lib/supabase/auth", () => ({
  syncAuthUser: (...args: any[]) => mockSyncAuthUser(...args),
}));

vi.mock("../src/app/login/LoginForm", () => ({
  LoginForm: () => React.createElement("form", { "data-testid": "login-form" }),
}));

vi.mock("../src/app/signup/SignupForm", () => ({
  SignupForm: () => React.createElement("form", { "data-testid": "signup-form" }),
}));

describe("Pages & Server Components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("RootLayout", () => {
    it("renders children wrapped in html and body tags with metadata", async () => {
      const { default: RootLayout, metadata } = await import("../src/app/layout");
      expect(metadata.title).toBe("InkStory");
      expect(metadata.description).toBeDefined();

      const element = React.createElement(RootLayout, {
        children: React.createElement("div", { id: "child-test" }, "Hello InkStory"),
      });
      const html = renderToStaticMarkup(element);

      expect(html).toContain('lang="en"');
      expect(html).toContain("Hello InkStory");
      expect(html).toContain("child-test");
    });
  });

  describe("HomePage (src/app/page.tsx)", () => {
    it("renders landing page with login and signup links when unauthenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const { default: Home } = await import("../src/app/page");
      const element = await Home();
      const html = renderToStaticMarkup(element);

      expect(html).toContain("InkStory");
      expect(html).toContain("A novel-writing and world-building platform");
      expect(html).toContain('href="/login"');
      expect(html).toContain('href="/signup"');
      expect(html).not.toContain('href="/dashboard"');
    });

    it("renders landing page with dashboard link when user is authenticated", async () => {
      mockGetUser.mockResolvedValue({
        data: {
          user: { id: "user-123", email: "auth@inkstory.local" },
        },
        error: null,
      });

      const { default: Home } = await import("../src/app/page");
      const element = await Home();
      const html = renderToStaticMarkup(element);

      expect(html).toContain("Go to dashboard →");
      expect(html).toContain('href="/dashboard"');
      expect(html).not.toContain('href="/login"');
    });
  });

  describe("DashboardPage (src/app/dashboard/page.tsx)", () => {
    it("redirects to /login when user is unauthenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const { default: DashboardPage } = await import("../src/app/dashboard/page");

      await expect(DashboardPage()).rejects.toThrow("NEXT_REDIRECT: /login");
      expect(mockRedirect).toHaveBeenCalledWith("/login");
    });

    it("syncs user, queries stats, and renders metrics when user is authenticated", async () => {
      const mockUser = {
        id: "00000000-0000-0000-0000-000000000001",
        email: "seed@inkstory.local",
        user_metadata: { name: "Seed User" },
      };
      mockGetUser.mockResolvedValue({ data: { user: mockUser }, error: null });

      const { default: DashboardPage } = await import("../src/app/dashboard/page");
      const element = await DashboardPage();
      const html = renderToStaticMarkup(element);

      expect(mockSyncAuthUser).toHaveBeenCalledWith(mockUser);
      expect(html).toContain("Dashboard");
      expect(html).toContain("seed@inkstory.local");
      expect(html).toContain("Series");
      expect(html).toContain("Novels");
      expect(html).toContain("No novels yet.");
    });
  });

  describe("LoginPage (src/app/login/page.tsx)", () => {
    it("redirects to /dashboard if user is already authenticated", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-abc", email: "logged-in@inkstory.local" } },
        error: null,
      });

      const { default: LoginPage } = await import("../src/app/login/page");
      await expect(LoginPage()).rejects.toThrow("NEXT_REDIRECT: /dashboard");
      expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    });

    it("renders login heading and link to signup page when unauthenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const { default: LoginPage } = await import("../src/app/login/page");
      const element = await LoginPage();
      const html = renderToStaticMarkup(element);

      expect(html).toContain("Welcome back");
      expect(html).toContain("Log in to continue writing.");
      expect(html).toContain('href="/signup"');
      expect(html).toContain("Create an account");
    });
  });

  describe("SignupPage (src/app/signup/page.tsx)", () => {
    it("redirects to /dashboard if user is already authenticated", async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: "user-abc", email: "logged-in@inkstory.local" } },
        error: null,
      });

      const { default: SignupPage } = await import("../src/app/signup/page");
      await expect(SignupPage()).rejects.toThrow("NEXT_REDIRECT: /dashboard");
      expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    });

    it("renders signup heading and link to login page when unauthenticated", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const { default: SignupPage } = await import("../src/app/signup/page");
      const element = await SignupPage();
      const html = renderToStaticMarkup(element);

      expect(html).toContain("Create your account");
      expect(html).toContain("Start writing with an AI-aware Codex.");
      expect(html).toContain('href="/login"');
      expect(html).toContain("Log in");
    });
  });
});
