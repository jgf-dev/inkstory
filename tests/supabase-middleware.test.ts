import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockCreateServerClient = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: (...args: any[]) => mockCreateServerClient(...args),
}));

describe("Supabase Middleware & Proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  });

  describe("updateSession", () => {
    it("creates server client, touches session with getUser, and handles cookies", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
      mockCreateServerClient.mockImplementation((url, key, options) => ({
        auth: { getUser: mockGetUser },
        options,
      }));

      const requestCookieStore = new Map<string, string>([["auth-cookie", "initial-val"]]);

      const mockSet = vi.fn().mockImplementation((name, value) => {
        requestCookieStore.set(name, value);
      });
      const mockGetAll = vi
        .fn()
        .mockImplementation(() =>
          Array.from(requestCookieStore.entries()).map(([name, value]) => ({ name, value })),
        );

      const mockRequest = {
        cookies: {
          getAll: mockGetAll,
          set: mockSet,
        },
        headers: new Headers(),
        nextUrl: new URL("http://localhost:3000/dashboard"),
      } as unknown as NextRequest;

      const { updateSession } = await import("../src/lib/supabase/middleware");
      const response = await updateSession(mockRequest);

      expect(mockCreateServerClient).toHaveBeenCalledWith(
        "https://example.supabase.co",
        "test-anon-key",
        expect.any(Object),
      );
      expect(mockGetUser).toHaveBeenCalled();
      expect(response).toBeDefined();

      // Test cookie adapter callbacks
      const options = mockCreateServerClient.mock.calls[0][2];
      const cookiesRetrieved = options.cookies.getAll();
      expect(cookiesRetrieved).toEqual([{ name: "auth-cookie", value: "initial-val" }]);

      options.cookies.setAll([
        { name: "refreshed-token", value: "new-token", options: { path: "/" } },
      ]);
      expect(mockSet).toHaveBeenCalledWith("refreshed-token", "new-token");
    });
  });

  describe("proxy", () => {
    it("delegates request to updateSession and exports static file exclusion matcher", async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
      mockCreateServerClient.mockImplementation((url, key, options) => ({
        auth: { getUser: mockGetUser },
        options,
      }));

      const mockRequest = {
        cookies: {
          getAll: vi.fn().mockReturnValue([]),
          set: vi.fn(),
        },
        headers: new Headers(),
        nextUrl: new URL("http://localhost:3000/"),
      } as unknown as NextRequest;

      const { proxy, config } = await import("../src/proxy");
      const response = await proxy(mockRequest);

      expect(response).toBeDefined();
      expect(mockGetUser).toHaveBeenCalled();

      // Verify matcher regex correctly filters static assets
      expect(config.matcher).toBeDefined();
      const pattern = new RegExp(`^${config.matcher[0]}$`);
      expect(pattern.test("/dashboard")).toBe(true);
      expect(pattern.test("/login")).toBe(true);
      expect(pattern.test("/api/health")).toBe(true);
      expect(pattern.test("/_next/static/chunk.js")).toBe(false);
      expect(pattern.test("/favicon.ico")).toBe(false);
      expect(pattern.test("/hero.png")).toBe(false);
      expect(pattern.test("/logo.svg")).toBe(false);
    });
  });
});
