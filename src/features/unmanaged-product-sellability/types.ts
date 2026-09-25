import type {
  CatalogManualAvailabilityStatus,
  StorefrontAvailabilityResult,
} from "@dinkuskit/commerce";

export const UNMANAGED_PRODUCT_ITEM_ID = "dinkus-template-unmanaged-product";
export const UNMANAGED_PRODUCT_NAME = "Dinkus Field Notes";
export const UNMANAGED_PRODUCT_SKU = "DINKUS-DEMO-UNMANAGED";

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
  provenance: Readonly<{
    blocks: string;
    commerce: string;
    inventory: string;
  }>;
}>;

export interface UnmanagedProductSellabilityRuntime {
  read(): Promise<UnmanagedProductSellability>;
  setAvailability(
    input: UnmanagedAvailabilityProof,
  ): Promise<UnmanagedProductSellability>;
}
