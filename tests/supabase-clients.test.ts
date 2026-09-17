import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

  describe("createSupabaseServerClient E2E auth bypass", () => {
    afterEach(() => {
      delete process.env.NEXT_PUBLIC_E2E;
      vi.resetModules();
    });

    it("returns a stub client when NEXT_PUBLIC_E2E is true and e2e-user cookie is valid", async () => {
      process.env.NEXT_PUBLIC_E2E = "true";
      const { cookies } = await import("next/headers");
      const user = { id: "e2e-user-1", email: "seed@inkstory.local" };
      vi.mocked(cookies).mockResolvedValue({
        get: vi.fn().mockReturnValue({
          name: "e2e-user",
          value: encodeURIComponent(JSON.stringify(user)),
        }),
        getAll: vi.fn().mockReturnValue([]),
        set: vi.fn(),
      } as any);

      vi.resetModules();
      const { createSupabaseServerClient } = await import("../src/lib/supabase/server");
      const client = await createSupabaseServerClient();

      expect(mockCreateServerClient).not.toHaveBeenCalled();
      const { data, error } = await client.auth.getUser();
      expect(error).toBeNull();
      expect(data.user).toEqual(user);
      const session = await client.auth.getSession();
      expect(session.data.session?.user).toEqual(user);
      const signOut = await client.auth.signOut();
      expect(signOut.error).toBeNull();
    });

    it("falls back to Supabase client when e2e-user cookie JSON is invalid", async () => {
      process.env.NEXT_PUBLIC_E2E = "true";
      const { cookies } = await import("next/headers");
      vi.mocked(cookies).mockResolvedValue({
        get: vi.fn().mockReturnValue({ name: "e2e-user", value: "%7Bnot-json" }),
        getAll: vi.fn().mockReturnValue([]),
        set: vi.fn(),
      } as any);

      mockCreateServerClient.mockReturnValue({ auth: { getUser: vi.fn() } });
      vi.resetModules();
      const { createSupabaseServerClient } = await import("../src/lib/supabase/server");
      await createSupabaseServerClient();
      expect(mockCreateServerClient).toHaveBeenCalled();
    });

    it("falls back to Supabase client when NEXT_PUBLIC_E2E is true but cookie is missing", async () => {
      process.env.NEXT_PUBLIC_E2E = "true";
      const { cookies } = await import("next/headers");
      vi.mocked(cookies).mockResolvedValue({
        get: vi.fn().mockReturnValue(undefined),
        getAll: vi.fn().mockReturnValue([]),
        set: vi.fn(),
      } as any);

      mockCreateServerClient.mockReturnValue({ auth: { getUser: vi.fn() } });
      vi.resetModules();
      const { createSupabaseServerClient } = await import("../src/lib/supabase/server");
      await createSupabaseServerClient();
      expect(mockCreateServerClient).toHaveBeenCalled();
    });
  });
});
