import { describe, expect, it } from "vitest";
import { buildMerchCollections, publicMerchCollections, categoryAnchor, categoryPath, productPath } from "../../src/features/store-shell/merch-catalog.js";

const categories = [
  { id: "tees", data: { title: "Tees" } },
  { id: "hats", data: { title: "Hats" } },
];

describe("CMS merchandise grouping", () => {
  it("binds live availability only to exact demo IDs, regardless of editorial claims", () => {
    const groups = buildMerchCollections([
      { id: "everyday-tee", data: { title: "Everyday Tee", categories: ["tees"], commerce_item_id: "dinkus-template-managed-product", description: "Soft tee", visual_label: "TEE" } },
      { id: "canvas-cap", data: { title: "Canvas Cap", categories: ["hats"], commerce_item_id: "dinkus-template-unmanaged-product", description: "Simple cap", visual_label: "CAP" } },
      { id: "impostor", data: { title: "Another Tee", categories: ["tees"], commerce_item_id: "preview", description: "Preview", visual_label: "HOODIE", availability_source: "managed" } },
    ], categories);
    expect(groups[0].items[0]).toMatchObject({ id: "canvas-cap", availabilitySource: "unmanaged", illustration: "cap" });
    expect(groups[1].items[0]).toMatchObject({ id: "everyday-tee", availabilitySource: "managed", illustration: "tee" });
    expect(groups[1].items[1]).toMatchObject({ id: "impostor", availabilitySource: "preview", illustration: "hoodie" });
    expect(publicMerchCollections(groups, false, true).flatMap(group => group.items).map(item => item.id)).toEqual(["canvas-cap", "impostor"]);
    expect(publicMerchCollections(groups, true, false).flatMap(group => group.items).map(item => item.id)).toEqual(["everyday-tee", "impostor"]);
    expect(categoryAnchor("Everyday Hats")).toBe("collection-everyday-hats");
    expect(categoryPath("Everyday Hats")).toBe(categoryPath("Everyday-Hats"));
    expect(productPath("everyday-tee")).toBe("/products/everyday-tee");
    expect(productPath("../admin")).toBeNull();
  });
  it("keeps published entries with optional description absent and hides Commerce unpriced draft", () => {
    const groups = buildMerchCollections([
      { id: "new-preview", data: { title: "New", categories: ["tees"], commerce_item_id: "preview", visual_label: "tee" } },
      { id: "dinkus-template-unpriced-product", data: { title: "Draft", categories: ["tees"], commerce_item_id: "preview", visual_label: "tee" } },
    ], categories);
    expect(groups.find((group) => group.slug === "tees")?.items).toMatchObject([{ id: "new-preview", description: "" }]);
  });
});
