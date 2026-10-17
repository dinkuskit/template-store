import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  catalogGuidanceCopy,
  catalogNoticeText,
  linkedProductPurchasable,
  storeBannerText,
} from "../../src/features/store-shell/checkout-copy.js";

const STOREFRONT_PAGES = [
  "src/pages/index.astro",
  "src/pages/cart.astro",
  "src/pages/products/[id].astro",
  "src/pages/categories/[slug].astro",
] as const;

describe("storefront checkout wording", () => {
  it("banner follows installed checkout admission", () => {
    expect(storeBannerText(true)).toBe("Test checkout is available. No live purchases.");
    expect(storeBannerText(false)).toBe("Demo / Test Store — Purchases and checkout are unavailable.");
  });

  it("every storefront page reads checkout admission for its banner", () => {
    for (const path of STOREFRONT_PAGES) {
      const page = readFileSync(path, "utf8");
      expect(page, path).toContain("acquireGuestCheckoutAdmission");
      expect(page, path).toMatch(/data-store-demo-banner data-checkout-available=\{String\(/);
      expect(page, path).toContain("{storeBannerText(");
      expect(page, path).not.toContain("Synthetic demonstration. Purchases and checkout are unavailable.");
    }
  });

  it("homepage guidance only mentions checkout when products can be bought", () => {
    expect(catalogGuidanceCopy("ready", true).detail).toBe(
      "Eligible products can be added to your cart and checked out with test payments.",
    );
    expect(catalogGuidanceCopy("ready", false).detail).toContain("Checkout is unavailable");
    for (const admitted of [true, false]) {
      expect(catalogGuidanceCopy("unavailable", admitted).detail).not.toMatch(/checkout/i);
      expect(catalogGuidanceCopy("empty", admitted).detail).not.toMatch(/checkout/i);
    }
    expect(catalogGuidanceCopy("unavailable", true).detail).toContain(
      "Products are not shown until the connected store can be reached",
    );
  });

  it("catalog footnote stays quiet when checkout works", () => {
    expect(catalogNoticeText({ unavailable: false, productCount: 3, checkoutAvailable: true })).toBeNull();
    expect(catalogNoticeText({ unavailable: true, productCount: 0, checkoutAvailable: true })).toBeNull();
    expect(catalogNoticeText({ unavailable: false, productCount: 3, checkoutAvailable: false })).toBe(
      "Product browsing is available. Checkout is not available yet.",
    );
    expect(catalogNoticeText({ unavailable: false, productCount: 0, checkoutAvailable: false })).toBe(
      "Checkout is unavailable.",
    );
    const catalog = readFileSync("src/features/commerce-catalog/CommerceCatalog.astro", "utf8");
    expect(catalog).toContain("{notice && <p class=\"notice\">{notice}</p>}");
    expect(readFileSync("src/pages/index.astro", "utf8")).toContain("checkoutAvailable={checkoutAvailable} />");
  });

  it("a linked product is purchasable only with a cart, admitted checkout and a sellable item", () => {
    expect(linkedProductPurchasable({ offersCart: true, checkoutAvailable: true, sellable: true })).toBe(true);
    expect(linkedProductPurchasable({ offersCart: false, checkoutAvailable: true, sellable: true })).toBe(false);
    expect(linkedProductPurchasable({ offersCart: true, checkoutAvailable: false, sellable: true })).toBe(false);
    expect(linkedProductPurchasable({ offersCart: true, checkoutAvailable: true, sellable: false })).toBe(false);
  });

  it("product page drops the editorial-preview notice for buyable Commerce products", () => {
    const page = readFileSync("src/pages/products/[id].astro", "utf8");
    // Linked products are handled before the editorial-preview branch, which is
    // left only for entries with no Commerce product behind them.
    const linkedBranch = page.indexOf(": linkedProduct ? (purchasable ? null :");
    const previewBranch = page.indexOf("This is an editorial preview. It is not purchasable.");
    expect(linkedBranch).toBeGreaterThan(0);
    expect(previewBranch).toBeGreaterThan(linkedBranch);
    expect(page).toContain("data-not-purchasable");
  });
});

describe("homepage without a published home page", () => {
  const page = readFileSync("src/pages/index.astro", "utf8");

  it("shows shoppers the store name and the shop, not a developer notice", () => {
    expect(page).not.toContain("Storefront composition is unavailable");
    expect(page).not.toContain('role="alert" data-content-missing');
    expect(page).toContain('<section class="store-default-home" data-home-default>');
    expect(page).toContain("<h1>{siteTitle}</h1>");
    expect(page).toContain('<a href="#commerce-catalog">Browse the shop</a>');
  });

  it("keeps the seed hint for developers only", () => {
    expect(page).toMatch(/if \(!composed && import\.meta\.env\.DEV\) \{\n\s+console\.warn\(.*Load the neutral EmDash seed/);
  });
});

describe("neutral seed copy", () => {
  it("no longer tells shoppers checkout is unavailable", () => {
    const seed = readFileSync("seed/seed.json", "utf8");
    expect(seed).not.toContain("Checkout is not available yet");
    expect(seed).toContain("Browse products published in Commerce.");
  });
});
