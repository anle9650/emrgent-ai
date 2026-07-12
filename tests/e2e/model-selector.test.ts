import { expect, test } from "@playwright/test";

// Model names come from the curated `chatModels` list in lib/ai/models.ts;
// outside demo mode (IS_DEMO=1) they all render under one "Available" group.
test.describe("Model Selector", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("displays a model button", async ({ page }) => {
    await expect(page.getByTestId("model-selector")).toBeVisible();
  });

  test("opens model selector popover on click", async ({ page }) => {
    await page.getByTestId("model-selector").click();

    await expect(page.getByPlaceholder("Search models...")).toBeVisible();
  });

  test("can search for models", async ({ page }) => {
    await page.getByTestId("model-selector").click();

    const searchInput = page.getByPlaceholder("Search models...");
    await searchInput.fill("DeepSeek");

    await expect(page.getByText("DeepSeek V3.2").first()).toBeVisible();
  });

  test("can close model selector with escape", async ({ page }) => {
    await page.getByTestId("model-selector").click();

    await expect(page.getByPlaceholder("Search models...")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByPlaceholder("Search models...")).not.toBeVisible();
  });

  test("lists curated models under the Available group", async ({ page }) => {
    await page.getByTestId("model-selector").click();

    await expect(page.getByText("Available", { exact: true })).toBeVisible();
    await expect(page.getByText("Kimi K2.5").first()).toBeVisible();
    await expect(page.getByText("Grok 4.1 Fast").first()).toBeVisible();
  });

  test("can select a different model", async ({ page }) => {
    await page.getByTestId("model-selector").click();

    await page.getByText("DeepSeek V3.2").first().click();

    await expect(page.getByPlaceholder("Search models...")).not.toBeVisible();

    await expect(page.getByTestId("model-selector")).toContainText(
      "DeepSeek V3.2"
    );
  });
});
