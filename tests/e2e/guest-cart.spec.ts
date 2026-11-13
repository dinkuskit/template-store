import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

import { COMMERCE_SKU_INDEX, listCatalog, openProductsList, sellProduct } from "./helpers/product-page";

// The cart lives in Commerce; the browser holds only its key in an HttpOnly cookie
// (template-cart-real-form-20261113, template-cart-count-cookie-20261113).

async function storeWithProduct(browser: Browser, testInfo: TestInfo, suffix: string) {
  const adminContext = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const admin = await adminContext.newPage();
  await openProductsList(admin);
  expect(existsSync(".artifacts/e2e/content.db")).toBe(true);
  // The installed Commerce (the Registry build) builds its unique indexes on a fresh store's first requests.
  await expect.poll(
    () => execFileSync("sqlite3", [
      ".artifacts/e2e/content.db",
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'uidx_plugin_%_catalog_items_%'",
    ], { encoding: "utf8" }),
    { timeout: 90_000 },
  ).toContain(COMMERCE_SKU_INDEX);
  await expect.poll(async () => {
    try { await listCatalog(admin.request); return true; } catch { return false; }
  }, { timeout: 15_000 }).toBe(true);
  const tag = `${testInfo.project.name}-${suffix}`.replaceAll(/[^A-Za-z0-9]+/g, "-").toUpperCase();
  const name = `Cart hat ${tag}`;
  const sku = `CART-${tag}`;
  const { itemId } = await sellProduct(admin.request, { title: name, sku, regular: "24" });
  await adminContext.close();
  return { name, sku, itemId, productPath: `/products/${sku.toLowerCase()}` };
}

async function cookieNamed(page: Page, name: string) {
  return (await page.context().cookies()).find((cookie) => cookie.name === name);
}

test("the cart works with script off: add, change, remove, and an honest checkout button", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const root = resolve("runs/guest-cart/browser", testInfo.project.name);
  await mkdir(root, { recursive: true });
  const { name, itemId, productPath } = await storeWithProduct(browser, testInfo, "plain");
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport, javaScriptEnabled: false });
  const shopper = await context.newPage();

  await shopper.goto(productPath);
  const card = shopper.locator("[data-product-page]");
  // Enter in the quantity field sends the form, as any plain form does. (A click right after typing races
  // the store's smooth scroll, which never settles for Playwright with script off.)
  await card.locator("[data-add-to-cart-qty]").fill("2");
  await card.locator("[data-add-to-cart-qty]").press("Enter");
  await expect(shopper).toHaveURL(/\/cart\?added=2$/u);
  await expect(shopper.locator("[data-guest-cart-status]")).toHaveText("Added to your cart.");
  const line = shopper.locator(`[data-guest-cart-line="${itemId}"]`);
  await expect(line.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(line.locator("[data-guest-cart-qty]")).toHaveValue("2");
  await expect(line.locator("[data-guest-cart-line-total]")).toHaveText("Line total $48.00");
  await expect(shopper.locator("[data-guest-cart-subtotal]")).toHaveText("Subtotal $48.00");

  const key = await cookieNamed(shopper, "dk_cart");
  expect(key).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  expect(key?.value).toMatch(/^[A-Za-z0-9._~-]+\.[A-Za-z0-9._~-]+$/u);
  expect(await cookieNamed(shopper, "dk_cart_count")).toMatchObject({ value: "2", httpOnly: false });

  // Adding the same item again merges into one line.
  await shopper.goto(productPath);
  await card.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(line.locator("[data-guest-cart-qty]")).toHaveValue("3");
  await expect(shopper.locator("[data-guest-cart-subtotal]")).toHaveText("Subtotal $72.00");

  await line.locator("[data-guest-cart-qty]").fill("5");
  await line.locator("[data-guest-cart-qty]").press("Enter");
  await expect(shopper).toHaveURL(/\/cart$/u);
  await expect(line.locator("[data-guest-cart-qty]")).toHaveValue("5");
  await expect(line.locator("[data-guest-cart-line-total]")).toHaveText("Line total $120.00");
  expect((await cookieNamed(shopper, "dk_cart_count"))?.value).toBe("5");

  // The proof store takes no payments: checkout says so and never pretends.
  await expect(shopper.locator("[data-guest-cart-checkout]")).toBeDisabled();
  await expect(shopper.locator("[data-guest-cart-checkout]")).toHaveText("Checkout unavailable");
  await expect(shopper.locator("[data-guest-cart-checkout-reason]")).toHaveText("Checkout is not available yet.");
  await shopper.screenshot({ path: resolve(root, "cart-script-off.png"), fullPage: true, animations: "disabled" });

  // The same cart follows the shopper to a fresh tab: it lives on the server, not in this page.
  const another = await context.newPage();
  await another.goto("/cart");
  await expect(another.locator(`[data-guest-cart-line="${itemId}"] [data-guest-cart-qty]`)).toHaveValue("5");

  await line.getByRole("button", { name: `Remove ${name}` }).click();
  await expect(shopper.locator("[data-guest-cart-empty]")).toBeVisible();
  await expect(line).toHaveCount(0);
  expect((await cookieNamed(shopper, "dk_cart_count"))?.value).toBe("0");

  // A refused plain-form add lands on the cart page, which says why.
  const refused = await shopper.request.post("/cart/add", {
    form: { id: "no_such_item", quantity: "1" },
    headers: { origin: new URL(shopper.url()).origin },
    maxRedirects: 0,
  });
  expect(refused.status()).toBe(303);
  await shopper.goto(refused.headers().location ?? "/cart");
  await expect(shopper).toHaveURL(/\/cart\?cart_error=[A-Z_]+$/u);
  await expect(shopper.locator("[data-guest-cart-status][role=alert]")).toBeVisible();
  await shopper.screenshot({ path: resolve(root, "cart-refused-add-script-off.png"), fullPage: true, animations: "disabled" });
  await context.close();
});

test("with script the same forms change the cart in place, and agents read it as JSON", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const root = resolve("runs/guest-cart/browser", testInfo.project.name);
  await mkdir(root, { recursive: true });
  const { itemId, productPath } = await storeWithProduct(browser, testInfo, "script");
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport });
  const shopper = await context.newPage();
  await shopper.goto(productPath);
  const card = shopper.locator("[data-product-page]");
  await card.locator("[data-add-to-cart-qty-increase]").click();
  await expect(card.locator("[data-add-to-cart-qty]")).toHaveValue("2");
  await card.getByRole("button", { name: "Add to cart", exact: true }).click();
  await expect(card.locator("[data-add-to-cart-status]")).toHaveText("Added to your cart.");
  await expect(shopper).toHaveURL(new RegExp(`${productPath}$`, "u"));
  await expect(shopper.locator("[data-store-header] [data-guest-cart-count]")).toHaveText("2");
  await shopper.screenshot({ path: resolve(root, "product-added-script-on.png"), fullPage: true, animations: "disabled" });

  const cart = await shopper.evaluate(async () => (await fetch("/cart.js", { headers: { accept: "application/json" } })).json());
  expect(cart).toMatchObject({ ok: true, cart: { itemCount: 2, lines: [{ catalogItemId: itemId, quantity: 2 }] } });
  expect(typeof cart.cart.version).toBe("string");

  // An agent quoting an old version changes nothing.
  const stale = await shopper.evaluate(async () => {
    const response = await fetch("/cart/update.js", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ version: "stale", lines: [] }),
    });
    return { status: response.status, body: await response.json() };
  });
  expect(stale).toMatchObject({ status: 409, body: { ok: false, error: { code: "CONTENTION" }, cart: { itemCount: 2 } } });

  // The browser agent tools work on the same cart.
  const viaAgent = await shopper.evaluate(async (id) => {
    const actions = (window as unknown as { Dinkus: { actions: {
      getCart(): Promise<{ ok: boolean; version: string | null }>;
      updateCart(input: { version: string | null; lines: { id: string; quantity: number }[] }): Promise<{ ok: boolean; cart?: { itemCount: number } }>;
    } } }).Dinkus.actions;
    const read = await actions.getCart();
    return actions.updateCart({ version: read.version, lines: [{ id, quantity: 4 }] });
  }, itemId);
  expect(viaAgent).toMatchObject({ ok: true, cart: { itemCount: 4 } });
  await expect(shopper.locator("[data-store-header] [data-guest-cart-count]")).toHaveText("4");

  // show_variant opens the product's published page, found from its Commerce id.
  const shown = await shopper.evaluate(async (id) => {
    const actions = (window as unknown as { Dinkus: { actions: {
      showVariant(input: { productId: string }): Promise<{ ok: boolean; url?: string }>;
    } } }).Dinkus.actions;
    return actions.showVariant({ productId: id });
  }, itemId);
  expect(shown).toEqual({ ok: true, url: productPath });
  await expect(shopper).toHaveURL(new RegExp(`${productPath}$`, "u"));
  const missing = await shopper.request.get("/variants/no_such_item", { headers: { accept: "application/json" } });
  expect(missing.status()).toBe(404);

  await shopper.goto("/cart");
  const line = shopper.locator(`[data-guest-cart-line="${itemId}"]`);
  await expect(line.locator("[data-guest-cart-qty]")).toHaveValue("4");
  await line.locator("[data-guest-cart-qty]").fill("1");
  await line.getByRole("button", { name: "Update" }).click();
  await expect(shopper.locator(`[data-guest-cart-line="${itemId}"] [data-guest-cart-line-total]`)).toHaveText("Line total $24.00");
  await expect(shopper).toHaveURL(/\/cart$/u);
  await expect(shopper.locator("[data-store-header] [data-guest-cart-count]")).toHaveText("1");
  await shopper.screenshot({ path: resolve(root, "cart-updated-script-on.png"), fullPage: true, animations: "disabled" });
  await context.close();
});

test("the thank-you page trusts only the order behind the cart cookie", async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  const root = resolve("runs/guest-cart/browser", testInfo.project.name);
  await mkdir(root, { recursive: true });
  const { productPath } = await storeWithProduct(browser, testInfo, "return");
  const context = await browser.newContext({ viewport: testInfo.project.use.viewport, javaScriptEnabled: false });
  const shopper = await context.newPage();

  // No cart cookie: no order is claimed, whatever the URL says.
  await shopper.goto("/checkout/success?session_id=cs_test_forged");
  await expect(shopper.locator("[data-guest-checkout-return]")).toHaveAttribute("data-guest-checkout-return-state", "no-cart");
  await expect(shopper.locator("[data-guest-checkout-order]")).toHaveCount(0);
  await expect(shopper.locator("#guest-checkout-return-title")).toHaveText("Thank you");
  await shopper.screenshot({ path: resolve(root, "thank-you-no-cart.png"), fullPage: true, animations: "disabled" });

  // A cart that was never paid goes back to the cart with its items.
  await shopper.goto(productPath);
  await shopper.locator("[data-product-page]").getByRole("button", { name: "Add to cart", exact: true }).click();
  await shopper.goto("/checkout/success?session_id=cs_test_forged");
  await expect(shopper).toHaveURL(/\/cart\?cart_error=NOT_PAID$/u);
  await expect(shopper.locator("[data-guest-cart-status][role=alert]")).toHaveText("Your payment was not completed. Your items are still in your cart.");
  await expect(shopper.locator("[data-guest-cart-line]")).toHaveCount(1);
  await shopper.screenshot({ path: resolve(root, "cart-not-paid.png"), fullPage: true, animations: "disabled" });
  await context.close();
});
