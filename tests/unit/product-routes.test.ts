import { describe, expect, it } from "vitest";
import {
  buildProductCollections,
  canonicalCollectionPath,
  canonicalProductPath,
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
        id: "everyday-tee",
        data: {
          title: "Everyday Tee",
          description: "Description",
          visual_label: "TEE",
          collection: "tees",
          commerceItemId: "dinkus-template-managed-product",
        },
      },
    ], categories);

    expect(result.products).toEqual([]);
    expect(result.errors).toEqual(["invalid product entry: everyday-tee"]);
  });
});
