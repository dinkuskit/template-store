import { expect, test, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

// Run by scripts/verify-paired-product-on-sale.mjs beside product-on-sale.spec.ts: a real Commerce Registry
// build installed as a Registry store installs it. A shopper picks a Size on the product page and the cart
// checks out that Size at its own price; a sold-out Size stays blocked (template-store#181).
const commerce = process.env.DINKUS_PAIRED_RUNTIME_ID ?? "r_fjzjvld3ssb4j63o";
const headers = { "X-EmDash-Request": "1" };
const artifacts = process.env.DINKUS_PAIRED_ARTIFACTS ?? resolve("test-results/paired-product-on-sale");
const CART_KEY = "dinkus.guest-cart.v1";

const db = () => new DatabaseSync(process.env.DINKUS_PAIRED_DB ?? ".artifacts/paired/content.db");
const capture = (page: Page, name: string) => page.screenshot({ path: resolve(artifacts, test.info().project.name + "-cart-" + name + ".png"), animations: "disabled", fullPage: true });

test("a shopper's chosen Size checks out at that Size's price, and a sold-out Size stays blocked", async ({ page, browser }, testInfo) => {
  test.setTimeout(300_000);
  expect((await page.request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  expect((await page.request.get("/_emdash/api/auth/dev-bypass?redirect=/")).ok()).toBe(true);
  const { request } = page;
  const catalog = async (body: Record<string, unknown>) => {
    const response = await request.post(`/_emdash/api/plugins/${commerce}/catalog`, { headers, data: body });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data;
  };
  // A fresh install builds Commerce's unique indexes on its first requests; creating a product needs them.
  await expect.poll(() => {
    const database = db();
    try {
      return database.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name IN (?, ?)")
        .get(`uidx_plugin_${commerce}_catalog_items_commandId`, `uidx_plugin_${commerce}_catalog_items_skuKey`) as { n: number };
    } finally {
      database.close();
    }
  }, { timeout: 90_000 }).toEqual({ n: 2 });

  // Desktop and phone runs share one store, so each sells its own hoodie.
  const sku = testInfo.project.name === "phone" ? "SIZED-HOODIE-PHONE" : "SIZED-HOODIE";
  const slug = sku.toLowerCase();
  const created = (await (await request.post("/_emdash/api/content/products", { headers, data: { slug, data: { title: "Sized hoodie", visual_label: "Hoodie" } } })).json()).data;
  const pageId: string = (created.item ?? created).id;
  try {
    // The owner's steps, through the private catalog route the CLI and agents use: a product, a Size choice
    // (Small is the product itself, Large a new version), a price for each, Large sold out.
    const { catalogItemId: small } = await catalog({ op: "create", commandId: `sized-${slug}`, name: "Sized hoodie", sku, entryId: pageId });
    const choice = await catalog({ op: "choice", productId: small, optionId: "size", optionLabel: "Size", values: [
      { valueId: "small", label: "Small", member: { catalogItemId: small, fulfillment: "physical" } },
      { valueId: "large", label: "Large", member: { commandId: `sized-${slug}-large`, name: "Sized hoodie", sku: `${sku}-L`, fulfillment: "physical" } },
    ] });
    const large = (choice.product.members as { catalogItemId: string }[]).map((member) => member.catalogItemId).find((id) => id !== small)!;
    expect(large).toMatch(/\S/);
    expect((await catalog({ op: "prices", catalogItemId: small, regular: "40", sale: "", stockStatus: "in-stock" })).saved).not.toBe(false);
    expect((await catalog({ op: "prices", catalogItemId: large, productId: small, regular: "45", sale: "", stockStatus: "out-of-stock" })).saved).not.toBe(false);
    // Publishing the page puts the product on sale.
    expect((await request.post(`/_emdash/api/content/products/${pageId}/publish`, { headers })).ok()).toBe(true);
    // Commerce answers a Size's lookup with the whole product: no price of its own at the top, members priced.
    await expect.poll(async () => (await (await request.get(`/_emdash/api/plugins/${commerce}/catalog/public/item?itemId=${large}`)).json()).data?.variants?.members?.length ?? 0).toBe(2);

    // A shopper in a fresh browser picks Small on the product page and adds it to the cart.
    const shopperContext = await browser.newContext({ viewport: testInfo.project.use.viewport, isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch, storageState: { cookies: [], origins: [] } });
    const shopper = await shopperContext.newPage();
    try {
      await shopper.goto("/products/" + slug);
      await expect(shopper.getByRole("heading", { level: 1 })).toHaveText("Sized hoodie");
      const sizes = shopper.locator('[data-product-variants][data-variant-option="Size"]');
      await expect(sizes.getByRole("radio", { name: "Small" })).toBeChecked();
      await expect(sizes.getByRole("radio", { name: "Large" })).toHaveAttribute("data-variant-sold-out", "true");
      await expect(shopper.locator("[data-variant-price]")).toHaveText("$40.00");
      const add = shopper.locator("[data-add-to-cart]");
      await expect(add).toHaveAttribute("data-add-to-cart", small);
      await add.click();
      await expect.poll(() => shopper.evaluate((key) => localStorage.getItem(key), CART_KEY)).toContain(small);
      await capture(shopper, "1-product-page-small");

      // The cart prices the chosen Size from Commerce; before #181 it said the product had left the catalog.
      await shopper.goto("/cart");
      const line = shopper.locator(`[data-guest-cart-line="${small}"]`);
      await expect(line).toBeVisible();
      await expect(line.getByRole("heading", { level: 2 })).toHaveText("Sized hoodie — Small");
      await expect(line).toContainText("$40.00");
      await expect(line.locator("[data-guest-cart-line-reason]")).toHaveCount(0);
      await expect(shopper.locator("[data-guest-cart-page]")).not.toContainText("no longer in the catalog");
      await expect(shopper.locator("[data-guest-cart-subtotal-amount]")).toHaveText("$40.00");
      await capture(shopper, "2-cart-small");

      // A sold-out Size saved in the cart is never priced from the product or from Small: it stays blocked.
      await shopper.evaluate(([key, id]) => localStorage.setItem(key, JSON.stringify({ version: 1, lines: [{ id, quantity: 1 }] })), [CART_KEY, large]);
      await shopper.reload();
      const soldOut = shopper.locator(`[data-guest-cart-line="${large}"]`);
      await expect(soldOut.getByRole("heading", { level: 2 })).toHaveText("Sized hoodie — Large");
      await expect(soldOut.locator("[data-guest-cart-line-reason]")).toHaveText("Out of stock and cannot be checked out.");
      await expect(soldOut).not.toContainText("$40.00");
      await capture(shopper, "3-cart-large-sold-out");

      // A Size Commerce no longer sells (here: an id it never had) reads as gone, not as the product.
      const gone = `${large}-gone`;
      await shopper.evaluate(([key, id]) => localStorage.setItem(key, JSON.stringify({ version: 1, lines: [{ id, quantity: 1 }] })), [CART_KEY, gone]);
      await shopper.reload();
      await expect(shopper.locator(`[data-guest-cart-line="${gone}"] [data-guest-cart-line-reason]`)).toHaveText("This product is no longer in the catalog and cannot be checked out.");
    } finally {
      await shopperContext.close();
    }
  } finally {
    // product-on-sale.spec.ts starts each run from an empty shop.
    expect((await request.post(`/_emdash/api/content/products/${pageId}/unpublish`, { headers })).ok()).toBe(true);
  }
});

test("a digital choice checks out with no delivery address, and a physical one asks for it", async ({ page, browser }, testInfo) => {
  test.setTimeout(300_000);
  expect((await page.request.get("/_emdash/api/setup/dev-bypass")).status()).toBe(200);
  expect((await page.request.get("/_emdash/api/auth/dev-bypass?redirect=/")).ok()).toBe(true);
  const { request } = page;
  const catalog = async (body: Record<string, unknown>) => {
    const response = await request.post(`/_emdash/api/plugins/${commerce}/catalog`, { headers, data: body });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data;
  };
  const sku = testInfo.project.name === "phone" ? "GROW-GUIDE-PHONE" : "GROW-GUIDE";
  const slug = sku.toLowerCase();
  const created = (await (await request.post("/_emdash/api/content/products", { headers, data: { slug, data: { title: "Grow guide", visual_label: "Guide" } } })).json()).data;
  const pageId: string = (created.item ?? created).id;
  try {
    // Print is the product itself (physical); PDF is a digital version of it.
    const { catalogItemId: print } = await catalog({ op: "create", commandId: `guide-${slug}`, name: "Grow guide", sku, entryId: pageId });
    const choice = await catalog({ op: "choice", productId: print, optionId: "format", optionLabel: "Format", values: [
      { valueId: "print", label: "Print", member: { catalogItemId: print, fulfillment: "physical" } },
      { valueId: "pdf", label: "PDF", member: { commandId: `guide-${slug}-pdf`, name: "Grow guide", sku: `${sku}-PDF`, fulfillment: "digital" } },
    ] });
    const pdf = (choice.product.members as { catalogItemId: string }[]).map((member) => member.catalogItemId).find((id) => id !== print)!;
    expect((await catalog({ op: "prices", catalogItemId: print, regular: "24", sale: "", stockStatus: "in-stock" })).saved).not.toBe(false);
    expect((await catalog({ op: "prices", catalogItemId: pdf, productId: print, regular: "9", sale: "", stockStatus: "in-stock" })).saved).not.toBe(false);
    expect((await request.post(`/_emdash/api/content/products/${pageId}/publish`, { headers })).ok()).toBe(true);
    const members = async () => (await (await request.get(`/_emdash/api/plugins/${commerce}/catalog/public/item?itemId=${pdf}`)).json()).data?.variants?.members ?? [];
    await expect.poll(async () => (await members()).length).toBe(2);
    // Commerce projects each member's own fulfillment.
    expect(Object.fromEntries((await members()).map((member: { catalogItemId: string; fulfillment: string }) => [member.catalogItemId, member.fulfillment]))).toEqual({ [print]: "physical", [pdf]: "digital" });

    const shopperContext = await browser.newContext({ viewport: testInfo.project.use.viewport, isMobile: testInfo.project.use.isMobile, hasTouch: testInfo.project.use.hasTouch, storageState: { cookies: [], origins: [] } });
    const shopper = await shopperContext.newPage();
    try {
      const cart = (ids: string[]) => shopper.evaluate(([key, lines]) => localStorage.setItem(key, JSON.stringify({ version: 1, lines: JSON.parse(lines).map((id: string) => ({ id, quantity: 1 })) })), [CART_KEY, JSON.stringify(ids)]);
      await shopper.goto("/cart");
      await cart([pdf]);
      await shopper.goto("/checkout");
      const line = shopper.locator(`[data-guest-cart-line="${pdf}"]`);
      await expect(line.getByRole("heading", { level: 2 })).toHaveText("Grow guide \u2014 PDF");
      await expect(line).toContainText("$9.00");
      // A digital-only cart never asks where to deliver it.
      await expect(shopper.locator("[data-guest-cart-delivery]")).toBeHidden();
      await capture(shopper, "4-checkout-digital-only");

      await cart([pdf, print]);
      await shopper.reload();
      await expect(shopper.locator(`[data-guest-cart-line="${print}"]`).getByRole("heading", { level: 2 })).toHaveText("Grow guide \u2014 Print");
      await expect(shopper.locator("[data-guest-cart-delivery]")).toBeVisible();
      await capture(shopper, "5-checkout-with-print");
    } finally {
      await shopperContext.close();
    }
  } finally {
    expect((await request.post(`/_emdash/api/content/products/${pageId}/unpublish`, { headers })).ok()).toBe(true);
  }
});
