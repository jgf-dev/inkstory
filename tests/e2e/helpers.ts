import type { BrowserContext } from "@playwright/test";

export const SEED_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "seed@inkstory.local",
  name: "Seed User",
  user_metadata: {
    name: "Seed User",
  },
};

/**
 * Injects an E2E authenticated user cookie recognized by createSupabaseServerClient
 * when NEXT_PUBLIC_E2E=true.
 */
export async function authenticateAsSeedUser(context: BrowserContext) {
  await context.addCookies([
    {
      name: "e2e-user",
      value: encodeURIComponent(JSON.stringify(SEED_USER)),
      domain: "localhost",
      path: "/",
      httpOnly: false,
      sameSite: "Lax",
    },
  ]);
}
