import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";

const commerce = process.env.DINKUS_PAIRED_RUNTIME_ID ?? "r_fjzjvld3ssb4j63o";
const base = `/_emdash/api/plugins/${commerce}/`;
const headers = { "X-EmDash-Request": "1" };

test("a simple digital product keeps its fulfillment through both cart lookups and checkout", async ({ page, browser }, info) => {
  test.setTimeout(240_000);
  const setup = await page.request.get("/_emdash/api/setup/dev-bypass");
  expect(setup.ok()).toBe(true);
  expect((await page.request.get("/_emdash/api/auth/dev-bypass?redirect=/")).ok()).toBe(true);
  await expect.poll(() => {
    const db = new DatabaseSync(process.env.DINKUS_PAIRED_DB ?? ".artifacts/paired/content.db");
    try { return db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='index' AND name=?").get(`uidx_plugin_${commerce}_catalog_items_commandId`); }
    finally { db.close(); }
  }, { timeout: 90_000 }).toEqual({ n: 1 });
  const post = async (path: string, data: unknown) => {
    const response = await page.request.post(path, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data;
  };
  const slug = `simple-digital-${info.project.name}`;
  const sku = slug.toUpperCase();
  const entry = (await post("/_emdash/api/content/products", { slug, data: { title: "Digital guide" } })).item.id;
  try {
    const id = (await post(base + "catalog", { op: "create", entryId: entry, commandId: slug, name: "Digital guide", sku, fulfillment: "digital" })).catalogItemId;
    expect((await post(base + "catalog", { op: "prices", catalogItemId: id, regular: "6", sale: "", stockStatus: "in-stock" })).saved).toBe(true);
    await post(`/_emdash/api/content/products/${entry}/publish`, {});
    const raw = (await (await page.request.get(base + "catalog/public/item?itemId=" + id)).json()).data;
    expect(raw.variants.options).toEqual([]);
    expect(raw.variants.members).toMatchObject([{ catalogItemId: id, selections: [], fulfillment: "digital" }]);
    const context = await browser.newContext({ baseURL: new URL(setup.url()).origin, viewport: info.project.use.viewport, isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch, storageState: { cookies: [], origins: [] } });
    const shopper = await context.newPage();
    try {
      await shopper.goto("/products/" + slug);
      await expect(shopper.locator("[data-product-variants]")).toHaveCount(0);
      await shopper.locator("[data-add-to-cart]").click();
      await expect(shopper.locator("[data-add-to-cart-status]")).toHaveText("Added to cart.");
      for (const ids of [[id], [id, ...Array.from({ length: 8 }, (_, i) => `missing-digital-${i}`)]]) {
        const snapshot = await context.request.get(new URL("/api/guest-cart/snapshot?ids=" + encodeURIComponent(ids.join(",")), shopper.url()).href);
        expect(snapshot.ok()).toBe(true);
        expect((await snapshot.json()).products[0]).toMatchObject({ id, found: true, name: "Digital guide", sku, fulfillment: "digital", price: { unitMinor: "600" } });
      }
      await shopper.goto("/cart");
      await expect(shopper.locator("[data-guest-cart-subtotal]")).toHaveText("Subtotal $6.00");
      await shopper.goto("/checkout");
      await expect(shopper.locator("[data-guest-cart-delivery]")).toBeHidden();
      await expect(shopper.locator("[data-guest-cart-billing]")).toBeVisible();
      await shopper.goto("/cart");
      await shopper.locator(`[data-guest-cart-remove="${id}"]`).click();
      await expect(shopper.locator("[data-guest-cart-empty]")).toBeVisible();
    } finally { await context.close(); }
  } finally { await post(`/_emdash/api/content/products/${entry}/unpublish`, {}); }
});
