import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mockCreateBrowserClient = vi.fn();
const mockCreateServerClient = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (...args: any[]) => mockCreateBrowserClient(...args),
  createServerClient: (...args: any[]) => mockCreateServerClient(...args),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

describe("Supabase Client Factories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
  });

  describe("createSupabaseBrowserClient", () => {
    it("creates a browser client with NEXT_PUBLIC environment variables", async () => {
      mockCreateBrowserClient.mockReturnValue({
        auth: {
          signInWithPassword: vi.fn(),
          signUp: vi.fn(),
          signOut: vi.fn(),
        },
      });

      const { createSupabaseBrowserClient } = await import("../src/lib/supabase/client");
      const client = createSupabaseBrowserClient();

      expect(mockCreateBrowserClient).toHaveBeenCalledWith(
        "https://example.supabase.co",
        "test-anon-key",
      );
      expect(client).toBeDefined();
    });
  });

  describe("createSupabaseServerClient", () => {
    it("configures server client with cookies getAll and setAll adapters", async () => {
      const { cookies } = await import("next/headers");
      const mockSet = vi.fn();
      const mockGetAll = vi.fn().mockReturnValue([{ name: "sb-auth-token", value: "token-value" }]);

      vi.mocked(cookies).mockResolvedValue({
        getAll: mockGetAll,
        set: mockSet,
      } as any);

      mockCreateServerClient.mockImplementation((url, key, options) => ({
        url,
        key,
        options,
        auth: { getUser: vi.fn() },
      }));

      const { createSupabaseServerClient } = await import("../src/lib/supabase/server");
      const client = await createSupabaseServerClient();
      expect(client).toBeDefined();

      expect(mockCreateServerClient).toHaveBeenCalledWith(
        "https://example.supabase.co",
        "test-anon-key",
        expect.objectContaining({
          cookies: expect.objectContaining({
            getAll: expect.any(Function),
            setAll: expect.any(Function),
          }),
        }),
      );

      const options = mockCreateServerClient.mock.calls[0][2];

      // Test getAll cookie handler
      const retrievedCookies = options.cookies.getAll();
      expect(retrievedCookies).toEqual([{ name: "sb-auth-token", value: "token-value" }]);
      expect(mockGetAll).toHaveBeenCalled();

      // Test setAll cookie handler
      options.cookies.setAll([{ name: "token1", value: "val1", options: { path: "/" } }]);
      expect(mockSet).toHaveBeenCalledWith("token1", "val1", { path: "/" });

      // Test setAll error suppression when invoked in Server Component (where cookieStore.set throws)
      mockSet.mockImplementation(() => {
        throw new Error("Cookies can only be modified in a Server Action or Route Handler.");
      });
      expect(() => {
        options.cookies.setAll([{ name: "token2", value: "val2", options: { path: "/" } }]);
      }).not.toThrow();
    });
  });
});
