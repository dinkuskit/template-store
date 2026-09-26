import type { CatalogItemPriceResolution } from "@dinkuskit/commerce";

export type PublicPriceView = Readonly<{
  listable: boolean;
  regularText: string | null;
  saleText: string | null;
}>;

export function formatUsdMinor(minor: string): string {
  if (!/^(0|[1-9][0-9]*)$/u.test(minor)) {
    throw new Error("USD minor must be an integer string");
  }
  const cents = BigInt(minor);
  const dollars = cents / 100n;
  const remainder = cents % 100n;
  return `$${dollars}.${remainder.toString().padStart(2, "0")}`;
}

export function presentStorefrontPrice(
  price: CatalogItemPriceResolution,
): PublicPriceView {
  if (!price.listable || !price.regular) {
    return { listable: false, regularText: null, saleText: null };
  }
  return {
    listable: true,
    regularText: formatUsdMinor(price.regular.minor),
    saleText: price.sale ? formatUsdMinor(price.sale.minor) : null,
  };
}
