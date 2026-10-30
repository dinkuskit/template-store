import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

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

// A store set up before template-store#118, as the beta store was: its categories have no products list, though
// every product's categories are linked. Storefront upgrade 004 gives the editor the list, showing those links.
test("an older store's category editor gains its products list with the links it already had", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const root = resolve(proofRoot, testInfo.project.name);
  await mkdir(root, { recursive: true });
  const headers = { "X-EmDash-Request": "1" };
  const links = () => {
    const database = new DatabaseSync(".artifacts/e2e/content.db");
    try {
      return database.prepare(`SELECT r.parent_group, r.child_group FROM _emdash_content_references r
        JOIN _emdash_relations rel ON rel.id = r.relation_id WHERE rel.slug = 'product_categories'
        ORDER BY r.parent_group, r.child_group`).all();
    } finally {
      database.close();
    }
  };
  const categoryField = async () => ((await (await page.request.get("/_emdash/api/schema/collections/categories/fields", { headers })).json())
    .data.items as { slug: string; label: string; type: string; validation?: Record<string, unknown> }[])
    .find((field) => field.slug === "products");

  await page.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/content/categories/hats");
  await dismissWelcome(page);
  const seeded = await categoryField();
  expect(seeded).toMatchObject({ label: "Products in this category", type: "reference" });

  // The older store: the field goes, the relation and its links stay.
  const removed = await page.request.delete("/_emdash/api/schema/collections/categories/fields/products", { headers });
  expect(removed.ok(), await removed.text()).toBe(true);
  const linked = links();
  expect(linked.length).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByText("Category title")).toBeVisible();
  await expect(page.getByText("Products in this category")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remove Canvas Cap" })).toHaveCount(0);
  await page.screenshot({ path: resolve(root, "older-store-category-hats.png"), fullPage: true });

  // What an owner runs, `pnpm search:upgrade`: every storefront upgrade on this store's database, as the store runs them.
  const upgraded = spawnSync("node", ["scripts/upgrade-storefront-search.ts", "--database=.artifacts/e2e/content.db"], { encoding: "utf8" });
  expect(upgraded.status, upgraded.stderr).toBe(0);
  expect(links()).toEqual(linked);
  // Stored the way a fresh seed stores it, so the editor and the site resolve it the same way.
  expect(await categoryField()).toMatchObject({ label: seeded!.label, type: seeded!.type, validation: seeded!.validation });
  expect(seeded!.validation).toMatchObject({ relation: "product_categories", relationSide: "parent", targetCollection: "products" });

  await page.reload();
  await expect(page.getByText("Products in this category")).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Canvas Cap" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Ribbed Beanie" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Everyday Tee" })).toHaveCount(0);
  await page.screenshot({ path: resolve(root, "upgraded-category-hats-products.png"), fullPage: true });
});
