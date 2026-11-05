// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { LoginForm } from "../src/app/login/LoginForm";
import { SignupForm } from "../src/app/signup/SignupForm";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const signInWithPassword = vi.fn();
const signUp = vi.fn();
const getSession = vi.fn();
vi.mock("../src/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      signUp: (...args: unknown[]) => signUp(...args),
      getSession: (...args: unknown[]) => getSession(...args),
    },
  }),
}));

function typeCredentials(email: string, password: string) {
  const emailInput = screen.getByLabelText("Email") as HTMLInputElement;
  const passwordInput = screen.getByLabelText("Password") as HTMLInputElement;
  fireEvent.change(emailInput, { target: { value: email } });
  fireEvent.change(passwordInput, { target: { value: password } });
  return { emailInput, passwordInput };
}

function submit() {
  const form = screen.getByRole("button").closest("form");
  if (!form) throw new Error("form not rendered");
  fireEvent.submit(form);
}

describe("auth forms wire the rendered inputs (STO-1255)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("LoginForm", () => {
    it("updates the email and password inputs when the user types", () => {
      render(<LoginForm />);
      const { emailInput, passwordInput } = typeCredentials("test@example.com", "secret123");
      expect(emailInput.value).toBe("test@example.com");
      expect(passwordInput.value).toBe("secret123");
    });

    it("submits the typed credentials and navigates to the dashboard", async () => {
      signInWithPassword.mockResolvedValue({ data: { user: {} }, error: null });
      render(<LoginForm />);
      typeCredentials("test@example.com", "secret123");
      submit();

      await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: "test@example.com",
        password: "secret123",
      });
      expect(refresh).toHaveBeenCalled();
    });

    it("shows the sign-in error and stays on the page", async () => {
      signInWithPassword.mockResolvedValue({
        data: null,
        error: { message: "Invalid login credentials" },
      });
      render(<LoginForm />);
      typeCredentials("test@example.com", "wrong-pass");
      submit();

      expect(await screen.findByText("Invalid login credentials")).toBeTruthy();
      expect(push).not.toHaveBeenCalled();
      expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe("SignupForm", () => {
    it("updates the email and password inputs when the user types", () => {
      render(<SignupForm />);
      const { emailInput, passwordInput } = typeCredentials("new@example.com", "newpassword");
      expect(emailInput.value).toBe("new@example.com");
      expect(passwordInput.value).toBe("newpassword");
    });

    it("submits the typed credentials and asks the user to confirm by email", async () => {
      signUp.mockResolvedValue({ data: { user: {} }, error: null });
      getSession.mockResolvedValue({ data: { session: null }, error: null });
      render(<SignupForm />);
      typeCredentials("new@example.com", "newpassword");
      submit();

      expect(
        await screen.findByText("Check your email to confirm your account, then log in."),
      ).toBeTruthy();
      expect(signUp).toHaveBeenCalledWith({
        email: "new@example.com",
        password: "newpassword",
        options: { emailRedirectTo: `${window.location.origin}/dashboard` },
      });
      expect(push).not.toHaveBeenCalled();
    });

    it("shows the sign-up error", async () => {
      signUp.mockResolvedValue({ data: null, error: { message: "Password too weak" } });
      render(<SignupForm />);
      typeCredentials("new@example.com", "short1");
      submit();

      expect(await screen.findByText("Password too weak")).toBeTruthy();
      expect(getSession).not.toHaveBeenCalled();
    });
  });
});
