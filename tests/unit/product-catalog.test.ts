import { describe, expect, it } from "vitest";
import { buildProductCollections, publicProductCollections, categoryAnchor, categoryPath, isCommerceSnapshotVisible, productPath } from "../../src/features/store-shell/product-catalog.js";

const categories = [
  { id: "tees", data: { title: "Tees" } },
  { id: "hats", data: { title: "Hats" } },
];

describe("CMS product grouping", () => {
  it("binds live availability only to exact demo IDs, regardless of editorial claims", () => {
    const groups = buildProductCollections([
      { id: "everyday-tee", data: { title: "Everyday Tee", categories: ["tees"], commerce_item_id: "dinkus-template-managed-product", description: "Soft tee", visual_label: "TEE" } },
      { id: "canvas-cap", data: { title: "Canvas Cap", categories: ["hats"], commerce_item_id: "dinkus-template-unmanaged-product", description: "Simple cap", visual_label: "CAP" } },
      { id: "impostor", data: { title: "Another Tee", categories: ["tees"], commerce_item_id: "preview", description: "Preview", visual_label: "HOODIE", availability_source: "managed" } },
    ], categories);
    expect(groups[0].items[0]).toMatchObject({ id: "canvas-cap", availabilitySource: "unmanaged", illustration: "cap" });
    expect(groups[1].items[0]).toMatchObject({ id: "everyday-tee", availabilitySource: "managed", illustration: "tee" });
    expect(groups[1].items[1]).toMatchObject({ id: "impostor", availabilitySource: "preview", illustration: "hoodie" });
    expect(publicProductCollections(groups, false, true).flatMap(group => group.items).map(item => item.id)).toEqual(["canvas-cap", "impostor"]);
    expect(publicProductCollections(groups, true, false).flatMap(group => group.items).map(item => item.id)).toEqual(["everyday-tee", "impostor"]);
    expect(categoryAnchor("Everyday Hats")).toBe("collection-everyday-hats");
    expect(categoryPath("Everyday Hats")).toBe(categoryPath("Everyday-Hats"));
    expect(productPath("everyday-tee")).toBe("/products/everyday-tee");
    expect(productPath("../admin")).toBeNull();
  });
  it("keeps published entries with optional description absent and hides Commerce unpriced draft", () => {
    const groups = buildProductCollections([
      { id: "new-preview", data: { title: "New", categories: ["tees"], commerce_item_id: "preview", visual_label: "tee" } },
      { id: "dinkus-template-unpriced-product", data: { title: "Draft", categories: ["tees"], commerce_item_id: "preview", visual_label: "tee" } },
    ], categories);
    expect(groups.find((group) => group.slug === "tees")?.items).toMatchObject([{ id: "new-preview", description: "" }]);
  });

  it("keeps a priced out-of-stock Commerce product on the grid for sold-out rendering", () => {
    expect(isCommerceSnapshotVisible({
      found: true,
      price: { listable: true },
      availability: { listable: false },
    })).toBe(true);
    expect(isCommerceSnapshotVisible({
      found: true,
      price: { listable: false },
    })).toBe(false);
  });
});
