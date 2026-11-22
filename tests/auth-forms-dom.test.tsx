// @vitest-environment happy-dom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { LoginForm } from "../src/app/login/LoginForm";
import { SignupForm } from "../src/app/signup/SignupForm";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

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

describe("auth forms wire the rendered inputs and Turnstile lifecycle (STO-1255)", () => {
  const originalFetch = globalThis.fetch;
  let renderMock: ReturnType<typeof vi.fn>;
  let resetMock: ReturnType<typeof vi.fn>;
  let removeMock: ReturnType<typeof vi.fn>;
  let capturedOptions: {
    sitekey?: string;
    action?: string;
    callback?: (token: string) => void;
    "expired-callback"?: () => void;
  } | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedOptions = null;
    renderMock = vi.fn((_el: HTMLElement, options: typeof capturedOptions) => {
      capturedOptions = options;
      options?.callback?.("mock-turnstile-token");
      return "widget-1";
    });
    resetMock = vi.fn();
    removeMock = vi.fn();
    (window as unknown as { turnstile?: unknown }).turnstile = {
      render: renderMock,
      reset: resetMock,
      remove: removeMock,
    };
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    delete (window as unknown as { turnstile?: unknown }).turnstile;
  });

  describe("LoginForm", () => {
    it("updates the email and password inputs when the user types", () => {
      render(<LoginForm siteKey="0x4AAAAAAGGPGpjMBFjy08CL" />);
      const { emailInput, passwordInput } = typeCredentials("test@example.com", "secret123");
      expect(emailInput.value).toBe("test@example.com");
      expect(passwordInput.value).toBe("secret123");
    });

    it("renders Turnstile explicitly, submits token to /api/auth/login, and navigates", async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      render(<LoginForm siteKey="0x4AAAAAAGGPGpjMBFjy08CL" />);
      await waitFor(() => expect(renderMock).toHaveBeenCalled());
      expect(capturedOptions?.sitekey).toBe("0x4AAAAAAGGPGpjMBFjy08CL");
      expect(capturedOptions?.action).toBe("login");

      typeCredentials("test@example.com", "secret123");
      submit();

      await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "secret123",
          "cf-turnstile-response": "mock-turnstile-token",
        }),
      });
      expect(refresh).toHaveBeenCalled();
    });

    it("shows the sign-in error, stays on page, and resets the widget ID", async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "Invalid login credentials" }), { status: 401 }),
      ) as unknown as typeof fetch;

      render(<LoginForm siteKey="0x4AAAAAAGGPGpjMBFjy08CL" />);
      await waitFor(() => expect(renderMock).toHaveBeenCalled());

      typeCredentials("test@example.com", "wrong-pass");
      submit();

      expect(await screen.findByText("Invalid login credentials")).toBeTruthy();
      expect(resetMock).toHaveBeenCalledWith("widget-1");
      expect(push).not.toHaveBeenCalled();
      expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe("SignupForm", () => {
    it("updates the email and password inputs when the user types", () => {
      render(<SignupForm siteKey="0x4AAAAAAGGPGpjMBFjy08CL" />);
      const { emailInput, passwordInput } = typeCredentials("new@example.com", "newpassword");
      expect(emailInput.value).toBe("new@example.com");
      expect(passwordInput.value).toBe("newpassword");
    });

    it("submits credentials + Turnstile token, asks user to confirm email, and resets widget", async () => {
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ ok: true, hasSession: false }), { status: 200 }),
      );
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      render(<SignupForm siteKey="0x4AAAAAAGGPGpjMBFjy08CL" />);
      await waitFor(() => expect(renderMock).toHaveBeenCalled());
      expect(capturedOptions?.action).toBe("signup");

      typeCredentials("new@example.com", "newpassword");
      submit();

      expect(
        await screen.findByText("Check your email to confirm your account, then log in."),
      ).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "new@example.com",
          password: "newpassword",
          "cf-turnstile-response": "mock-turnstile-token",
        }),
      });
      expect(resetMock).toHaveBeenCalledWith("widget-1");
      expect(push).not.toHaveBeenCalled();
    });

    it("shows the sign-up error and resets the Turnstile widget", async () => {
      globalThis.fetch = vi.fn(
        async () => new Response(JSON.stringify({ error: "Password too weak" }), { status: 400 }),
      ) as unknown as typeof fetch;

      render(<SignupForm siteKey="0x4AAAAAAGGPGpjMBFjy08CL" />);
      await waitFor(() => expect(renderMock).toHaveBeenCalled());

      typeCredentials("new@example.com", "short1");
      submit();

      expect(await screen.findByText("Password too weak")).toBeTruthy();
      expect(resetMock).toHaveBeenCalledWith("widget-1");
    });
  });
});
