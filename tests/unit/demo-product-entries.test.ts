import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEMO_PRODUCTS, demoAvailabilityForSku, demoRegularMinorForSku, demoVariantOptionInput } from "../../scripts/demo-seed-policy.js";
import {
  buildDemoProductEntries,
  demoPlaceholderImage,
  demoProductKind,
  demoProductPages,
  isDemoCatalogProfile,
} from "../../src/features/playground/demo-products.js";
import { productPageOffersCart, readProductEntries } from "../../src/features/store-shell/product-routes.js";

const links = DEMO_PRODUCTS.map((product, index) => ({ sku: product.sku, catalogItemId: `item-${index}` }));

describe("demo EmDash product entries", () => {
  it("builds one published, valid product entry per seeded Commerce item, with no Commerce product field", () => {
    const entries = buildDemoProductEntries(links);
    expect(entries).toHaveLength(DEMO_PRODUCTS.length);
    expect(entries.every((entry) => entry.status === "published")).toBe(true);
    expect(entries.every((entry) => !("commerce_item_id" in entry.data))).toBe(true);
    expect(demoProductPages(links).find((page) => page.slug === "demo-hoodie")?.catalogItemId).toBe("item-3");
    // Commerce holds each page's link once the seed records its sale (template-no-commerce-box-20261029).
    const pages = entries.map((entry) => ({ ...entry, data: { ...entry.data, id: `ulid-${entry.id}` } }));
    const commerce = new Map(demoProductPages(links).map((page) => [`ulid-${page.slug}`, page.catalogItemId]));
    const read = readProductEntries(pages, [], commerce);
    expect(read.errors).toEqual([]);
    expect(read.products.map((product) => product.commerceItemId)).toEqual(links.map((link) => link.catalogItemId));
    expect(readProductEntries(pages, []).unlinked).toEqual(entries.map((entry) => entry.id));
  });

  it("links only Commerce items that exist", () => {
    expect(buildDemoProductEntries([])).toEqual([]);
    expect(buildDemoProductEntries([{ sku: "MERCHANT-1", catalogItemId: "x" }])).toEqual([]);
  });

  it("gives every demo product a local placeholder image and no other SKU one", () => {
    for (const product of DEMO_PRODUCTS) {
      const src = demoPlaceholderImage(product.sku, `demo-${demoProductKind(product)}`);
      expect(src).toMatch(/^\/images\/products\/[a-z]+\.svg$/);
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

  it("seeds the Large hoodie sold out so every demo store has an unavailable size", () => {
    const hoodie = DEMO_PRODUCTS.find((product) => product.variant)!;
    expect(hoodie.variant!.options.map((option) => option.optionLabel)).toEqual(["Color", "Size"]);
    expect(hoodie.variant!.options[1]!.values.map((value) => value.label)).toEqual(["Small", "Medium", "Large"]);
    expect(demoAvailabilityForSku(hoodie, "DEMO-HOSTED-HOODIE-S")).toBe("in-stock");
    expect(demoAvailabilityForSku(hoodie, "DEMO-HOSTED-HOODIE-M")).toBe("in-stock");
    expect(demoAvailabilityForSku(hoodie, "demo-hosted-hoodie-l")).toBe("out-of-stock");
    expect(demoRegularMinorForSku(hoodie, "DEMO-HOSTED-HOODIE-L")).toBe("6000");
  });

  it("seeds the hoodie in Black and Heather gray, with only Black Large sold out", () => {
    const hoodie = DEMO_PRODUCTS.find((product) => product.variant)!;
    expect(hoodie.variant!.options[0]!.values.map((value) => value.label)).toEqual(["Black", "Heather gray"]);
    expect(hoodie.variant!.members).toHaveLength(6);
    expect(hoodie.variant!.members[0]!.sku).toBe(hoodie.sku);
    expect(demoAvailabilityForSku(hoodie, "DEMO-HOSTED-HOODIE-HG-L")).toBe("in-stock");
    expect(demoRegularMinorForSku(hoodie, "DEMO-HOSTED-HOODIE-HG-S")).toBe("5600");
    expect(demoRegularMinorForSku(hoodie, "DEMO-HOSTED-HOODIE-HG-M")).toBe("6000");
  });

  it("adds the hoodie colors first, then sizes for every color", () => {
    const hoodie = DEMO_PRODUCTS.find((product) => product.variant)!;
    expect(demoVariantOptionInput(hoodie, 0, "parent", new Map())).toEqual({
      productId: "parent",
      optionId: "color",
      optionLabel: "Color",
      values: [
        { valueId: "black", label: "Black", member: { catalogItemId: "parent", fulfillment: "physical" } },
        {
          valueId: "heather-gray",
          label: "Heather gray",
          member: {
            commandId: "seed-demo-hoodie-heather-gray-small",
            name: "Dinkus Demo Everyday Hoodie",
            sku: "DEMO-HOSTED-HOODIE-HG-S",
            fulfillment: "physical",
            selections: [],
          },
        },
      ],
    });
    const sizes = demoVariantOptionInput(hoodie, 1, "parent", new Map([["DEMO-HOSTED-HOODIE-HG-S", "hg-small"]]), 1);
    expect(sizes.expectedRevision).toBe(1);
    expect(sizes.values.map((value) => value.valueId)).toEqual(["small", "medium", "large"]);
    expect(sizes.values[0]).toEqual({
      valueId: "small",
      label: "Small",
      members: [
        { catalogItemId: "parent", fulfillment: "physical" },
        { catalogItemId: "hg-small", fulfillment: "physical" },
      ],
    });
    expect(sizes.values[2]).toEqual(expect.objectContaining({
      members: [
        expect.objectContaining({ sku: "DEMO-HOSTED-HOODIE-L", selections: [{ optionId: "color", valueId: "black" }] }),
        expect.objectContaining({ sku: "DEMO-HOSTED-HOODIE-HG-L", selections: [{ optionId: "color", valueId: "heather-gray" }] }),
      ],
    }));
  });

  it("runs only for the playground and demo profile, never a shipping store", () => {
    // The demo store is the proof storefront profile on Commerce's Registry build (template-one-build-registry-20261031).
    expect(isDemoCatalogProfile({ DINKUS_STOREFRONT_PROFILE: "proof" })).toBe(true);
    expect(isDemoCatalogProfile({ DINKUS_STOREFRONT_PROFILE: "proof", DINKUS_CATALOG_PROFILE: "shipping" })).toBe(true);
    expect(isDemoCatalogProfile({})).toBe(false);
    expect(isDemoCatalogProfile({ DINKUS_STOREFRONT_PROFILE: "shipping" })).toBe(false);
    // The retired native copy never counts as the demo.
    expect(isDemoCatalogProfile({ DINKUS_CATALOG_PROFILE: "native-development", DINKUS_STOREFRONT_PROFILE: "proof" })).toBe(false);
    const middleware = readFileSync("src/middleware.ts", "utf8");
    expect(middleware).toMatch(/isPlayground\) \{[\s\S]*ensurePlaygroundDemoCatalog[\s\S]*isDemoCatalogProfile\(\)/);
  });

  it("makes linked home cards one whole link to the product page", () => {
    const card = readFileSync("src/features/commerce-catalog/CommerceCatalog.astro", "utf8");
    expect(card).toMatch(/<a class="shop-card shop-card--link" href=\{href\}/);
    expect(card).toContain("{!href && <AddToCart");
  });

  it("offers Add to cart on every store's product pages, the playground's only with its sandbox checkout on", () => {
    // Every product sells from its page on Commerce's Registry build, so the page is where the guest cart
    // starts; the demo keeps its guest cart with checkout closed (hosted-demo-007).
    expect(productPageOffersCart({ profile: "shipping", isPlayground: false })).toBe(true);
    expect(productPageOffersCart({ profile: "proof", isPlayground: false })).toBe(true);
    expect(productPageOffersCart({ profile: "proof", isPlayground: false, isDemo: true, checkoutEnabled: false })).toBe(true);
    expect(productPageOffersCart({ profile: "proof", isPlayground: false, isDemo: true, checkoutEnabled: true })).toBe(true);
    expect(productPageOffersCart({ profile: "shipping", isPlayground: false, checkoutEnabled: false })).toBe(true);
    // DINKUS_CHECKOUT_ENABLED turns sandbox checkout, and with it the cart, on for the playground.
    expect(productPageOffersCart({ profile: "shipping", isPlayground: true })).toBe(false);
    expect(productPageOffersCart({ profile: "proof", isPlayground: true })).toBe(false);
    expect(productPageOffersCart({ profile: "shipping", isPlayground: true, checkoutEnabled: true })).toBe(true);
    expect(productPageOffersCart({ profile: "proof", isPlayground: true, checkoutEnabled: true })).toBe(true);
    expect(productPageOffersCart({ profile: "proof", isPlayground: true, checkoutEnabled: false })).toBe(false);
    const page = readFileSync("src/pages/products/[id].astro", "utf8");
    expect(page).toContain("const offersCart = productPageOffersCart({ profile, isPlayground, isDemo, checkoutEnabled });");
    expect(page).toContain("{cartProduct && offersCart && <AddToCart");
    expect(page).not.toMatch(/!isPlayground && <AddToCart/);
    expect(page).toContain('data-checkout-unavailable>{offersCart ? "Demo product. Checkout is unavailable." : "Demo product. Cart and checkout are unavailable."}');
  });
});
