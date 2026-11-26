import { expect, test } from "@playwright/test";
import { authenticateAndSeedSample } from "./helpers";

test.describe("Story Codex Live UI QA", () => {
  test.beforeEach(async ({ context, page }) => {
    await authenticateAndSeedSample(context, page);
  });

  test("loads codex dashboard and renders seeded entities", async ({ page }) => {
    await page.goto("/dashboard/codex");

    // Header validation
    await expect(page.locator("h1")).toContainText("Story Codex");

    // Sidebar list validation with seeded entries
    const sidebar = page.getByTestId("codex-entry-list");
    await expect(sidebar).toBeVisible();
    await expect(sidebar).toContainText("Mara Vance");
    await expect(sidebar).toContainText("Kaelen Ashwright");
  });

  test("filters entries using category pills and search input", async ({ page }) => {
    await page.goto("/dashboard/codex");

    const sidebar = page.getByTestId("codex-entry-list");

    // 1. Filter by Characters
    await page.getByRole("button", { name: "Characters" }).click();
    await expect(sidebar).toContainText("Mara Vance");
    await expect(sidebar).not.toContainText("Glass Needles");

    // 2. Filter by Items
    await page.getByRole("button", { name: "Items" }).click();
    await expect(sidebar).toContainText("Glass Needles");
    await expect(sidebar).not.toContainText("Mara Vance");

    // 3. Reset to All
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(sidebar).toContainText("Mara Vance");
    await expect(sidebar).toContainText("Glass Needles");

    // 4. Test real-time search input
    const searchInput = page.getByPlaceholder("Search entries...");
    await searchInput.fill("Kaelen");
    await expect(sidebar).toContainText("Kaelen Ashwright");
    await expect(sidebar).not.toContainText("Mara Vance");

    // 5. Clear search
    await searchInput.clear();
    await expect(sidebar).toContainText("Mara Vance");
  });

  test("creates a new codex entry via modal and selects it in the editor", async ({ page }) => {
    await page.goto("/dashboard/codex");

    // Open modal
    await page.getByRole("button", { name: "+ New Codex Entry" }).click();
    await expect(page.getByRole("heading", { name: "New Codex Entry" })).toBeVisible();

    // Fill form
    const uniqueName = `QA Test Element ${Date.now()}`;
    await page.getByPlaceholder("e.g. Mara Vance, Sunken Archives").fill(uniqueName);
    await page
      .getByPlaceholder("Primary world bible description...")
      .fill("Entity created during automated live QA testing.");
    await page.getByPlaceholder("e.g. The Glass Weaver, Mara").fill("Automaton, QA Bot");

    // Submit modal
    await page.getByRole("button", { name: "Create Entry" }).click();

    // Verify modal closes and entry is selected in editor
    const sidebar = page.getByTestId("codex-entry-list");
    await expect(sidebar).toContainText(uniqueName);

    // Editor should load the newly created entry details
    const editor = page.getByTestId("codex-editor");
    await expect(editor.locator('input[type="text"]').first()).toHaveValue(uniqueName);
  });

  test("inspects entry editor details and relations graph", async ({ page }) => {
    await page.goto("/dashboard/codex");

    // Select Mara Vance
    await page.getByTestId("codex-entry-list").getByText("Mara Vance").click();

    // Verify editor displays details
    const editor = page.getByTestId("codex-editor");
    await expect(editor).toContainText("Entry Name");
    await expect(editor).toContainText("Relations Graph");
    await expect(editor).toContainText("Kaelen Ashwright");
    await expect(editor).toContainText("Temporal Progressions");
  });

  test("renders layout cleanly on mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/dashboard/codex");

    await expect(page.locator("h1")).toContainText("Story Codex");
    await expect(page.getByRole("button", { name: "+ New Codex Entry" })).toBeVisible();
    await expect(page.getByPlaceholder("Search entries...")).toBeVisible();
  });
});
