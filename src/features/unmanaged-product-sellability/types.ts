import type {
  CatalogManualAvailabilityStatus,
  StorefrontAvailabilityResult,
} from "@dinkuskit/commerce";
import type { PublicPriceView } from "../store-shell/index.js";

export const UNMANAGED_PRODUCT_ITEM_ID = "dinkus-template-unmanaged-product";
export const UNMANAGED_PRODUCT_NAME = "Canvas Cap";
export const UNMANAGED_PRODUCT_SKU = "DINKUS-DEMO-UNMANAGED";
export const UNPRICED_PRODUCT_ITEM_ID = "dinkus-template-unpriced-product";
export const UNPRICED_PRODUCT_NAME = "Dinkus Unpriced Draft";
export const UNPRICED_PRODUCT_SKU = "DINKUS-DEMO-UNPRICED";

export type UnmanagedManualAvailabilityStatus = CatalogManualAvailabilityStatus;

export type UnmanagedAvailabilityProof = Readonly<{
  catalogItemId: string;
  status: UnmanagedManualAvailabilityStatus;
}>;

export type UnmanagedProductSellability = Readonly<{
  product: Readonly<{
    itemId: string;
    name: string;
    sku: string;
    state: "draft";
    stockMode: "unmanaged";
  }>;
  storefront: StorefrontAvailabilityResult;
  price: PublicPriceView;
  provenance: Readonly<{
    blocks: string;
    commerce: string;
    inventory: string;
  }>;
}>;

export interface UnmanagedProductSellabilityRuntime {
  read(): Promise<UnmanagedProductSellability>;
  readUnpricedDraft(): Promise<UnmanagedProductSellability>;
  setAvailability(
    input: UnmanagedAvailabilityProof,
  ): Promise<UnmanagedProductSellability>;
}
