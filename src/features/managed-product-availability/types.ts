import type { PublicPriceView } from "../store-shell/index.js";

export type ManagedProductAvailability = Readonly<{
  product: Readonly<{
    itemId: string;
    name: string;
    sku: string;
    state: "draft";
  }>;
  price: PublicPriceView;
  inventory: Readonly<{
    inventorySkuId: string;
    poolId: string;
    locationId: string;
    onHand: string;
    reserved: string;
    available: string;
    unit: string;
    version: string;
  }>;
  provenance: Readonly<{
    blocks: string;
    commerce: string;
    inventory: string;
  }>;
}>;

export type StockProofAdjustment = Readonly<{
  commandId: string;
  delta: string;
  reason: "proof-change" | "proof-restore";
}>;

export interface ManagedProductAvailabilityRuntime {
  read(): Promise<ManagedProductAvailability>;
  adjust(input: StockProofAdjustment): Promise<ManagedProductAvailability>;
}
