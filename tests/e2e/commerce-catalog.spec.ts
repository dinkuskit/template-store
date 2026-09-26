import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

// Owns the persisted admin-to-anonymous-storefront boundary; demo runtime tests cannot catch split storage.
test("merchant product prices drive public listing and survive an admin reload", async ({ page, browser, request }, testInfo) => {
  test.setTimeout(240_000);
  const root = resolve("runs/commerce-catalog/browser", testInfo.project.name);
  await mkdir(root, { recursive: true });
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const admin = await context.newPage();
  await admin.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/products");
  try {
    await expect(admin.getByRole("button", { name: "Get Started" })).toBeVisible({ timeout: 30_000 });
    await admin.getByRole("button", { name: "Get Started" }).click();
  } catch {
    await expect(admin.getByRole("dialog", { name: /Welcome to EmDash/ })).toHaveCount(0);
  }
  await expect(admin.getByRole("heading", { name: "Products", exact: true })).toBeVisible();
  await expect.poll(() => execFileSync("sqlite3", [".artifacts/e2e/content.db", "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'uidx_plugin_dinkus-commerce_catalogItems_%'"], { encoding: "utf8" }), { timeout: 90_000 }).toContain("uidx_plugin_dinkus-commerce_catalogItems_skuKey");
  const name = `Merchant hat ${testInfo.project.name}`;
  await admin.getByLabel("Name", { exact: true }).fill(name);
  await admin.getByLabel("SKU", { exact: true }).fill(`MERCHANT-${testInfo.project.name}`);
  const created = admin.waitForResponse(r => r.url().endsWith("/catalog-items/create") && r.request().method() === "POST");
  await admin.getByRole("button", { name: "Add product", exact: true }).click();
  const response = await created;
  expect(response.ok(), await response.text()).toBe(true);
  const id = (await response.json()).data.item.itemId;
  const card = page.locator(`[data-commerce-product="${id}"]`);
  await expect(admin.getByLabel("Regular", { exact: true })).toBeVisible();
  await page.goto("/");
  await expect(card).toHaveCount(0);
  expect((await request.get(`/shop/${id}`)).status()).toBe(404);
  async function save(regular: string, sale: string) {
    await admin.getByLabel("Regular", { exact: true }).fill(regular);
    await admin.getByLabel("Sale", { exact: true }).fill(sale);
    const saved = admin.waitForResponse(r => r.url().endsWith("/catalog-items/save-prices") && r.request().method() === "POST");
    await admin.getByRole("button", { name: "Save", exact: true }).click();
    const result = await saved;
    expect(result.ok(), await result.text()).toBe(true);
    return (await result.json()).data;
  }
  expect((await save("24", "")).saved).toBe(true);
  await page.reload();
  await expect(card.locator("[data-regular-price]")).toHaveText("$24.00");
  await expect(card.locator("[data-commerce-availability]")).toHaveText("In stock");
  expect((await save("24", "18")).saved).toBe(true);
  await page.reload();
  await expect(card.locator("s[data-regular-price]")).toHaveText("$24.00");
  await expect(card.locator("[data-sale-price]")).toHaveText("$18.00");
  await admin.screenshot({ path: resolve(root, "admin-sale.png"), fullPage: true, animations: "disabled" });
  await page.screenshot({ path: resolve(root, "public-sale.png"), fullPage: true, animations: "disabled" });
  await card.getByRole("link", { name: "View product", exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(card.locator("[data-sale-price]")).toHaveText("$18.00");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: resolve(root, "public-product.png"), fullPage: true, animations: "disabled" });
  expect((await save("12.999", "18")).saved).toBe(false);
  await expect(admin.getByLabel("Regular", { exact: true })).toHaveValue("12.999");
  await page.reload();
  await expect(card.locator("[data-sale-price]")).toHaveText("$18.00");
  expect((await save("24", "18")).saved).toBe(true);
  await admin.reload();
  await admin.getByRole("button", { name, exact: true }).click();
  await expect(admin.getByLabel("Sale", { exact: true })).toHaveValue("18.00");
  const statusRoute = "/_emdash/api/plugins/dinkus-commerce/catalog-items/set-manual-availability";
  const denied = await page.request.post(statusRoute, { data: { catalogItemId: id, status: "out-of-stock" }, headers: { "X-EmDash-Request": "1" } });
  expect([401, 403]).toContain(denied.status());
  for (const status of ["out-of-stock", "available-on-backorder", "in-stock"]) {
    const changed = await admin.request.post(statusRoute, { data: { catalogItemId: id, status }, headers: { "X-EmDash-Request": "1" } });
    expect(changed.ok(), await changed.text()).toBe(true);
    await page.reload();
    await expect(card.locator("[data-commerce-availability]")).toHaveAttribute("data-commerce-availability", status);
    await expect(card.locator("[data-stock-value]")).toHaveCount(0);
  }
  await context.addCookies([{ name: "emdash-edit-mode", value: "true", url: new URL(page.url()).origin }]);
  const editPage = await context.newPage();
  await editPage.goto("/");
  await expect(editPage.getByRole("checkbox", { name: "Edit mode" })).toBeChecked();
  await expect(editPage.locator(`[data-commerce-product="${id}"] [data-sale-price]`)).toHaveText("$18.00");
  await editPage.screenshot({ path: resolve(root, "public-edit.png"), fullPage: true, animations: "disabled" });
  await editPage.close();
  await admin.goto("/_emdash/admin/plugins/dinkus-commerce/products");
  await admin.getByRole("button", { name, exact: true }).click();
  expect((await save("0", "")).saved).toBe(true);
  await page.goto("/");
  await expect(card.locator("[data-regular-price]")).toHaveText("$0.00");
  expect((await save("", "")).saved).toBe(true);
  await page.goto("/");
  await expect(card).toHaveCount(0);
  expect((await request.get(`/shop/${id}`)).status()).toBe(404);
  await expect(admin.getByRole("button", { name, exact: true })).toBeVisible();
  await admin.screenshot({ path: resolve(root, "admin-unpriced-retained.png"), fullPage: true, animations: "disabled" });
  await page.screenshot({ path: resolve(root, "public-hidden.png"), fullPage: true, animations: "disabled" });
  await context.close();
});
