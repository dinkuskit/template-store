import { execFileSync } from "node:child_process";

import { expect, test } from "@playwright/test";

import { GUEST_CART_STORAGE_KEY } from "../../src/features/guest-cart/index.js";
import { COMMERCE_SKU_INDEX, listCatalog, openProductsList, sellProduct } from "./helpers/product-page";

test("open carts and header counts follow another tab without losing an unsaved cart", async ({ browser, request }, testInfo) => {
  test.setTimeout(180_000);
  expect(testInfo.project.name.startsWith("shipping-")).toBe(false);
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  const adminContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const admin = await adminContext.newPage();
  await openProductsList(admin);
  await expect.poll(() => execFileSync("sqlite3", [".artifacts/e2e/content.db",
    "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'uidx_plugin_%_catalog_items_%'"],
  { encoding: "utf8" }), { timeout: 90_000 }).toContain(COMMERCE_SKU_INDEX);
  await expect.poll(async () => { try { await listCatalog(admin.request); return true; } catch { return false; } }).toBe(true);
  const slug = `cross-tab-${testInfo.project.name}`;
  const { itemId } = await sellProduct(admin.request, {
    title: `Cross-tab notebook ${testInfo.project.name}`, sku: slug.toUpperCase(), slug, regular: "12",
  });

  const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
  try {
    const a = await context.newPage();
    const b = await context.newPage();
    const stored = () => a.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), GUEST_CART_STORAGE_KEY);
    await a.goto(`/products/${slug}`);
    await expect(a.locator("[data-add-to-cart]")).toHaveAttribute("data-guest-cart-ready", "1");
    await a.locator("[data-add-to-cart]").click();
    await expect.poll(async () => (await stored()).lines).toEqual([{ id: itemId, quantity: 1 }]);
    await a.goto("/cart");
    await expect(a.locator("[data-guest-cart-subtotal-amount]")).toHaveText("$12.00");
    await b.goto("/cart");
    await expect(b.locator("[data-guest-cart-subtotal-amount]")).toHaveText("$12.00");
    // Rehydration must not register duplicate external-change listeners.
    await a.evaluate(() => {
      document.dispatchEvent(new Event("dinkus:guest-cart-hydrate"));
      document.dispatchEvent(new Event("dinkus:guest-cart-hydrate"));
    });
    await b.locator("[data-guest-cart-qty]").fill("3");
    await b.locator("[data-guest-cart-qty]").press("Tab");
    await expect(a.locator("[data-guest-cart-qty]")).toHaveValue("3");
    await expect(a.locator("[data-guest-cart-subtotal-amount]")).toHaveText("$36.00");
    await expect(a.locator("[data-guest-cart-count]").first()).toHaveText("3");
    await a.screenshot({ path: testInfo.outputPath("other-tab-quantity.png"), fullPage: true });

    // Pages with only an Add button and a header count need the same synchronization.
    await a.goto(`/products/${slug}`);
    await expect(a.locator("[data-add-to-cart]")).toHaveAttribute("data-guest-cart-ready", "1");
    await b.locator("[data-guest-cart-qty]").fill("4");
    await b.locator("[data-guest-cart-qty]").press("Tab");
    await expect(a.locator("[data-guest-cart-count]").first()).toHaveText("4");
    await a.locator("[data-add-to-cart]").click();
    await expect(b.locator("[data-guest-cart-qty]")).toHaveValue("5");
    await expect(b.locator("[data-guest-cart-subtotal-amount]")).toHaveText("$60.00");
    await b.locator("[data-guest-cart-remove]").click();
    await expect(a.locator("[data-guest-cart-count]").first()).toHaveText("0");
    await a.goto("/cart");
    await expect(a.locator("[data-guest-cart-empty]")).toBeVisible();

    // Read external values through the existing validator, never the event payload.
    await b.evaluate((key) => localStorage.setItem(key, "not-json"), GUEST_CART_STORAGE_KEY);
    await expect(a.locator("[data-guest-cart-status]")).toContainText("Saved cart data was rejected");
    await expect(a.locator("[data-guest-cart-empty]")).toBeVisible();
    expect(await a.evaluate((key) => localStorage.getItem(key), GUEST_CART_STORAGE_KEY)).toBe("not-json");
    await b.evaluate((key) => localStorage.removeItem(key), GUEST_CART_STORAGE_KEY);
    await expect(a.locator("[data-guest-cart-status]")).toBeHidden();
    await b.evaluate(({ key, id }) => localStorage.setItem(key, JSON.stringify({ version: 1, lines: [{ id, quantity: 2 }] })),
      { key: GUEST_CART_STORAGE_KEY, id: itemId });
    await expect(a.locator("[data-guest-cart-subtotal-amount]")).toHaveText("$24.00");
    await b.evaluate(() => localStorage.clear()); // Native StorageEvent.key === null.
    await expect(a.locator("[data-guest-cart-empty]")).toBeVisible();

    // A failed write leaves a deliberate in-memory cart. Other tabs and page lifecycle events must not erase it.
    await a.goto(`/products/${slug}`);
    await expect(a.locator("[data-add-to-cart]")).toHaveAttribute("data-guest-cart-ready", "1");
    await a.evaluate((key) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key) throw new Error("storage blocked");
        return original.call(this, name, value);
      };
    }, GUEST_CART_STORAGE_KEY);
    await a.locator("[data-add-to-cart]").click();
    await expect(a.locator("[data-add-to-cart-status]")).toContainText("Leave or reload this page");
    await expect(a.locator("[data-guest-cart-count]").first()).toHaveText("1");
    await b.evaluate(({ key, id }) => localStorage.setItem(key, JSON.stringify({ version: 1, lines: [{ id, quantity: 7 }] })),
      { key: GUEST_CART_STORAGE_KEY, id: itemId });
    await a.evaluate(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await expect(a.locator("[data-guest-cart-count]").first()).toHaveText("1");
    await expect(a.locator("[data-add-to-cart-status]")).toContainText("Leave or reload this page");
    expect((await stored()).lines).toEqual([{ id: itemId, quantity: 7 }]);
  } finally {
    await context.close();
    await adminContext.close();
  }
});
