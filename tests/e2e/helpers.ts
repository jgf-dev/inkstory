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

/**
 * Authenticates as a fresh E2E user identity (created lazily by syncAuthUser
 * on first dashboard hit: FREE plan, no novels). Each caller passes a unique
 * id/email so tests never collide on quota state.
 */
export async function authenticateAsNewUser(context: BrowserContext, id: string, email: string) {
  await context.addCookies([
    {
      name: "e2e-user",
      value: encodeURIComponent(JSON.stringify({ id, email })),
      domain: "localhost",
      path: "/",
      httpOnly: false,
      sameSite: "Lax",
    },
  ]);
}

/** Fresh identity for a run-scoped E2E user (id comes in as a UUID). */
export function launchUser(id: string) {
  return { id, email: `launch-qa-${id.slice(0, 8)}@inkstory.local` };
}
