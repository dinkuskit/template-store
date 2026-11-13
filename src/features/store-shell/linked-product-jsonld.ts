import { buildProductJsonLd, buildProductPreviewJsonLd } from "@dinkuskit/commerce/features/structured-data";
import type { PublicCommerceProduct, PublicCommerceVariant } from "../commerce-catalog/types.js";

/** Prepare selected-member facts on the server; the browser only selects a block. */
export function linkedProductJsonLd(
  product: PublicCommerceProduct,
  page: { url: string; name: string; description?: string },
  variant: PublicCommerceVariant | null = null,
) {
  // Older Commerce projections have member prices/availability but no member SKU.
  // Keep page facts, not an Offer identified with a sibling/default member's SKU.
  if (variant && !variant.sku) return buildProductPreviewJsonLd(page);
  const priceMinor = variant?.unitMinor ?? product.price.unitMinor;
  return buildProductJsonLd({
    product: {
      id: variant?.id ?? product.id,
      name: page.name,
      sku: variant?.sku ?? product.sku,
      ...(priceMinor ? { price: { currency: "USD" as const, minor: priceMinor } } : {}),
      availability: variant ? { ...variant.availability, listable: true as const } : product.availability,
      // GTIN/MPN are not projected per member either. Never borrow them.
      ...(!variant && product.gtin ? { gtin: product.gtin } : {}),
      ...(!variant && product.mpn ? { mpn: product.mpn } : {}),
      ...(product.brand ? { brand: product.brand } : {}),
    },
    page,
    // Store policies remain EmDash content; structured shipping/return terms are deferred.
  });
}
