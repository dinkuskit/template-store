import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type APIResponse, type Page } from "@playwright/test";

import { GUEST_CART_STORAGE_KEY } from "../../src/features/guest-cart/index.js";

const CREATE_ROUTE = "/_emdash/api/plugins/dinkus-commerce/catalog-items/create";
const LIST_ROUTE = "/_emdash/api/plugins/dinkus-commerce/catalog-items/list";
const SAVE_ROUTE = "/_emdash/api/plugins/dinkus-commerce/catalog-items/save-prices";
const STATUS_ROUTE = "/_emdash/api/plugins/dinkus-commerce/catalog-items/set-manual-availability";

function inventoryishUrl(url: string): boolean {
  return /configure-inventory|@dinkuskit\/inventory|dinkuskit\.inventory|\/api\/proof\//iu.test(url);
}

function unwrap<T>(body: unknown): T {
  if (typeof body === "object" && body !== null && "data" in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

async function adminPost(admin: Page, path: string, data: Record<string, unknown>): Promise<APIResponse> {
  return admin.request.post(path, {
    data,
    headers: { "X-EmDash-Request": "1", "content-type": "application/json" },
  });
}

function readStoredIntent(raw: string | null): { version: number; lines: { id: string; quantity: number }[] } {
  expect(raw).toBeTruthy();
  const parsed: unknown = JSON.parse(raw as string);
  expect(parsed).toEqual({
    version: 1,
    lines: expect.any(Array),
  });
  const intent = parsed as { version: number; lines: unknown[] };
  expect(Object.keys(intent).sort()).toEqual(["lines", "version"]);
  for (const line of intent.lines) {
    expect(line).toEqual({ id: expect.any(String), quantity: expect.any(Number) });
    expect(Object.keys(line as object).sort()).toEqual(["id", "quantity"]);
  }
  return parsed as { version: number; lines: { id: string; quantity: number }[] };
}

test("guest cart persists shopper intent and stays honest when checkout is unavailable", async ({
  browser,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(testInfo.project.name.startsWith("shipping-")).toBe(true);
  const root = resolve("runs/guest-cart/browser", testInfo.project.name);
  await mkdir(root, { recursive: true });
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);

  const adminContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const admin = await adminContext.newPage();
  await admin.goto("/_emdash/api/auth/dev-bypass?redirect=/_emdash/admin/plugins/dinkus-commerce/products");
  try {
    await expect(admin.getByRole("button", { name: "Get Started" })).toBeVisible({ timeout: 30_000 });
    await admin.getByRole("button", { name: "Get Started" }).click();
  } catch {
    await expect(admin.getByRole("dialog", { name: /Welcome to EmDash/ })).toHaveCount(0);
  }
  await expect(admin.getByRole("heading", { name: "Products", exact: true })).toBeVisible();
  expect(existsSync(".artifacts/e2e-shipping/content.db")).toBe(true);
  await expect.poll(
    () =>
      execFileSync(
        "sqlite3",
        [
          ".artifacts/e2e-shipping/content.db",
          "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'uidx_plugin_dinkus-commerce_catalogItems_%'",
        ],
        { encoding: "utf8" },
      ),
    { timeout: 90_000 },
  ).toContain("uidx_plugin_dinkus-commerce_catalogItems_skuKey");
  await expect.poll(async () => {
    const listed = await adminPost(admin, LIST_ROUTE, {});
    return listed.ok();
  }, { timeout: 15_000 }).toBe(true);

  const name = `Guest cart hat ${testInfo.project.name}`;
  const sku = `CART-${testInfo.project.name.replaceAll(/[^A-Za-z0-9]+/g, "-").toUpperCase()}`;
  const created = await adminPost(admin, CREATE_ROUTE, {
    commandId: `guest-cart-${crypto.randomUUID()}`,
    name,
    sku,
    manageStock: false,
  });
  expect(created.ok(), await created.text()).toBe(true);
  const id = unwrap<{ item: { itemId: string } }>(await created.json()).item.itemId;
  const priced = await adminPost(admin, SAVE_ROUTE, { catalogItemId: id, regular: "24", sale: "" });
  expect(priced.ok(), await priced.text()).toBe(true);
  expect(unwrap<{ saved: boolean }>(await priced.json()).saved).toBe(true);

  const inventoryRequests: string[] = [];
  const shopperContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  shopperContext.on("request", (req) => {
    if (inventoryishUrl(req.url())) inventoryRequests.push(req.url());
  });
  const shopper = await shopperContext.newPage();
  shopper.on("request", (req) => {
    if (inventoryishUrl(req.url())) inventoryRequests.push(req.url());
  });
  await shopper.goto("/");
  await expect(shopper.locator("body")).toHaveAttribute("data-storefront-profile", "shipping");
  await expect(shopper.getByRole("checkbox", { name: "Edit mode" })).toHaveCount(0);
  await expect(shopper.getByText("Edit mode")).toHaveCount(0);
  expect(
    (await shopperContext.cookies()).filter((cookie) => /emdash|session|auth|token/i.test(cookie.name)),
  ).toEqual([]);
  const card = shopper.locator(`[data-commerce-product="${id}"]`);
  await expect(card.getByRole("button", { name: "Add to cart", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(shopper.locator("[data-stock-value]")).toHaveCount(0);
  await expect(shopper.locator("[data-managed-product]")).toHaveCount(0);
  await expect(shopper.getByRole("link", { name: /Cart/ })).toBeVisible();

  await shopper.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(name: string, value: string) {
      if (name === key) throw new Error("storage blocked");
      return original.call(this, name, value);
    };
  }, GUEST_CART_STORAGE_KEY);
  await card.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(card.locator("[data-add-to-cart-status]")).toContainText("Leave or reload this page");
  await expect(card.locator("[data-add-to-cart-status]")).not.toHaveText("Added to cart.");
  expect(await shopper.evaluate((key) => localStorage.getItem(key), GUEST_CART_STORAGE_KEY)).toBeNull();
  await shopper.reload();
  await expect(card.getByRole("button", { name: "Add to cart", exact: true })).toBeVisible();
  await card.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(card.locator("[data-add-to-cart-status]")).toHaveText("Added to cart.");
  const storedAfterAdd = readStoredIntent(
    await shopper.evaluate((key) => localStorage.getItem(key), GUEST_CART_STORAGE_KEY),
  );
  expect(storedAfterAdd.lines).toEqual([{ id, quantity: 1 }]);

  await shopper.getByRole("link", { name: /Cart/ }).click();
  await expect(shopper.locator("[data-guest-cart]")).toBeVisible();
  await expect(shopper.getByRole("heading", { name, exact: true })).toBeVisible();
  const qty = shopper.locator(`[data-guest-cart-qty="${id}"]`);
  const remove = shopper.locator(`[data-guest-cart-remove="${id}"]`);
  await expect(qty).toHaveValue("1");
  await expect(shopper.locator("[data-guest-cart-checkout]")).toBeDisabled();
  await expect(shopper.locator("[data-guest-cart-checkout]")).toHaveText("Checkout unavailable");
  await expect(shopper.locator("[data-guest-cart-checkout-reason]")).toHaveText("Checkout is not available yet.");
  await expect(shopper.locator("[data-guest-cart-checkout-reason]")).not.toContainText(/registry|source|artifact/i);

  await qty.click();
  await expect(qty).toBeFocused();
  await qty.fill("3");
  await shopper.keyboard.press("Tab");
  await expect(remove).toBeFocused();
  await expect(qty).toHaveValue("3");
  const lineStyles = await shopper.locator(`[data-guest-cart-line="${id}"]`).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      paddingTop: style.paddingTop,
      borderRadius: style.borderRadius,
      borderTopWidth: style.borderTopWidth,
    };
  });
  const qtyStyles = await qty.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: style.fontSize,
      paddingTop: style.paddingTop,
      borderTopWidth: style.borderTopWidth,
    };
  });
  expect(lineStyles.backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
  expect(Number.parseFloat(lineStyles.paddingTop)).toBeGreaterThanOrEqual(16);
  expect(Number.parseFloat(lineStyles.borderRadius)).toBeGreaterThanOrEqual(8);
  expect(Number.parseFloat(lineStyles.borderTopWidth)).toBeGreaterThanOrEqual(1);
  expect(Number.parseFloat(qtyStyles.fontSize)).toBeGreaterThanOrEqual(14);
  expect(Number.parseFloat(qtyStyles.paddingTop)).toBeGreaterThanOrEqual(4);
  await shopper.reload();
  await expect(shopper.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(qty).toHaveValue("3");
  const stored = readStoredIntent(
    await shopper.evaluate((key) => localStorage.getItem(key), GUEST_CART_STORAGE_KEY),
  );
  expect(stored).toEqual({ version: 1, lines: [{ id, quantity: 3 }] });
  await shopper.screenshot({ path: resolve(root, "cart-persisted.png"), fullPage: true, animations: "disabled" });

  await shopper.route("**/api/guest-cart/snapshot**", async (route) => {
    await new Promise((resolveHold) => setTimeout(resolveHold, 400));
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "catalog_unavailable" }),
    });
  });
  await shopper.reload({ waitUntil: "domcontentloaded" });
  await expect(shopper.locator("[data-guest-cart-status]")).toContainText("Updating current product details");
  await expect(shopper.locator("[data-guest-cart-status]")).toContainText("could not be loaded", { timeout: 8_000 });
  await expect(shopper.locator(`[data-guest-cart-line="${id}"]`)).toBeVisible();
  await expect(shopper.locator("[data-guest-cart-empty]")).toBeHidden();
  await shopper.unroute("**/api/guest-cart/snapshot**");

  await shopper.route("**/api/guest-cart/snapshot**", async (route) => {
    await new Promise((resolveHold) => setTimeout(resolveHold, 20_000));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ products: [] }),
    });
  });
  await shopper.getByRole("button", { name: "Retry catalog update", exact: true }).click();
  await expect(shopper.locator("[data-guest-cart-retry]")).toBeDisabled();
  await shopper.getByRole("button", { name: "Retry catalog update", exact: true }).click({ force: true });
  await expect(shopper.locator("[data-guest-cart-status]")).toContainText("could not be loaded", { timeout: 8_000 });
  await expect(qty).not.toBeDisabled();
  await shopper.unroute("**/api/guest-cart/snapshot**");

  await shopper.route("**/api/guest-cart/snapshot**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ products: [null] }),
    });
  });
  await shopper.reload({ waitUntil: "domcontentloaded" });
  await expect(shopper.locator("[data-guest-cart-status]")).toContainText("could not be loaded");
  await expect(shopper.locator(`[data-guest-cart-line="${id}"]`)).toBeVisible();
  await shopper.unroute("**/api/guest-cart/snapshot**");
  await shopper.getByRole("button", { name: "Retry catalog update", exact: true }).click();
  await expect(shopper.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(shopper.locator("[data-regular-price]")).toHaveText("$24.00");

  await shopper.goto("/cart?success=1&session_id=forged");
  await expect(shopper.getByText(/thank you|order confirmed|purchase complete|payment succeeded/i)).toHaveCount(0);
  await expect(qty).toHaveValue("3");
  await expect(shopper.locator("[data-guest-cart-checkout]")).toBeDisabled();
  await qty.focus();
  await expect(qty).toBeFocused();
  expect(
    await shopper.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await shopper.screenshot({ path: resolve(root, "cart-forged-success.png"), fullPage: true, animations: "disabled" });

  const unavailable = await adminPost(admin, STATUS_ROUTE, { catalogItemId: id, status: "out-of-stock" });
  expect(unavailable.ok(), await unavailable.text()).toBe(true);
  await shopper.reload();
  await expect(shopper.locator("[data-guest-cart-line-reason]")).toContainText("cannot be checked out");
  await shopper.screenshot({ path: resolve(root, "cart-unavailable.png"), fullPage: true, animations: "disabled" });

  const cleared = await adminPost(admin, SAVE_ROUTE, { catalogItemId: id, regular: "", sale: "" });
  expect(cleared.ok(), await cleared.text()).toBe(true);
  expect(unwrap<{ saved: boolean }>(await cleared.json()).saved).toBe(true);
  await shopper.reload();
  await expect(shopper.locator("[data-guest-cart-line-reason]")).toContainText("does not have a current price");
  await remove.click();
  await expect(shopper.locator("[data-guest-cart-empty]")).toBeVisible();
  await expect(shopper.locator("[data-guest-cart-empty]")).toBeFocused();

  await shopper.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ version: 1, lines: [{ id: "../x", quantity: 1, price: 12 }] }));
  }, GUEST_CART_STORAGE_KEY);
  await shopper.reload();
  await expect(shopper.locator("[data-guest-cart-status]")).toContainText("malformed");
  await expect(shopper.locator("[data-guest-cart-empty]")).toBeVisible();

  await shopper.goto("/products/boxy-tee-preview");
  await expect(shopper.locator("[data-product-page] [data-add-to-cart]")).toHaveCount(0);
  await expect(shopper.locator("[data-product-page] a[href*='checkout']")).toHaveCount(0);

  const restored = await adminPost(admin, SAVE_ROUTE, { catalogItemId: id, regular: "18", sale: "" });
  expect(restored.ok(), await restored.text()).toBe(true);
  expect(unwrap<{ saved: boolean }>(await restored.json()).saved).toBe(true);
  const inStock = await adminPost(admin, STATUS_ROUTE, { catalogItemId: id, status: "in-stock" });
  expect(inStock.ok(), await inStock.text()).toBe(true);
  await shopper.goto("/");
  await shopper.locator(`[data-commerce-product="${id}"]`).getByRole("button", { name: "Add to cart", exact: true }).click();
  await shopper.getByRole("link", { name: /Cart/ }).click();
  await expect(shopper.getByRole("heading", { name, exact: true })).toBeVisible();
  const savedBeforeQtyFail = readStoredIntent(
    await shopper.evaluate((key) => localStorage.getItem(key), GUEST_CART_STORAGE_KEY),
  );
  await shopper.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(name: string, value: string) {
      if (name === key) throw new Error("storage blocked");
      return original.call(this, name, value);
    };
  }, GUEST_CART_STORAGE_KEY);
  await qty.fill("2");
  await qty.dispatchEvent("change");
  await expect(shopper.locator("[data-guest-cart-status]")).toContainText("Leave or reload this page");
  await expect(qty).toHaveValue("2");
  expect(
    readStoredIntent(await shopper.evaluate((key) => localStorage.getItem(key), GUEST_CART_STORAGE_KEY)),
  ).toEqual(savedBeforeQtyFail);
  await shopper.screenshot({ path: resolve(root, "cart-storage-notice.png"), fullPage: true, animations: "disabled" });
  await shopper.reload();
  await expect(qty).toHaveValue(String(savedBeforeQtyFail.lines[0]?.quantity));

  await shopperContext.addInitScript(() => {
    Storage.prototype.getItem = function getItem() {
      throw new Error("storage blocked");
    };
  });
  await shopper.reload();
  await expect(shopper.locator("[data-guest-cart-status]")).toContainText("Leave or reload this page");

  expect(inventoryRequests, inventoryRequests.join("\n")).toEqual([]);
  await writeFile(
    resolve(root, "assertions.json"),
    `${JSON.stringify(
      {
        project: testInfo.project.name,
        profile: "shipping",
        anonymous: true,
        editMode: false,
        shippingDb: ".artifacts/e2e-shipping/content.db",
        storedShape: "version-id-quantity",
        checkoutReason: "Checkout is not available yet.",
        lineBackground: lineStyles.backgroundColor,
        linePaddingTop: lineStyles.paddingTop,
        quantityFontSize: qtyStyles.fontSize,
        inventoryRequests: inventoryRequests.length,
      },
      null,
      2,
    )}\n`,
  );
  await shopperContext.close();
  await adminContext.close();
});
