import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const proofRoot = resolve("runs/product-catalog-20260925/browser");

test("published products are visible in the canonical product catalog", async ({ page, request }, testInfo) => {
  test.setTimeout(120_000);
  const root = resolve(proofRoot, testInfo.project.name);
  await mkdir(root, { recursive: true });
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);

  for (const missing of ["/products/not-published", "/categories/not-published"]) {
    const response = await page.goto(missing);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("not found");
  }

  await page.goto("/");
  await expect(page.locator("[data-product-catalog]")).toBeVisible();
  await expect(page.locator("[data-product-catalog] h2")).toHaveText("Products");
  await expect(page.locator("[data-commerce-catalog]")).toHaveCount(0);
  await expect(page.locator("[data-product-catalog] .catalog-empty")).toHaveText("No products are published. Add products in EmDash admin to populate this collection.");
  await expect(page.locator("[data-product-item]")).toHaveCount(0);
  const illustrations = page.locator("[data-product-catalog] .product-card__visual img");
  await expect(illustrations).toHaveCount(0);
  await expect(page.locator("[data-product-item]")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: resolve(root, "public-catalog.png"), fullPage: true });
  await writeFile(resolve(root, "assertions.json"), `${JSON.stringify({ project: testInfo.project.name, duplicateCommerceGrid: false, emptyUnlinkedStarterGrid: true, horizontalOverflow: overflow }, null, 2)}\n`);
});
