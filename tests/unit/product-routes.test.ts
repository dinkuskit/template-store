import { describe, expect, it } from "vitest";
import {
  buildProductCollections,
  canonicalCollectionPath,
  canonicalProductPath,
  readProductEntries,
  validProductSlug,
} from "../../src/features/store-shell/product-routes.js";

const collections = [
  { id: "tees", data: { title: "Tees" } },
  { id: "hats", data: { title: "Hats" } },
];

function product(id: string, itemId: string, collection = "tees") {
  return {
    id,
    data: {
      title: id,
      description: "Description",
      visual_label: "TEE",
      collection,
      commerceItemId: itemId,
    },
  };
}

describe("canonical product routes", () => {
  it("uses the editorial slug only in a flat canonical URL", () => {
    expect(canonicalProductPath("everyday-tee")).toBe("/products/everyday-tee");
    expect(canonicalCollectionPath("tees")).toBe("/collections/tees");
    expect(validProductSlug("nested/item")).toBe(false);
    expect(validProductSlug("Everyday Tee")).toBe(false);
  });

  it("fails closed on malformed and duplicate published Commerce links", () => {
    const result = readProductEntries([
      product("one", "item-1"),
      product("two", "item-1"),
      product("bad/item", "item-2"),
      product("orphan", "item-3", "unknown"),
    ], collections);
    expect(result.products).toHaveLength(0);
    expect(result.errors).toHaveLength(4);
    expect(buildProductCollections(result.products)).toEqual([]);
  });
});
