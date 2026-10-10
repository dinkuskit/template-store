import { expect, test } from "@playwright/test";

test("home renders one EmDash Products collection instead of a direct Commerce grid", async ({ page, request }) => {
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  await page.goto("/");

  await expect(page.locator("[data-product-catalog]")).toHaveCount(1);
  await expect(page.locator("[data-product-catalog] h2")).toHaveText("Products");
  await expect(page.locator("[data-commerce-catalog]")).toHaveCount(0);
  await expect(page.locator("[data-product-catalog] .catalog-empty")).toHaveText(
    "No products are published. Add products in EmDash admin to populate this collection.",
  );
});
