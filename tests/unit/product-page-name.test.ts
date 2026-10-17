import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("product page name", () => {
  const page = readFileSync("src/pages/products/[id].astro", "utf8");

  it("shows the linked Commerce product's name, so a rename changes the heading", () => {
    expect(page).toContain("const productName = linkedProduct?.name.trim() || item?.title;");
    expect(page).toContain("<h1>{productName}</h1>");
    expect(page).toContain("`${productName} | ${STORE_TITLE}`");
    expect(page).toContain('<span aria-current="page">{productName ?? "Not found"}</span>');
    expect(page).not.toContain("<h1>{item.title}</h1>");
  });

  it("category cards show the linked Commerce product's name too", () => {
    const catalog = readFileSync("src/features/store-shell/MerchCatalog.astro", "utf8");
    expect(catalog).toContain("const name = commerce?.name.trim() || item.title;");
    expect(catalog).toContain("{collectionOnly ? <h2>{name}</h2> : <h4>{name}</h4>}");
    expect(catalog).toContain("aria-label={`View ${name} details`}");
  });
});
