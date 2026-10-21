import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const proofRoot = resolve("runs/admin-product-categories-20261021/browser");

async function dismissWelcome(page: Page): Promise<void> {
  const welcome = page.getByRole("dialog", { name: /Welcome to EmDash/ });
  try {
    await expect(page.getByRole("button", { name: "Get Started" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Get Started" }).click();
  } catch {
    await expect(welcome).toHaveCount(0);
  }
  await expect(welcome).toHaveCount(0);
}

test("the admin names product categories plainly and a category lists its products", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const root = resolve(proofRoot, testInfo.project.name);
  await mkdir(root, { recursive: true });

  await page.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/content/categories/hats");
  await expect(page).toHaveURL(/\/_emdash\/admin\/content\/categories\/hats/u);
  await dismissWelcome(page);

  await expect(page.getByText("Products in this category")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Canvas Cap" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Ribbed Beanie" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Everyday Tee" })).toHaveCount(0);
  await page.screenshot({ path: resolve(root, "category-hats-products.png"), fullPage: true });

  await page.goto("/_emdash/admin/content/categories");
  await expect(page.getByRole("heading", { name: "Product categories" })).toBeVisible();
  await page.screenshot({ path: resolve(root, "product-categories-list.png") });
});
