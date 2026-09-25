import {
  CatalogError,
  StorefrontAvailabilityError,
  createCatalogItem,
  resolveStorefrontAvailability,
  setCatalogItemManualAvailability,
  type CatalogItemRecord,
  type StorefrontAvailabilityResolverStorage,
} from "@dinkuskit/commerce";

import { UnmanagedProductSellabilityError } from "./errors.js";
import {
  createMemoryAvailabilitySettingsStorage,
  createMemoryBackorderPolicyStorage,
  createMemoryCatalogStorage,
  createMemoryManualAvailabilityStorage,
  createUnusedConfigurationStorage,
} from "./memory-storage.js";
import {
  UNMANAGED_PRODUCT_ITEM_ID,
  UNMANAGED_PRODUCT_NAME,
  UNMANAGED_PRODUCT_SKU,
  type UnmanagedAvailabilityProof,
  type UnmanagedProductSellability,
  type UnmanagedProductSellabilityRuntime,
} from "./types.js";

const PROVENANCE = {
  blocks: "f197c8108de244c47d651ec16cb1f4d25b15736f",
  commerce: "b9e432b1869bae09e394f5d631aa97b6949bf2fd",
  inventory: "4f1bdfc85964fc41fe466336784af62261384679",
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

function present(
  item: CatalogItemRecord,
  storefront: UnmanagedProductSellability["storefront"],
): UnmanagedProductSellability {
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
  return {
    product: {
      itemId: item.itemId,
      name: item.name,
      sku: item.sku,
      state: item.state,
      stockMode: "unmanaged",
    },
    storefront,
    provenance: PROVENANCE,
  };
}

export function createUnmanagedProductSellabilityRuntime(): UnmanagedProductSellabilityRuntime {
  const catalog = createMemoryCatalogStorage();
  const manualAvailability = createMemoryManualAvailabilityStorage();
  const storage: StorefrontAvailabilityResolverStorage = {
    catalog,
    manualAvailability,
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
      return result.item;
    } catch (error) {
      rethrow(error);
    }
  }

  function ensureBootstrap(): Promise<CatalogItemRecord> {
    bootstrapPromise ??= bootstrap();
    return bootstrapPromise;
  }

  async function readAvailability(): Promise<UnmanagedProductSellability> {
    const item = await ensureBootstrap();
    try {
      const storefront = await resolveStorefrontAvailability(storage, {
        catalogItemId: item.itemId,
      });
      return present(item, storefront);
    } catch (error) {
      rethrow(error);
    }
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
