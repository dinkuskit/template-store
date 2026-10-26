import { mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

import { draftProductPage, openPanel, openProductPage, openProductsList, panelPrice, publishProductPage, savePanelPrices } from "./helpers/product-page";

// Owns the persisted admin-to-anonymous-storefront boundary; demo runtime tests cannot catch split storage.
test("merchant product prices drive public listing and survive an admin reload", async ({ page, browser, request }, testInfo) => {
  test.setTimeout(240_000);
  const root = resolve("runs/commerce-catalog/browser", testInfo.project.name);
  await mkdir(root, { recursive: true });
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const admin = await context.newPage();
  await openProductsList(admin);
  await expect.poll(() => execFileSync("sqlite3", [".artifacts/e2e/content.db", "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'uidx_plugin_dinkus-commerce_catalogItems_%'"], { encoding: "utf8" }), { timeout: 90_000 }).toContain("uidx_plugin_dinkus-commerce_catalogItems_skuKey");
  // Commerce 0.6.0: the owner adds price and stock on the product's Content > Products page; it is a Draft.
  const name = `Merchant hat ${testInfo.project.name}`;
  const { pageId, itemId: id } = await draftProductPage(admin, { title: name, sku: `MERCHANT-${testInfo.project.name}` });
  const card = page.locator(`[data-commerce-product="${id}"]`);
  await page.goto("/");
  await expect(page.locator("[data-integration-demos]")).toHaveCount(0);
  await expect(card).toHaveCount(0);
  expect((await request.get(`/shop/${id}`)).status()).toBe(404);
  // Publishing the page puts the product on sale; with no price it still stays off the shop.
  await publishProductPage(admin, pageId);
  await page.reload();
  await expect(card).toHaveCount(0);
  let panel = await savePanelPrices(admin, "24", "");
  await expect(panelPrice(admin, panel, "Regular")).toHaveValue("24.00");
  await page.reload();
  await expect(page.locator("[data-catalog-guidance]")).toHaveAttribute("data-catalog-guidance-state", "ready");
  await expect(page.locator("[data-catalog-guidance]")).toContainText("Eligible products can be added to your cart");
  await expect(page.locator("[data-catalog-guidance]")).toContainText("Checkout is unavailable");
  await expect(page.locator("[data-catalog-guidance]")).not.toContainText(/catalog is unavailable/i);
  await expect(page.locator("[data-commerce-product]")).not.toHaveCount(0);
  await expect(card.locator("[data-regular-price]")).toHaveText("$24.00");
  await expect(card.locator("[data-commerce-availability]")).toHaveText("In stock");
  await expect(card.locator("[data-commerce-image-placeholder]")).toHaveText("No image");
  await expect(card.locator("img")).toHaveCount(0);
  // A product with its own page links to that page rather than adding to the cart from the card.
  await expect(card).toHaveAttribute("href", `/products/merchant-${testInfo.project.name}`);
  panel = await savePanelPrices(admin, "24", "18");
  await expect(panelPrice(admin, panel, "Sale")).toHaveValue("18.00");
  await page.reload();
  await expect(card.locator("s[data-regular-price]")).toHaveText("$24.00");
  await expect(card.locator("[data-sale-price]")).toHaveText("$18.00");
  await admin.screenshot({ path: resolve(root, "admin-sale.png"), fullPage: true, animations: "disabled" });
  await page.screenshot({ path: resolve(root, "public-sale.png"), fullPage: true, animations: "disabled" });
  // A price with a fraction of a cent is refused and nothing changes on the shop.
  panel = await savePanelPrices(admin, "12.999", "18");
  await expect(panelPrice(admin, panel, "Regular")).toHaveValue("12.999");
  await page.reload();
  await expect(card.locator("[data-sale-price]")).toHaveText("$18.00");
  await expect(card.locator("s[data-regular-price]")).toHaveText("$24.00");
  // The saved prices survive an admin reload.
  await admin.reload();
  await expect(panelPrice(admin, await openPanel(admin), "Sale")).toHaveValue("18.00");
  await expect(panelPrice(admin, await openPanel(admin), "Regular")).toHaveValue("24.00");
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
  await openProductPage(admin, pageId);
  await savePanelPrices(admin, "0", "");
  await page.goto("/");
  await expect(card.locator("[data-regular-price]")).toHaveText("$0.00");
  // Clearing the price keeps the product in Commerce but takes it off the shop.
  panel = await savePanelPrices(admin, "", "");
  await expect(panelPrice(admin, panel, "Regular")).toHaveValue("");
  await page.goto("/");
  await expect(card).toHaveCount(0);
  expect((await request.get(`/shop/${id}`)).status()).toBe(404);
  await expect(panel.getByText("On sale · SKU MERCHANT-" + testInfo.project.name, { exact: false })).toBeVisible();
  await admin.screenshot({ path: resolve(root, "admin-unpriced-retained.png"), fullPage: true, animations: "disabled" });
  await page.screenshot({ path: resolve(root, "public-hidden.png"), fullPage: true, animations: "disabled" });
  await context.close();
});
