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

// A published page whose entry id is `01<slug>`; `itemId` is the product Commerce links to it (see `links`).
function product(id: string, itemId: string, category = "tees") {
  return {
    id,
    itemId,
    data: {
      id: `01${id}`,
      title: id,
      description: "Description",
      visual_label: "TEE",
      categories: [category],
    },
  };
}
/** Commerce's links for these pages, as commercePageLinks reads them from the public catalog. */
const links = (pages: ReturnType<typeof product>[]) => new Map(pages.map((page) => [page.data.id, page.itemId]));

describe("canonical product routes", () => {
  it("uses the editorial slug only in a flat canonical URL", () => {
    expect(canonicalProductPath("everyday-tee")).toBe("/products/everyday-tee");
    expect(canonicalCollectionPath("tees")).toBe("/categories/tees");
    expect(validProductSlug("nested/item")).toBe(false);
    expect(validProductSlug("Everyday Tee")).toBe(false);
  });

  it("fails closed on malformed and duplicate published Commerce links", () => {
    const pages = [
      product("one", "item-1"),
      product("two", "item-1"),
      product("bad/item", "item-2"),
      product("orphan", "item-3", "unknown"),
    ];
    const result = readProductEntries(pages, categories, links(pages));
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
  it("finds each page's product through Commerce, then the seed's demonstration slug, never an older store's field", () => {
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
      // template-drop-older-store-box-20261101: an older store's field names nothing.
      page("legacy", "01LEG", { commerce_item_id: " cat_legacy " }),
      page("everyday-tee", "01TEE"),
      page("new-page", "01NEW"),
    ], categories, links);
    expect(result.products.map((product) => [product.id, product.commerceItemId])).toEqual([
      ["hat", "cat_hat"],
      ["old", "cat_relinked"],
      ["everyday-tee", "dinkus-template-managed-product"],
    ]);
    expect(result.unlinked).toEqual(["legacy", "new-page"]);
    expect(result.errors).toEqual([]);
    expect(pageCommerceItemId(page("canvas-cap", "01CAP"))).toBe("dinkus-template-unmanaged-product");
    expect(pageCommerceItemId(page("canvas-cap", "01CAP"), new Map([["01CAP", "cat_cap"]]))).toBe("cat_cap");
  });

  // template-sells-anything-20261027: a store may sell anything, so a migrated
  // seed or nutrient product with no placeholder art is a product like any other.
  it("keeps products of any kind, with or without placeholder art", () => {
    const seeds = { id: "runtz-candy-kush", data: { id: "01RUNTZ", title: "Runtz Candy Kush", description: "Fruity.", categories: ["hats"] } };
    const tee = product("everyday-tee", "item-1");
    const result = readProductEntries([seeds, tee, {
      id: "mycrobes", data: { id: "01MYC", title: "Mycrobes", categories: [], visual_label: "JAR" },
    }], categories, new Map([["01RUNTZ", "wc-var-1938"], [tee.data.id, "item-1"], ["01MYC", "item-2"]]));
    expect(result.errors).toEqual([]);
    expect(result.products.map((entry) => [entry.id, entry.illustration])).toEqual([
      ["runtz-candy-kush", null],
      ["everyday-tee", "tee"],
      ["mycrobes", null],
    ]);
  });
});
