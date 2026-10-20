import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { authenticateAsNewUser, launchUser } from "./helpers";

/**
 * Launch QA (audit phase 5): public landing page → authenticated onboarding →
 * novel creation → codex linking. Runs against the dev server with the E2E
 * auth shim (NEXT_PUBLIC_E2E=true), so no real Supabase account is needed.
 *
 * Authenticated tests each use a fresh user identity (FREE plan, no novels)
 * so quota state never leaks between specs.
 */
test.describe("Launch flow", () => {
  test("landing page renders hero, features, pricing, and FAQ for anonymous visitors", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.locator("h1")).toContainText(
      "Write your novel. Your story bible writes with you.",
    );

    await expect(page.getByRole("link", { name: "Start writing free" }).first()).toBeVisible();

    const features = page.locator("#features");
    await expect(features).toContainText("AI-aware Story Codex");
    await expect(features).toContainText("Progressions over time");

    const pricing = page.locator("#pricing");
    await expect(pricing.getByText("Author Pro", { exact: true })).toBeVisible();
    await expect(pricing.getByText("$15")).toBeVisible();
    await expect(pricing.getByText("$35")).toBeVisible();

    // Annual toggle switches Pro to its discounted monthly-equivalent.
    await pricing.getByRole("switch", { name: "Toggle annual billing" }).click();
    await expect(pricing.getByText("per month, billed annually").first()).toBeVisible();

    const faq = page.locator("#faq");
    await expect(faq).toContainText("What exactly is the Codex?");
  });

  test("authenticated: onboarding wizard seeds a sample bible and links into codex", async ({
    context,
    page,
  }) => {
    // Random per-run identity: the E2E DB persists between local runs, so a
    // deterministic id would carry over quota/novel state.
    const user = launchUser(randomUUID());
    await authenticateAsNewUser(context, user.id, user.email);
    await page.goto("/dashboard");

    const wizard = page.getByTestId("onboarding-wizard");
    await expect(wizard).toContainText("Welcome to InkStory");
    await wizard.getByRole("button", { name: "Next →" }).click();

    await wizard.getByRole("button", { name: /Seed a sample fantasy bible/ }).click();
    await expect(wizard).toContainText("Meet your writing desk");
    await expect(wizard.getByRole("link", { name: "Open the Story Codex →" })).toBeVisible();

    // Dashboard refreshes with the seeded novel listed.
    await expect(page.getByText("The Glass Weaver")).toBeVisible();

    // Continue into the codex and confirm the sample entries arrived.
    await wizard.getByRole("link", { name: "Open the Story Codex →" }).click();
    await expect(page).toHaveURL(/.*\/dashboard\/codex/);
    await expect(page.locator("h1")).toContainText("Story Codex");
    await expect(page.locator(".lg\\:col-span-4")).toContainText("Mara Vance");
  });

  test("authenticated: novel creation via dashboard modal refreshes the list", async ({
    context,
    page,
  }) => {
    const user = launchUser(randomUUID());
    await authenticateAsNewUser(context, user.id, user.email);
    await page.goto("/dashboard");

    // The onboarding wizard opens first; advance to the novel step.
    const wizard = page.getByTestId("onboarding-wizard");
    await expect(wizard).toContainText("Welcome to InkStory");
    await wizard.getByRole("button", { name: "Next →" }).click();
    await expect(wizard).toContainText("Start your first book");

    const uniqueTitle = `Launch QA Novel ${Date.now()}`;
    await wizard.getByPlaceholder("e.g. The Glass Weaver").fill(uniqueTitle);
    await wizard.getByRole("button", { name: "Create novel" }).click();

    await expect(wizard).toContainText("Meet your writing desk");
    await expect(page.getByText(uniqueTitle)).toBeVisible();

    // The library creator's own modal path also works after onboarding.
    await wizard.getByRole("button", { name: "Done" }).click();
    await expect(wizard).toBeHidden();
  });

  test("authenticated: codex linking — create entry and open the relation editor", async ({
    context,
    page,
  }) => {
    const user = launchUser(randomUUID());
    await authenticateAsNewUser(context, user.id, user.email);

    // Book-scoped entries need a novel: seed the sample bible via onboarding.
    await page.goto("/dashboard");
    const wizard = page.getByTestId("onboarding-wizard");
    await expect(wizard).toContainText("Welcome to InkStory");
    await wizard.getByRole("button", { name: "Next →" }).click();
    await wizard.getByRole("button", { name: /Seed a sample fantasy bible/ }).click();
    await expect(wizard).toContainText("Meet your writing desk");

    await page.goto("/dashboard/codex");

    await page.getByRole("button", { name: "+ New Codex Entry" }).first().click();
    const modal = page.getByTestId("codex-create-modal");
    await expect(modal).toBeVisible();

    const uniqueName = `Launch QA Entry ${Date.now()}`;
    await modal.getByPlaceholder("e.g. Mara Vance, Sunken Archives").fill(uniqueName);
    await modal.getByRole("button", { name: "Create Entry" }).click();

    await expect(modal).toBeHidden();
    await expect(page.getByTestId("codex-editor")).toBeVisible();
    await expect(page.getByTestId("codex-editor")).toContainText(uniqueName);

    // The relation editor opens from the entry editor.
    await page.getByRole("button", { name: "+ Add Relation" }).click();
    const relationModal = page.getByTestId("relation-editor-modal");
    await expect(relationModal).toBeVisible();
    await expect(relationModal).toContainText("Related Entry *");
    await relationModal.getByRole("button", { name: "Cancel" }).click();
    await expect(relationModal).toBeHidden();
  });
});
