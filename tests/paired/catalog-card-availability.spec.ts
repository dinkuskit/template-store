import { expect, test } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";

const commerce = process.env.DINKUS_PAIRED_RUNTIME_ID ?? "r_fjzjvld3ssb4j63o";
const headers = { "X-EmDash-Request": "1" };

test("catalog cards summarize every listable member without changing selected-member facts", async ({ request, browser }, info) => {
  test.setTimeout(300_000);
  expect((await request.get("/_emdash/api/setup/dev-bypass")).ok()).toBe(true);
  expect((await request.get("/_emdash/api/auth/dev-bypass?redirect=/")).ok()).toBe(true);
  expect((await request.get(`/_emdash/api/plugins/${commerce}/catalog/public`)).ok()).toBe(true);
  await expect.poll(() => {
    const db = new DatabaseSync(process.env.DINKUS_PAIRED_DB ?? ".artifacts/paired/content.db");
    try {
      return (db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name IN (?, ?)")
        .get(`uidx_plugin_${commerce}_catalog_items_commandId`, `uidx_plugin_${commerce}_catalog_items_skuKey`) as { n: number }).n;
    } finally { db.close(); }
  }, { timeout: 90_000 }).toBe(2);
  const catalog = async (data: Record<string, unknown>) => {
    const response = await request.post(`/_emdash/api/plugins/${commerce}/catalog`, { headers, data });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()).data;
  };
  const pages: string[] = [];
  const create = async (suffix: string, title: string) => {
    const slug = `card-${info.project.name}-${suffix}`;
    const response = await request.post("/_emdash/api/content/products", { headers, data: { slug, data: { title } } });
    expect(response.ok(), await response.text()).toBe(true);
    const data = (await response.json()).data;
    const entryId: string = (data.item ?? data).id;
    pages.push(entryId);
    const { catalogItemId: id } = await catalog({ op: "create", commandId: slug, name: title, sku: slug.toUpperCase(), entryId });
    return { id, entryId, slug };
  };
  // Card stock is server-rendered; no JavaScript is needed to tell shoppers what is buyable.
  const cardsContext = await browser.newContext({ viewport: info.project.use.viewport, javaScriptEnabled: false });
  const shopperContext = await browser.newContext({ viewport: info.project.use.viewport, isMobile: info.project.use.isMobile, hasTouch: info.project.use.hasTouch });
  try {
    const simple = await create("simple", "Simple sold-out hoodie");
    const family = await create("family", "Sized hoodie");
    const choice = await catalog({ op: "option", productId: family.id, optionId: "size", optionLabel: "Size", values: [
      { valueId: "small", label: "Small", member: { catalogItemId: family.id, fulfillment: "physical" } },
      { valueId: "large", label: "Large", member: { commandId: family.slug + "-large", name: "Sized hoodie", sku: family.slug.toUpperCase() + "-L", fulfillment: "physical" } },
    ] });
    const large = (choice.product.members as { catalogItemId: string }[]).map(m => m.catalogItemId).find(id => id !== family.id)!;
    expect(large).toMatch(/\S/);
    await catalog({ op: "prices", catalogItemId: simple.id, regular: "35", sale: "", stockStatus: "out-of-stock" });
    const stock = async (smallStock: string, largeStock: string) => {
      await catalog({ op: "prices", catalogItemId: family.id, regular: "40", sale: "", stockStatus: smallStock });
      await catalog({ op: "prices", catalogItemId: large, productId: family.id, regular: "45", sale: "", stockStatus: largeStock });
    };
    await stock("in-stock", "in-stock");
    for (const id of pages) expect((await request.post(`/_emdash/api/content/products/${id}/publish`, { headers })).ok()).toBe(true);
    const cards = await cardsContext.newPage();
    for (const [smallStock, largeStock, status, label] of [
      ["in-stock", "in-stock", "in-stock", "In stock"],
      ["out-of-stock", "out-of-stock", "out-of-stock", "Out of stock"],
      ["out-of-stock", "in-stock", "in-stock", "In stock"],
    ] as const) {
      await stock(smallStock, largeStock);
      await cards.goto("/");
      const simpleLabel = cards.locator(`a[href="/products/${simple.slug}"] [data-commerce-availability]`);
      await expect(simpleLabel).toHaveText("Out of stock");
      await expect(simpleLabel).toHaveAttribute("data-commerce-availability", "out-of-stock");
      const familyLabel = cards.locator(`a[href="/products/${family.slug}"] [data-commerce-availability]`);
      await expect(familyLabel).toHaveText(label);
      await expect(familyLabel).toHaveAttribute("data-commerce-availability", status);
    }
    // The mixed family is buyable, but Small itself must still be refused at its own price.
    const shopper = await shopperContext.newPage();
    await shopper.goto(`/products/${family.slug}`);
    await expect(shopper.getByRole("radio", { name: "Large", exact: true })).toBeChecked();
    await shopper.getByRole("radio", { name: "Small (sold out)", exact: true }).check();
    await expect(shopper.locator("[data-product-status]")).toHaveText("Out of stock");
    await expect(shopper.locator("[data-variant-price]")).toHaveText("$40.00");
    await expect(shopper.locator("[data-add-to-cart]")).toBeDisabled();
    await shopper.getByRole("radio", { name: "Large", exact: true }).check();
    await expect(shopper.locator("[data-product-status]")).toHaveText("In stock");
    await expect(shopper.locator("[data-variant-price]")).toHaveText("$45.00");
    await expect(shopper.locator("[data-add-to-cart]")).toHaveAttribute("data-add-to-cart", large);
    await expect(shopper.locator("[data-add-to-cart]")).toBeEnabled();
    // Looking at a product makes no cart: the server cart starts with the first Add.
    expect((await shopperContext.cookies()).some((cookie) => cookie.name === "dk_cart")).toBe(false);
  } finally {
    await cardsContext.close();
    await shopperContext.close();
    for (const id of pages) expect((await request.post(`/_emdash/api/content/products/${id}/unpublish`, { headers })).ok()).toBe(true);
  }
});
