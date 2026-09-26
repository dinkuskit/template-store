import {
  CatalogError,
  StorefrontAvailabilityError,
  createCatalogItem,
  resolveCatalogItemPrice,
  resolveStorefrontAvailability,
  setCatalogItemManualAvailability,
  setCatalogItemRegularPrice,
  setCatalogItemSalePrice,
  type CatalogItemRecord,
  type StorefrontAvailabilityResolverStorage,
} from "@dinkuskit/commerce";

import { presentStorefrontPrice } from "../store-shell/index.js";
import { UnmanagedProductSellabilityError } from "./errors.js";
import {
  createMemoryAvailabilitySettingsStorage,
  createMemoryBackorderPolicyStorage,
  createMemoryCatalogStorage,
  createMemoryManualAvailabilityStorage,
  createMemoryPriceStorage,
  createUnusedConfigurationStorage,
} from "./memory-storage.js";
import {
  UNMANAGED_PRODUCT_ITEM_ID,
  UNMANAGED_PRODUCT_NAME,
  UNMANAGED_PRODUCT_SKU,
  UNPRICED_PRODUCT_ITEM_ID,
  UNPRICED_PRODUCT_NAME,
  UNPRICED_PRODUCT_SKU,
  type UnmanagedAvailabilityProof,
  type UnmanagedProductSellability,
  type UnmanagedProductSellabilityRuntime,
} from "./types.js";

const PROVENANCE = {
  blocks: "fe03bfac91798ac0b411b952fe23c26afefbf570",
  commerce: "3f20fe96d5b3104c4b599e669d18f54fd8ab2587",
  inventory: "5889c7d59398376da51ac400d5c1f1214aba2c6b",
} as const;

const MANUAL_STATUSES = new Set<UnmanagedAvailabilityProof["status"]>([
  "in-stock",
  "out-of-stock",
  "available-on-backorder",
]);

function validProof(input: UnmanagedAvailabilityProof): void {
  if (
    Object.keys(input).length !== 2 ||
    input.catalogItemId !== UNMANAGED_PRODUCT_ITEM_ID ||
    !MANUAL_STATUSES.has(input.status)
  ) {
    throw new UnmanagedProductSellabilityError(
      "PROOF_INPUT_INVALID",
      "unmanaged proof accepts only the demo catalog item and a manual status",
    );
  }
}

function rethrow(error: unknown): never {
  if (error instanceof UnmanagedProductSellabilityError) {
    throw error;
  }
  if (error instanceof CatalogError) {
    throw new UnmanagedProductSellabilityError(
      error.code === "MANAGE_STOCK_ENABLED"
        ? "MANAGE_STOCK_ENABLED"
        : "CATALOG_REJECTED",
      error.message,
    );
  }
  if (error instanceof StorefrontAvailabilityError) {
    throw new UnmanagedProductSellabilityError(
      "AVAILABILITY_REJECTED",
      error.message,
    );
  }
  throw error;
}

async function present(
  item: CatalogItemRecord,
  storefront: UnmanagedProductSellability["storefront"],
  prices: StorefrontAvailabilityResolverStorage["prices"],
): Promise<UnmanagedProductSellability> {
  if (item.stockManagement.mode !== "unmanaged") {
    throw new UnmanagedProductSellabilityError(
      "CATALOG_REJECTED",
      "The unmanaged proof product is not in unmanaged stock mode.",
    );
  }
  if (storefront.displayQuantity !== undefined) {
    throw new UnmanagedProductSellabilityError(
      "QUANTITY_EXPOSED",
      "Unmanaged storefront availability must never expose a quantity.",
    );
  }
  const price = presentStorefrontPrice(
    await resolveCatalogItemPrice(prices, item.itemId),
  );
  return {
    product: {
      itemId: item.itemId,
      name: item.name,
      sku: item.sku,
      state: item.state,
      stockMode: "unmanaged",
    },
    storefront,
    price,
    provenance: PROVENANCE,
  };
}

export function createUnmanagedProductSellabilityRuntime(): UnmanagedProductSellabilityRuntime {
  const catalog = createMemoryCatalogStorage();
  const manualAvailability = createMemoryManualAvailabilityStorage();
  const prices = createMemoryPriceStorage();
  const storage: StorefrontAvailabilityResolverStorage = {
    catalog,
    manualAvailability,
    prices,
    backorderPolicies: createMemoryBackorderPolicyStorage(),
    configurations: createUnusedConfigurationStorage(),
    settings: createMemoryAvailabilitySettingsStorage(),
  };
  let bootstrapPromise: Promise<CatalogItemRecord> | null = null;
  let mutationTail: Promise<void> = Promise.resolve();
  let timestampOffset = 0;

  const now = (): Date => {
    const timestamp = Date.parse("2026-09-25T16:00:00.000Z") + timestampOffset;
    timestampOffset += 1_000;
    return new Date(timestamp);
  };

  async function bootstrap(): Promise<CatalogItemRecord> {
    try {
      const result = await createCatalogItem(
        catalog,
        {
          commandId: "template-store-unmanaged-catalog-v1",
          manageStock: false,
          name: UNMANAGED_PRODUCT_NAME,
          sku: UNMANAGED_PRODUCT_SKU,
        },
        {
          createId: () => UNMANAGED_PRODUCT_ITEM_ID,
          now,
        },
      );
      await setCatalogItemRegularPrice(
        { catalog, prices },
        {
          catalogItemId: result.item.itemId,
          amount: { currency: "USD", minor: "1200" },
        },
      );
      await setCatalogItemSalePrice(
        { catalog, prices },
        {
          catalogItemId: result.item.itemId,
          amount: { currency: "USD", minor: "1000" },
        },
      );
      await createCatalogItem(
        catalog,
        {
          commandId: "template-store-unpriced-catalog-v1",
          manageStock: false,
          name: UNPRICED_PRODUCT_NAME,
          sku: UNPRICED_PRODUCT_SKU,
        },
        {
          createId: () => UNPRICED_PRODUCT_ITEM_ID,
          now,
        },
      );
      return result.item;
    } catch (error) {
      rethrow(error);
    }
  }

  function ensureBootstrap(): Promise<CatalogItemRecord> {
    bootstrapPromise ??= bootstrap();
    return bootstrapPromise;
  }

  async function readItem(
    catalogItemId: string,
  ): Promise<UnmanagedProductSellability> {
    const item = await catalog.get(catalogItemId);
    if (!item || item.recordKind !== "catalog-item") {
      throw new UnmanagedProductSellabilityError(
        "CATALOG_REJECTED",
        "The unmanaged proof product is missing.",
      );
    }
    try {
      const storefront = await resolveStorefrontAvailability(storage, {
        catalogItemId: item.itemId,
      });
      return present(item, storefront, prices);
    } catch (error) {
      rethrow(error);
    }
  }

  async function readAvailability(): Promise<UnmanagedProductSellability> {
    await ensureBootstrap();
    return readItem(UNMANAGED_PRODUCT_ITEM_ID);
  }

  async function readUnpricedDraft(): Promise<UnmanagedProductSellability> {
    await ensureBootstrap();
    return readItem(UNPRICED_PRODUCT_ITEM_ID);
  }

  async function executeAvailability(
    input: UnmanagedAvailabilityProof,
  ): Promise<UnmanagedProductSellability> {
    validProof(input);
    await ensureBootstrap();
    try {
      await setCatalogItemManualAvailability(
        { catalog, availability: manualAvailability },
        input,
      );
      return readAvailability();
    } catch (error) {
      rethrow(error);
    }
  }

  return {
    read: readAvailability,
    readUnpricedDraft,
    setAvailability(input) {
      const run = mutationTail.then(() => executeAvailability(input));
      mutationTail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

export const unmanagedProductSellabilityRuntime =
  createUnmanagedProductSellabilityRuntime();
