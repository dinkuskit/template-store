import { describe, expect, it } from "vitest";
import {
  buildProductCollections,
  canonicalCollectionPath,
  canonicalProductPath,
  commercePageLinks,
  pageCommerceItemId,
  readProductEntries,
  validProductSlug,
} from "../../src/features/store-shell/product-routes.js";

const categories = [
  { id: "tees", data: { title: "Tees" } },
  { id: "hats", data: { title: "Hats" } },
];

function product(id: string, itemId: string, category = "tees") {
  return {
    id,
    data: {
      title: id,
      description: "Description",
      visual_label: "TEE",
      categories: [category],
      commerce_item_id: itemId,
    },
  };
}

describe("canonical product routes", () => {
  it("uses the editorial slug only in a flat canonical URL", () => {
    expect(canonicalProductPath("everyday-tee")).toBe("/products/everyday-tee");
    expect(canonicalCollectionPath("tees")).toBe("/categories/tees");
    expect(validProductSlug("nested/item")).toBe(false);
    expect(validProductSlug("Everyday Tee")).toBe(false);
  });

  it("fails closed on malformed and duplicate published Commerce links", () => {
    const result = readProductEntries([
      product("one", "item-1"),
      product("two", "item-1"),
      product("bad/item", "item-2"),
      product("orphan", "item-3", "unknown"),
    ], categories);
    expect(result.products).toHaveLength(0);
    expect(result.errors).toHaveLength(4);
    expect(buildProductCollections(result.products)).toEqual([]);
  });

  it("fails closed on the pre-#34 merchandise schema", () => {
    const result = readProductEntries([
      {
        id: "old-tee",
        data: {
          title: "Old Tee",
          description: "Description",
          visual_label: "TEE",
          collection: "tees",
          commerceItemId: "dinkus-template-managed-product",
        },
      },
    ], categories);

    expect(result.products).toEqual([]);
    expect(result.unlinked).toEqual(["old-tee"]);
  });

  // template-no-commerce-box-20261029: Commerce holds which page sells which product.
  it("finds each page's product through Commerce, then an older store's field, then the seed's demonstration slug", () => {
    const page = (slug: string, id: string, data: Record<string, unknown> = {}) =>
      ({ id: slug, data: { id, title: slug, categories: ["hats"], ...data } });
    const links = commercePageLinks([
      { id: "cat_hat", page: "01HAT" },
      { id: "cat_relinked", page: "01OLD" },
      { id: "cat_no_page" },
    ]);
    expect([...links]).toEqual([["01HAT", "cat_hat"], ["01OLD", "cat_relinked"]]);
    const result = readProductEntries([
      page("hat", "01HAT"),
      page("old", "01OLD", { commerce_item_id: "123" }),
      page("legacy", "01LEG", { commerce_item_id: " cat_legacy " }),
      page("everyday-tee", "01TEE"),
      page("new-page", "01NEW"),
    ], categories, links);
    expect(result.products.map((product) => [product.id, product.commerceItemId])).toEqual([
      ["hat", "cat_hat"],
      ["old", "cat_relinked"],
      ["legacy", "cat_legacy"],
      ["everyday-tee", "dinkus-template-managed-product"],
    ]);
    expect(result.unlinked).toEqual(["new-page"]);
    expect(result.errors).toEqual([]);
    expect(pageCommerceItemId(page("canvas-cap", "01CAP"))).toBe("dinkus-template-unmanaged-product");
    expect(pageCommerceItemId(page("canvas-cap", "01CAP"), new Map([["01CAP", "cat_cap"]]))).toBe("cat_cap");
  });

  it("refuses two pages that sell one product, whichever way each was found", () => {
    const result = readProductEntries([
      { id: "a", data: { id: "01A", title: "A", categories: [] } },
      { id: "b", data: { id: "01B", title: "B", categories: [], commerce_item_id: "cat_one" } },
    ], categories, new Map([["01A", "cat_one"]]));
    expect(result.products).toEqual([]);
    expect(result.errors).toEqual(["duplicate published Commerce itemId: cat_one", "duplicate published Commerce itemId: cat_one"]);
  });

  // template-sells-anything-20261027: a store may sell anything, so a migrated
  // seed or nutrient product with no placeholder art is a product like any other.
  it("keeps products of any kind, with or without placeholder art", () => {
    const seeds = { id: "runtz-candy-kush", data: { title: "Runtz Candy Kush", description: "Fruity.", categories: ["hats"], commerce_item_id: "wc-var-1938" } };
    const result = readProductEntries([seeds, product("everyday-tee", "item-1"), {
      id: "mycrobes", data: { title: "Mycrobes", categories: [], commerce_item_id: "item-2", visual_label: "JAR" },
    }], categories);
    expect(result.errors).toEqual([]);
    expect(result.products.map((entry) => [entry.id, entry.illustration])).toEqual([
      ["runtz-candy-kush", null],
      ["everyday-tee", "tee"],
      ["mycrobes", null],
    ]);
  });
});
