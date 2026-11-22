import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockRouter = {
  back: vi.fn(),
  forward: vi.fn(),
  refresh: mockRefresh,
  push: mockPush,
  replace: vi.fn(),
  prefetch: vi.fn(),
};

// vinext's next/navigation shim touches window.history on import and doesn't read
// AppRouterContext, so mock useRouter to hand components the same mock router.
vi.mock("next/navigation", () => ({ useRouter: () => mockRouter }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useTransition: () => [false, (fn: () => void) => fn()],
  };
});

const mockSignOut = vi.fn();

vi.mock("../src/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
  }),
}));

function renderAndCapture(Component: React.ComponentType) {
  let captured: any = null;
  function Wrapper() {
    captured = React.createElement(Component) ? (Component as any)() : null;
    return captured;
  }
  const html = renderToStaticMarkup(
    React.createElement(
      AppRouterContext.Provider,
      { value: mockRouter as any },
      React.createElement(Wrapper),
    ),
  );
  return { html, captured };
}

describe("Auth Client Components", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    if (typeof window === "undefined") {
      (globalThis as any).window = { location: { origin: "http://localhost:3000" } };
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("LoginForm", () => {
    it("renders email, password inputs, Turnstile container, and a submit button", async () => {
      const { LoginForm } = await import("../src/app/login/LoginForm");
      const { html } = renderAndCapture(LoginForm);

      expect(html).toContain('type="email"');
      expect(html).toContain('type="password"');
      expect(html).toContain('data-testid="turnstile-login"');
      expect(html).toContain("Log in");
      expect(html).toContain('required=""');
    });

    it("blocks submission without a Turnstile token", async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const { LoginForm } = await import("../src/app/login/LoginForm");
      const { captured } = renderAndCapture(LoginForm);

      const preventDefault = vi.fn();
      await captured.props.onSubmit({ preventDefault });

      expect(preventDefault).toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe("SignupForm", () => {
    it("renders form fields, min-length rule, Turnstile container, and submit button", async () => {
      const { SignupForm } = await import("../src/app/signup/SignupForm");
      const { html } = renderAndCapture(SignupForm);

      expect(html).toContain('type="email"');
      expect(html).toContain('type="password"');
      expect(html).toContain('data-testid="turnstile-signup"');
      expect(html).toContain("Minimum 6 characters.");
      expect(html).toContain("Create account");
    });

    it("blocks submission without a Turnstile token", async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const { SignupForm } = await import("../src/app/signup/SignupForm");
      const { captured } = renderAndCapture(SignupForm);

      const preventDefault = vi.fn();
      await captured.props.onSubmit({ preventDefault });

      expect(preventDefault).toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe("LogoutButton", () => {
    it("renders logout button and executes signOut and redirection on click", async () => {
      mockSignOut.mockResolvedValue({ error: null });

      const { LogoutButton } = await import("../src/app/dashboard/_components/LogoutButton");
      const { html, captured } = renderAndCapture(LogoutButton);

      expect(html).toContain("Log out");

      await captured.props.onClick();

      expect(mockSignOut).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/");
      expect(mockRefresh).toHaveBeenCalled();
    });
  });
});
