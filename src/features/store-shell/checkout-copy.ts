/**
 * Shopper-facing checkout wording. Every storefront page reads the same
 * installed checkout admission the cart uses, so the banner, homepage copy and
 * product notices never claim checkout is off when the cart can check out.
 */
export function storeBannerText(checkoutAvailable: boolean): string {
  return checkoutAvailable
    ? "Test checkout is available. No live purchases."
    : "Demo / Test Store — Purchases and checkout are unavailable.";
}

export type CatalogGuidanceState = "unavailable" | "empty" | "ready";

export function catalogGuidanceCopy(
  state: CatalogGuidanceState,
  checkoutAvailable: boolean,
): { heading: string; detail: string } {
  if (state === "unavailable") {
    return {
      heading: "The catalog is unavailable right now.",
      detail: "Products are not shown until the connected store can be reached.",
    };
  }
  if (state === "empty") {
    return {
      heading: "No products are listed yet.",
      detail: "Products will appear here when they are published.",
    };
  }
  return {
    heading: "Browse the current catalog.",
    detail: checkoutAvailable
      ? "Eligible products can be added to your cart and checked out with test payments."
      : "Eligible products can be added to your cart. Checkout is unavailable, so no purchase will be completed.",
  };
}

/** The catalog footnote, or null when checkout works and nothing needs saying. */
export function catalogNoticeText(input: {
  unavailable: boolean;
  productCount: number;
  checkoutAvailable: boolean;
}): string | null {
  if (input.checkoutAvailable) return null;
  return input.unavailable || input.productCount === 0
    ? "Checkout is unavailable."
    : "Product browsing is available. Checkout is not available yet.";
}

/** Variant stock is shown by the picker and Add button, not a static product notice. */
export function linkedProductPurchaseNotice(input: {
  offersCart: boolean;
  checkoutAvailable: boolean;
  hasVariants: boolean;
  sellable: boolean;
}): string | null {
  if (!input.checkoutAvailable) return "Checkout is unavailable right now, so this product can't be bought.";
  if (input.offersCart && (input.hasVariants || input.sellable)) return null;
  return "This product can't be bought right now.";
}
