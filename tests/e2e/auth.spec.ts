import { expect, test } from "@playwright/test";

test.describe("Authentication & Navigation QA", () => {
  test("unauthenticated access to /dashboard redirects to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/.*\/login/);
    await expect(page.locator("h1")).toContainText("Welcome back");
  });

  test("unauthenticated access to /dashboard/codex redirects to /login", async ({ page }) => {
    await page.goto("/dashboard/codex");
    await expect(page).toHaveURL(/.*\/login/);
    await expect(page.locator("h1")).toContainText("Welcome back");
  });

  test("login page displays form inputs and navigation to signup", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    const signupLink = page.locator('a[href="/signup"]');
    await expect(signupLink).toBeVisible();
    await signupLink.click();
    await expect(page).toHaveURL(/.*\/signup/);
  });
});
