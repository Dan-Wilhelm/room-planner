import { expect, test } from "@playwright/test";

const PASSWORD = process.env.E2E_PASSWORD ?? "localtest";

test("full flow in mock mode", async ({ page }) => {
  page.on("dialog", (d) => d.accept());

  // Login
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Your projects" })).toBeVisible();

  // Project + room
  await page.getByPlaceholder(/New project name/).fill("Test apartment");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByLabel("Project name")).toHaveValue("Test apartment");
  await page.getByPlaceholder(/New room/).fill("Attic bedroom");
  await page.getByRole("button", { name: "Add room" }).click();
  await expect(page.getByRole("heading", { name: "Attic bedroom" })).toBeVisible();

  // Capture: description only → AI estimates everything (mock)
  await page.getByPlaceholder(/What is the room used for/).fill("L-shaped attic bedroom with a niche to the east and a sloped ceiling on the north side.");
  await page.getByRole("button", { name: "Analyse with AI" }).click();

  // Review: estimates visible, confirm
  await expect(page.getByText(/Estimated values \(\d+\)/)).toBeVisible();
  await expect(page.getByText(/No real measurement given/)).toBeVisible();
  await page.getByRole("button", { name: "Confirm room model" }).click();

  // Furniture: confirm recognized items
  await expect(page.getByText("Furniture the AI recognized")).toBeVisible();
  await page.getByRole("button", { name: /Add \(please check the size\)/ }).first().click();
  await page.getByRole("button", { name: /Add \(please check the size\)/ }).first().click();
  await expect(page.getByLabel("Name").first()).toHaveValue("Double bed");
  await page.getByRole("button", { name: /Next: taste/ }).click();

  // Taste & idea
  await page.getByText("I don't know yet — show me different directions.").click();
  await page.getByPlaceholder("e.g. bedroom with a home office corner").fill("bedroom with a home office corner");
  await page.locator("input[inputmode=decimal]").last().fill("300");
  await page.getByRole("button", { name: /Next: designs/ }).click();

  // Designs
  await page.getByRole("button", { name: "Create 3 designs" }).click();
  const compare = page.locator("section", { has: page.getByRole("heading", { name: "Compare" }) });
  await expect(compare.getByRole("row")).toHaveCount(4, { timeout: 90_000 });
  await expect(page.getByText("Status:")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/Done/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("heading", { name: /^Products — Budget/ })).toBeVisible();

  // Alternatives on the rug
  const rugCard = page.locator("div.rounded-lg", { hasText: "Rug 160×230" }).filter({ has: page.getByRole("button", { name: "Alternatives" }) }).first();
  await rugCard.getByRole("button", { name: "Alternatives" }).click();
  await page.getByPlaceholder(/cheaper, in green/).fill("cheaper");
  await page.getByRole("button", { name: "Find alternatives" }).click();
  const alts = page.locator("aside").getByRole("button", { name: /Swap/ });
  await expect(alts.first()).toBeVisible({ timeout: 60_000 });
  expect(await page.locator("aside").getByText(/Alt \d \(mock\)/).count()).toBeGreaterThanOrEqual(5);
  await alts.first().click();
  await expect(page.locator("aside").getByText(/Current \(Budget\)/)).toBeVisible();

  // Image (mock echoes the 3D screenshot)
  await page.getByRole("button", { name: "Generate image" }).click();
  await expect(page.getByAltText(/Photorealistic render of/)).toBeVisible({ timeout: 60_000 });

  // Shopping list CSV
  await page.getByRole("button", { name: "Shopping list" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  await page.getByRole("button", { name: "Close", exact: true }).click();

  // Build on this design with a locked item
  await page.getByRole("button", { name: "Build on this design" }).click();
  await page.getByPlaceholder(/desk by the window/).fill("warmer light, cheaper rug");
  await page.locator("label", { hasText: "Pendant lamp" }).first().locator("input[type=checkbox]").check();
  await page.getByRole("button", { name: "Create variations" }).click();
  await expect(page.getByText(/History \(1 earlier run/)).toBeVisible({ timeout: 90_000 });
  await expect(compare.getByRole("row")).toHaveCount(3, { timeout: 90_000 });

  // Mark chosen → project overview
  await page.getByRole("button", { name: "Mark as chosen" }).click();
  await expect(page.getByRole("button", { name: "Unmark as chosen" })).toBeVisible();
  await page.getByRole("link", { name: "Test apartment" }).click();
  await page.getByRole("button", { name: "Overview & shopping list" }).click();
  await expect(page.getByText(/Combined shopping list — €\d/)).toBeVisible();
});
