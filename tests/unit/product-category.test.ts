import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PRODUCT_TAXONOMY_VERSION,
  lookupStandardCategory,
  productCategoryId,
  standardCategory,
} from "../../src/features/product-category/index.js";

const table = JSON.parse(readFileSync("src/features/product-category/taxonomy.json", "utf8"));

// template-product-category-list-20261124: Shopify's Standard Product Taxonomy, pinned 2026-11.
describe("standard product category lookup", () => {
  it("holds every category of the pinned release", () => {
    expect(table).toMatchObject({ taxonomy: "shopify", version: PRODUCT_TAXONOMY_VERSION, google_version: "2021-09-21" });
    expect(Object.keys(table.names)).toHaveLength(14_606);
  });

  // Expected values read from Shopify's v2026-11 categories.txt and all_mappings.json.
  it("names a category and the Google id Shopify maps it to", async () => {
    expect(await standardCategory("aa-2-17")).toEqual({
      taxonomy: "shopify",
      version: "2026-11",
      id: "aa-2-17",
      name: "Hats",
      fullName: "Apparel & Accessories > Clothing Accessories > Hats",
      googleId: "173",
    });
    // T-Shirts maps to the same Google id as its parent, Shirts & Tops, so the table keeps it once.
    expect(await standardCategory("aa-1-13-8")).toMatchObject({
      name: "T-Shirts",
      fullName: "Apparel & Accessories > Clothing > Clothing Tops > T-Shirts",
      googleId: "212",
    });
    expect(await standardCategory("aa")).toMatchObject({ name: "Apparel & Accessories", googleId: "166" });
  });

  it("sends no Google id where Shopify maps none, never the parent's", async () => {
    const seeds = await standardCategory("fb-4-3-2");
    expect(seeds).toMatchObject({ fullName: "Food, Beverages & Tobacco > Cannabis Products > Cannabis Seeds > Non-Viable Seeds" });
    expect(seeds).not.toHaveProperty("googleId");
    expect(await standardCategory("fb")).toMatchObject({ googleId: "412" });
    expect(await standardCategory("bu")).toEqual(expect.not.objectContaining({ googleId: expect.anything() }));
  });

  it("reads Shopify's gid form and treats empty, unknown or malformed values as Uncategorized", async () => {
    expect(productCategoryId(" gid://shopify/TaxonomyCategory/aa-2-17 ")).toBe("aa-2-17");
    expect((await standardCategory("gid://shopify/TaxonomyCategory/aa-2-17"))?.id).toBe("aa-2-17");
    for (const value of ["", "   ", null, undefined, 17, "Hats", "AA-2-17", "aa-2-99999", "zz-1", "toString", "__proto__"]) {
      expect(await standardCategory(value)).toBeNull();
    }
    expect(lookupStandardCategory({ version: "x", names: {}, google: {} }, "aa")).toBeNull();
  });
});
