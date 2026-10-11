import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEMO_PRODUCTS } from "../../scripts/demo-seed-policy.js";

const productPage = readFileSync("src/pages/products/[id].astro", "utf8");

describe("demo Commerce product-page proof", () => {
  it("renders the seeded variant, sale, gallery, and sold-out paths", () => {
    expect(productPage).toContain("data-product-variants");
    expect(productPage).toContain("data-variant-choice");
    expect(productPage).toContain("data-variant-sale");
    expect(productPage).toContain("data-commerce-gallery");
    expect(productPage).toContain("data-product-status");
    expect(productPage).toContain("data-add-to-cart");
    expect(productPage).toContain("Purchases and checkout are unavailable in this demo.");

    const shirt = DEMO_PRODUCTS.find((product) => product.sku === "DEMO-HOSTED-SHIRT");
    const cap = DEMO_PRODUCTS.find((product) => product.sku === "DEMO-HOSTED-CAP");
    const throwProduct = DEMO_PRODUCTS.find((product) => product.sku === "DEMO-HOSTED-THROW");
    const socks = DEMO_PRODUCTS.find((product) => product.sku === "DEMO-HOSTED-SOCKS");
    expect(shirt?.variant?.values).toHaveLength(5);
    expect(cap?.variant?.values).toHaveLength(3);
    expect(throwProduct?.gallery).toHaveLength(2);
    expect(socks?.availability).toBe("out-of-stock");
  });
});
