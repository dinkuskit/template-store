import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildMerchCollections,
  leftCommerceCatalog,
  withoutRemovedProducts,
} from "../../src/features/store-shell/merch-catalog.js";

describe("products whose Commerce product left the catalog", () => {
  it("counts an archived merchant product, never a seeded preview or a demonstration", () => {
    expect(leftCommerceCatalog("cat_journey_hat", false)).toBe(true);
    expect(leftCommerceCatalog("cat_journey_hat", true)).toBe(false);
    expect(leftCommerceCatalog("dinkus-template-preview-boxy-tee", false)).toBe(false);
    expect(leftCommerceCatalog("dinkus-template-managed-product", false)).toBe(false);
    expect(leftCommerceCatalog("dinkus-template-unmanaged-product", false)).toBe(false);
    expect(leftCommerceCatalog("", false)).toBe(false);
  });

  it("leave their category", () => {
    const groups = buildMerchCollections([
      { id: "journey-hat", data: { title: "Journey hat", categories: ["hats"], commerce_item_id: "cat_journey_hat", visual_label: "cap" } },
      { id: "canvas-cap", data: { title: "Canvas cap", categories: ["hats"], commerce_item_id: "cat_canvas_cap", visual_label: "cap" } },
    ], [{ id: "hats", data: { title: "Hats" } }]);
    const shown = withoutRemovedProducts(groups, new Set(["journey-hat"]));
    expect(shown.find((group) => group.slug === "hats")?.items.map((item) => item.id)).toEqual(["canvas-cap"]);
  });

  it("drop out of category pages only when the catalog was read, while proof-only MerchCatalog groups live on /proof", () => {
    const category = readFileSync("src/pages/categories/[slug].astro", "utf8");
    expect(category).toContain('const removedEntryIds = new Set(profile === "shipping" && catalogRead');
    expect(category).toContain("withoutRemovedProducts([listedCategory], removedEntryIds)[0]");
    const home = readFileSync("src/pages/index.astro", "utf8");
    expect(home).not.toContain("<MerchCatalog");
    expect(home).not.toContain("data-integration-demos");
    const proof = readFileSync("src/pages/proof.astro", "utf8");
    expect(proof).toContain("<MerchCatalog collections={collections} ");
  });

  it("have a product page that says the product is no longer available, as a 404", () => {
    const page = readFileSync("src/pages/products/[id].astro", "utf8");
    expect(page).toContain("if (noLongerAvailable) Astro.response.status = 404;");
    expect(page).toContain("<h1>This product is no longer available</h1>");
    expect(page).toContain('<a href="/">Browse the shop</a>');
    // The editorial-preview wording is never reached for such a page.
    expect(page.indexOf("{noLongerAvailable ? <section class=\"product-removed\"")).toBeLessThan(
      page.indexOf("This is an editorial preview. It is not purchasable."),
    );
  });
});
