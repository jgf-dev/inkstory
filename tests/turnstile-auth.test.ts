import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getClientIp, verifyTurnstileToken } from "../src/lib/turnstile";

const mockSignInWithPassword = vi.fn();
const mockSignUp = vi.fn();
const mockExchangeCodeForSession = vi.fn();
const mockVerifyOtp = vi.fn();

vi.mock("../src/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      signInWithPassword: (...args: unknown[]) => mockSignInWithPassword(...args),
      signUp: (...args: unknown[]) => mockSignUp(...args),
      exchangeCodeForSession: (...args: unknown[]) => mockExchangeCodeForSession(...args),
      verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
    },
  })),
}));

describe("Turnstile verification and auth route handlers", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TURNSTILE_SECRET", "test-secret-value");
    vi.stubEnv("TURNSTILE_HOSTNAMES", "syncodex.xyz,inkstory.jgeof.workers.dev");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  describe("getClientIp", () => {
    it("prefers cf-connecting-ip over x-forwarded-for", () => {
      const req = new Request("https://syncodex.xyz/api/auth/login", {
        headers: {
          "cf-connecting-ip": "203.0.113.10",
          "x-forwarded-for": "198.51.100.1, 10.0.0.1",
        },
      });
      expect(getClientIp(req)).toBe("203.0.113.10");
    });

    it("falls back to first x-forwarded-for entry", () => {
      const req = new Request("https://syncodex.xyz/api/auth/login", {
        headers: {
          "x-forwarded-for": "198.51.100.1, 10.0.0.1",
        },
      });
      expect(getClientIp(req)).toBe("198.51.100.1");
    });
  });

  describe("verifyTurnstileToken", () => {
    it("rejects empty, non-string, or oversized tokens without calling siteverify", async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      expect(await verifyTurnstileToken({ token: "", expectedAction: "login" })).toEqual({
        ok: false,
      });
      expect(await verifyTurnstileToken({ token: null, expectedAction: "login" })).toEqual({
        ok: false,
      });
      expect(
        await verifyTurnstileToken({ token: "a".repeat(2049), expectedAction: "login" }),
      ).toEqual({ ok: false });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("fails closed when TURNSTILE_SECRET or TURNSTILE_HOSTNAMES is empty", async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      vi.stubEnv("TURNSTILE_SECRET", "");
      expect(await verifyTurnstileToken({ token: "tok", expectedAction: "login" })).toEqual({
        ok: false,
      });

      vi.stubEnv("TURNSTILE_SECRET", "test-secret-value");
      vi.stubEnv("TURNSTILE_HOSTNAMES", "  ,  ");
      expect(await verifyTurnstileToken({ token: "tok", expectedAction: "login" })).toEqual({
        ok: false,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("accepts valid siteverify response matching action and hostname allowlist", async () => {
      const fetchSpy = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              action: "signup",
              hostname: "syncodex.xyz",
            }),
            { status: 200 },
          ),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const result = await verifyTurnstileToken({
        token: "valid-token",
        expectedAction: "signup",
        remoteIp: "203.0.113.10",
      });

      expect(result).toEqual({ ok: true });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
      expect(init.method).toBe("POST");
      const params = new URLSearchParams((init.body as URLSearchParams).toString());
      expect(params.get("secret")).toBe("test-secret-value");
      expect(params.get("response")).toBe("valid-token");
      expect(params.get("remoteip")).toBe("203.0.113.10");
    });

    it("rejects mismatched action or unapproved hostname (including localhost in prod)", async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              action: "login",
              hostname: "localhost",
            }),
            { status: 200 },
          ),
      ) as unknown as typeof fetch;

      expect(await verifyTurnstileToken({ token: "valid-token", expectedAction: "login" })).toEqual(
        { ok: false },
      );

      globalThis.fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              action: "signup",
              hostname: "syncodex.xyz",
            }),
            { status: 200 },
          ),
      ) as unknown as typeof fetch;

      expect(await verifyTurnstileToken({ token: "valid-token", expectedAction: "login" })).toEqual(
        { ok: false },
      );
    });
  });

  describe("POST /api/auth/login", () => {
    it("returns 403 and does not call Supabase when Turnstile token fails or is replayed", async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              "error-codes": ["timeout-or-duplicate"],
            }),
            { status: 200 },
          ),
      ) as unknown as typeof fetch;

      const { POST } = await import("../src/app/api/auth/login/route");
      const request = new NextRequest("https://syncodex.xyz/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.5" },
        body: JSON.stringify({
          email: "writer@syncodex.xyz",
          password: "password123",
          "cf-turnstile-response": "replayed-token",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(403);
      expect(mockSignInWithPassword).not.toHaveBeenCalled();
    });

    it("calls Supabase signInWithPassword when siteverify succeeds", async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              action: "login",
              hostname: "syncodex.xyz",
            }),
            { status: 200 },
          ),
      ) as unknown as typeof fetch;
      mockSignInWithPassword.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });

      const { POST } = await import("../src/app/api/auth/login/route");
      const request = new NextRequest("https://syncodex.xyz/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "writer@syncodex.xyz",
          password: "password123",
          "cf-turnstile-response": "fresh-token",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(mockSignInWithPassword).toHaveBeenCalledWith({
        email: "writer@syncodex.xyz",
        password: "password123",
      });
    });
  });

  describe("POST /api/auth/signup", () => {
    it("returns 403 and does not call Supabase when Turnstile fails", async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              action: "login",
              hostname: "syncodex.xyz",
            }),
            { status: 200 },
          ),
      ) as unknown as typeof fetch;

      const { POST } = await import("../src/app/api/auth/signup/route");
      const request = new NextRequest("https://syncodex.xyz/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "new@syncodex.xyz",
          password: "password123",
          "cf-turnstile-response": "wrong-action-token",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(403);
      expect(mockSignUp).not.toHaveBeenCalled();
    });

    it("calls Supabase signUp with server-derived emailRedirectTo when siteverify succeeds", async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              action: "signup",
              hostname: "inkstory.jgeof.workers.dev",
            }),
            { status: 200 },
          ),
      ) as unknown as typeof fetch;
      mockSignUp.mockResolvedValue({ data: { user: { id: "u2" }, session: null }, error: null });

      const { POST } = await import("../src/app/api/auth/signup/route");
      const request = new NextRequest("https://inkstory.jgeof.workers.dev/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "new@syncodex.xyz",
          password: "password123",
          "cf-turnstile-response": "fresh-signup-token",
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, hasSession: false });
      expect(mockSignUp).toHaveBeenCalledWith({
        email: "new@syncodex.xyz",
        password: "password123",
        options: {
          emailRedirectTo: "https://inkstory.jgeof.workers.dev/auth/callback?next=/dashboard",
        },
      });
    });
  });

  describe("GET /auth/callback", () => {
    it("exchanges PKCE code for session and redirects to safe next path", async () => {
      mockExchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });

      const { GET } = await import("../src/app/auth/callback/route");
      const request = new NextRequest(
        "https://syncodex.xyz/auth/callback?code=auth-code-123&next=%2Fdashboard%2Fcodex",
      );

      const response = await GET(request);
      expect(mockExchangeCodeForSession).toHaveBeenCalledWith("auth-code-123");
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://syncodex.xyz/dashboard/codex");
    });

    it("verifies token_hash + type OTP links and sanitizes unsafe next redirects", async () => {
      mockVerifyOtp.mockResolvedValue({ data: { session: {} }, error: null });

      const { GET } = await import("../src/app/auth/callback/route");
      const request = new NextRequest(
        "https://syncodex.xyz/auth/callback?token_hash=hash-abc&type=signup&next=%2F%2Fevil.com",
      );

      const response = await GET(request);
      expect(mockVerifyOtp).toHaveBeenCalledWith({
        token_hash: "hash-abc",
        type: "signup",
      });
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://syncodex.xyz/dashboard");
    });

    it("redirects to /login?error=confirmation_failed when verification fails or params are missing", async () => {
      mockExchangeCodeForSession.mockResolvedValue({
        data: { session: null },
        error: new Error("invalid code"),
      });

      const { GET } = await import("../src/app/auth/callback/route");
      const failedCodeRes = await GET(
        new NextRequest("https://syncodex.xyz/auth/callback?code=bad-code"),
      );
      expect(failedCodeRes.status).toBe(307);
      expect(failedCodeRes.headers.get("location")).toBe(
        "https://syncodex.xyz/login?error=confirmation_failed",
      );

      const missingParamsRes = await GET(new NextRequest("https://syncodex.xyz/auth/callback"));
      expect(missingParamsRes.status).toBe(307);
      expect(missingParamsRes.headers.get("location")).toBe(
        "https://syncodex.xyz/login?error=confirmation_failed",
      );
    });

    it.each([
      ["tab-injected protocol-relative URL", "/\t/evil.com"],
      ["newline-injected protocol-relative URL", "/\n/evil.com"],
      ["backslash-prefixed URL", "/\\evil.com"],
      ["triple-slash host URL", "///evil.com"],
      ["absolute external URL", "https://evil.com/dashboard"],
    ])("blocks open-redirect bypass (%s) and falls back to /dashboard", async (_label, next) => {
      mockExchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });

      const { GET } = await import("../src/app/auth/callback/route");
      const url = new URL("https://syncodex.xyz/auth/callback");
      url.searchParams.set("code", "auth-code-123");
      url.searchParams.set("next", next);

      const response = await GET(new NextRequest(url));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://syncodex.xyz/dashboard");
    });
  });
});
