import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEMO_PRODUCTS, demoRegularMinorForSku } from "../../scripts/demo-seed-policy.js";
import {
  buildDemoProductEntries,
  demoPlaceholderImage,
  demoProductKind,
  isDemoCatalogProfile,
} from "../../src/features/playground/demo-products.js";
import { productPageOffersCart, readProductEntries } from "../../src/features/store-shell/product-routes.js";

const links = DEMO_PRODUCTS.map((product, index) => ({ sku: product.sku, catalogItemId: `item-${index}` }));

describe("demo EmDash product entries", () => {
  it("builds one published, valid product entry per seeded Commerce item", () => {
    const entries = buildDemoProductEntries(links);
    expect(entries).toHaveLength(DEMO_PRODUCTS.length);
    expect(entries.every((entry) => entry.status === "published")).toBe(true);
    expect(entries.find((entry) => entry.id === "demo-hoodie")?.data.commerce_item_id).toBe("item-3");
    const read = readProductEntries(entries, []);
    expect(read.errors).toEqual([]);
    expect(read.products.map((product) => product.commerceItemId)).toEqual(links.map((link) => link.catalogItemId));
  });

  it("links only Commerce items that exist", () => {
    expect(buildDemoProductEntries([])).toEqual([]);
    expect(buildDemoProductEntries([{ sku: "MERCHANT-1", catalogItemId: "x" }])).toEqual([]);
  });

  it("gives every demo product a local placeholder image and no other SKU one", () => {
    for (const product of DEMO_PRODUCTS) {
      const src = demoPlaceholderImage(product.sku, `demo-${demoProductKind(product)}`);
      expect(src).toMatch(/^\/products\/[a-z]+\.svg$/);
      expect(existsSync(`public${src}`)).toBe(true);
    }
    expect(demoPlaceholderImage("MERCHANT-HAT", "demo-shirt")).toBeNull();
  });

  it("gives no placeholder to a non-demo product that reuses a demo SKU", () => {
    expect(demoPlaceholderImage("DEMO-HOSTED-SHIRT", "merchant-shirt")).toBeNull();
    expect(demoPlaceholderImage("DEMO-HOSTED-SHIRT", undefined)).toBeNull();
    expect(demoPlaceholderImage("DEMO-HOSTED-SHIRT", "demo-cap")).toBeNull();
  });

  it("prices hoodie sizes differently so the card shows a from-price", () => {
    const hoodie = DEMO_PRODUCTS.find((product) => product.variant)!;
    expect(demoRegularMinorForSku(hoodie, "DEMO-HOSTED-HOODIE-S")).toBe("5600");
    expect(demoRegularMinorForSku(hoodie, "DEMO-HOSTED-HOODIE-M")).toBe("6000");
  });

  it("runs only for the playground and demo profile, never a shipping store", () => {
    expect(isDemoCatalogProfile({ DINKUS_CATALOG_PROFILE: "native-development", DINKUS_STOREFRONT_PROFILE: "proof" })).toBe(true);
    expect(isDemoCatalogProfile({})).toBe(false);
    expect(isDemoCatalogProfile({ DINKUS_STOREFRONT_PROFILE: "shipping", DINKUS_CATALOG_PROFILE: "native-development" })).toBe(false);
    expect(isDemoCatalogProfile({ DINKUS_STOREFRONT_PROFILE: "proof" })).toBe(false);
    const middleware = readFileSync("src/middleware.ts", "utf8");
    expect(middleware).toMatch(/isPlayground\) \{[\s\S]*ensurePlaygroundDemoCatalog[\s\S]*isDemoCatalogProfile\(\)/);
  });

  it("makes linked home cards one whole link to the product page", () => {
    const card = readFileSync("src/features/commerce-catalog/CommerceCatalog.astro", "utf8");
    expect(card).toMatch(/<a class="shop-card shop-card--link" href=\{href\}/);
    expect(card).toContain("{!href && <AddToCart");
  });

  it("hides Add to cart on product pages whenever checkout is unavailable", () => {
    expect(productPageOffersCart({ profile: "shipping", isPlayground: false })).toBe(true);
    expect(productPageOffersCart({ profile: "shipping", isPlayground: true })).toBe(false);
    expect(productPageOffersCart({ profile: "proof", isPlayground: false })).toBe(false);
    expect(productPageOffersCart({ profile: "proof", isPlayground: true })).toBe(false);
    const page = readFileSync("src/pages/products/[id].astro", "utf8");
    expect(page).toContain("const offersCart = productPageOffersCart({ profile, isPlayground });");
    expect(page).toContain("{cartProduct && offersCart && <AddToCart");
    expect(page).not.toMatch(/!isPlayground && <AddToCart/);
    expect(page).toContain("data-checkout-unavailable>Demo product. Cart and checkout are unavailable.");
  });
});
