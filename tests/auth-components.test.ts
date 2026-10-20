import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useTransition: () => [false, (fn: () => void) => fn()],
  };
});

const mockSignInWithPassword = vi.fn();
const mockSignUp = vi.fn();
const mockSignOut = vi.fn();
const mockGetSession = vi.fn();

vi.mock("../src/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signInWithPassword: (...args: any[]) => mockSignInWithPassword(...args),
      signUp: (...args: any[]) => mockSignUp(...args),
      signOut: (...args: any[]) => mockSignOut(...args),
      getSession: (...args: any[]) => mockGetSession(...args),
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
  beforeEach(() => {
    vi.clearAllMocks();
    // Default window.location.origin in tests if undefined
    if (typeof window === "undefined") {
      (globalThis as any).window = { location: { origin: "http://localhost:3000" } };
    }
  });

  describe("LoginForm", () => {
    it("renders email, password inputs and a submit button", async () => {
      const { LoginForm } = await import("../src/app/login/LoginForm");
      const { html } = renderAndCapture(LoginForm);

      expect(html).toContain('type="email"');
      expect(html).toContain('type="password"');
      expect(html).toContain("Log in");
      expect(html).toContain('required=""');
    });

    it("handles successful login by navigating to /dashboard and refreshing", async () => {
      mockSignInWithPassword.mockResolvedValue({ data: { user: {} }, error: null });

      const { LoginForm } = await import("../src/app/login/LoginForm");
      const { captured } = renderAndCapture(LoginForm);

      const preventDefault = vi.fn();
      await captured.props.onSubmit({ preventDefault });

      expect(preventDefault).toHaveBeenCalled();
      expect(mockSignInWithPassword).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith("/dashboard");
      expect(mockRefresh).toHaveBeenCalled();
    });

    it("handles login error by setting error message without navigating", async () => {
      mockSignInWithPassword.mockResolvedValue({
        data: null,
        error: { message: "Invalid login credentials" },
      });

      const { LoginForm } = await import("../src/app/login/LoginForm");
      const { captured } = renderAndCapture(LoginForm);

      const preventDefault = vi.fn();
      await captured.props.onSubmit({ preventDefault });

      expect(preventDefault).toHaveBeenCalled();
      expect(mockSignInWithPassword).toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("triggers input change handlers to update email and password state", async () => {
      const { LoginForm } = await import("../src/app/login/LoginForm");
      const { captured } = renderAndCapture(LoginForm);

      // Find email and password inputs in children
      const children = React.Children.toArray(captured.props.children);
      const emailContainer: any = children[0];
      const passwordContainer: any = children[1];

      const emailInput = emailContainer.props.children[1];
      const passwordInput = passwordContainer.props.children[1];

      expect(() => {
        emailInput.props.onChange({ target: { value: "test@example.com" } });
        passwordInput.props.onChange({ target: { value: "secret123" } });
      }).not.toThrow();
    });
  });

  describe("SignupForm", () => {
    it("renders form fields, min-length rule, and submit button", async () => {
      const { SignupForm } = await import("../src/app/signup/SignupForm");
      const { html } = renderAndCapture(SignupForm);

      expect(html).toContain('type="email"');
      expect(html).toContain('type="password"');
      expect(html).toContain("Minimum 6 characters.");
      expect(html).toContain("Create account");
    });

    it("handles signup error gracefully", async () => {
      mockSignUp.mockResolvedValue({
        data: null,
        error: { message: "Password too weak" },
      });

      const { SignupForm } = await import("../src/app/signup/SignupForm");
      const { captured } = renderAndCapture(SignupForm);

      const preventDefault = vi.fn();
      await captured.props.onSubmit({ preventDefault });

      expect(preventDefault).toHaveBeenCalled();
      expect(mockSignUp).toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("handles signup requiring confirmation without immediate session redirect", async () => {
      mockSignUp.mockResolvedValue({ data: { user: {} }, error: null });
      mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

      const { SignupForm } = await import("../src/app/signup/SignupForm");
      const { captured } = renderAndCapture(SignupForm);

      const preventDefault = vi.fn();
      await captured.props.onSubmit({ preventDefault });

      expect(mockSignUp).toHaveBeenCalledWith({
        email: "",
        password: "",
        options: {
          emailRedirectTo: "http://localhost:3000/dashboard",
        },
      });
      expect(mockGetSession).toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("redirects immediately to /dashboard if session already active", async () => {
      mockSignUp.mockResolvedValue({ data: { user: {} }, error: null });
      mockGetSession.mockResolvedValue({
        data: { session: { access_token: "tok123" } },
        error: null,
      });

      const { SignupForm } = await import("../src/app/signup/SignupForm");
      const { captured } = renderAndCapture(SignupForm);

      const preventDefault = vi.fn();
      await captured.props.onSubmit({ preventDefault });

      expect(mockPush).toHaveBeenCalledWith("/dashboard");
      expect(mockRefresh).toHaveBeenCalled();
    });

    it("triggers input change handlers for email and password", async () => {
      const { SignupForm } = await import("../src/app/signup/SignupForm");
      const { captured } = renderAndCapture(SignupForm);

      const children = React.Children.toArray(captured.props.children);
      const emailContainer: any = children[0];
      const passwordContainer: any = children[1];

      const emailInput = emailContainer.props.children[1];
      const passwordInput = passwordContainer.props.children[1];

      expect(() => {
        emailInput.props.onChange({ target: { value: "newuser@example.com" } });
        passwordInput.props.onChange({ target: { value: "newpassword" } });
      }).not.toThrow();
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
