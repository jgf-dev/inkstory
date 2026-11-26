import { randomUUID } from "node:crypto";
import { expect, type BrowserContext, type Page } from "@playwright/test";

/** Fresh identity for a run-scoped E2E user (id comes in as a UUID). */
export function launchUser(id: string) {
  return { id, email: `launch-qa-${id.slice(0, 8)}@inkstory.local` };
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

/** Advance only after client hydration so the first click cannot be lost. */
export async function advanceOnboardingToBookStep(page: Page) {
  const wizard = page.getByTestId("onboarding-wizard");
  await expect(wizard).toContainText("Welcome to InkStory");
  await expect(wizard).toHaveAttribute("data-hydrated", "true");
  await wizard.getByRole("button", { name: "Next →" }).click();
  await expect(wizard).toContainText("Start your first book");
}

/** Create an isolated user and its sample novel through the real onboarding UI. */
export async function authenticateAndSeedSample(context: BrowserContext, page: Page) {
  const user = launchUser(randomUUID());
  await authenticateAsNewUser(context, user.id, user.email);
  await page.goto("/dashboard");

  await advanceOnboardingToBookStep(page);
  const wizard = page.getByTestId("onboarding-wizard");
  await wizard.getByRole("button", { name: /Seed a sample fantasy bible/ }).click();
  await expect(wizard).toContainText("Meet your writing desk");
}
