import {
  configureCatalogItemInventory,
  createCatalogItem,
  createStoreInventoryConfiguration,
  type CatalogItemRecord,
  type ManagedSkuRegistration,
  type ManagedStockManagement,
  type StoreInventoryConfigurationRecord,
} from "@dinkuskit/commerce";
import {
  COMMAND_SCHEMA,
  CREATE_LOCATION_TYPE,
  MANAGED_SKU_UNIT,
  OPENING_BALANCE_TYPE,
  REGISTER_MANAGED_SKU_TYPE,
  STOCK_ADJUSTMENT_TYPE,
  createAdjustStock,
  createExecuteLocationCommand,
  createReadSkuLocationBalance,
  createReadSkuStock,
  createRegisterManagedSku,
  createSetOpeningBalance,
  type AdjustStockCommandV1,
  type CommandPrincipal,
} from "@dinkuskit/inventory";

import { ManagedProductAvailabilityError } from "./errors.js";
import { createMemoryCommerceStorage } from "./memory-catalog-storage.js";
import { MemoryInventoryStore } from "./memory-inventory-store.js";
import type {
  ManagedProductAvailability,
  ManagedProductAvailabilityRuntime,
  StockProofAdjustment,
} from "./types.js";

const PROOF_SITE_ID = "dinkus-template-store";
const POOL_ID = "dinkus-template-proof-pool";
const LOCATION_ID = "dinkus-template-proof-location";
const LOCATION_NAME = "Starter proof shelf";
const PRODUCT_ITEM_ID = "dinkus-template-product";
const PRODUCT_NAME = "Dinkus Field Kit";
const PRODUCT_SKU = "DINKUS-DEMO-001";
const INVENTORY_SKU_ID = "dinkus-inventory-sku-demo";
const OPENING_QUANTITY = "8";

const PROVENANCE = {
  blocks: "f197c8108de244c47d651ec16cb1f4d25b15736f",
  commerce: "b9e432b1869bae09e394f5d631aa97b6949bf2fd",
  inventory: "4f1bdfc85964fc41fe466336784af62261384679",
} as const;

const binding = {
  providerRef: "dinkuskit.inventory/local-proof",
  poolId: POOL_ID,
  defaultFulfillmentLocationId: LOCATION_ID,
} as const;

const systemPrincipal: CommandPrincipal = {
  kind: "system",
  id: "template-store-proof",
  surface: "template-store/local-proof",
};

type BootstrapState = Readonly<{
  catalogItem: CatalogItemRecord;
  inventorySkuId: string;
  locationId: string;
  poolId: string;
  siteId: string;
}>;

function validAdjustment(input: StockProofAdjustment): void {
  if (!/^[A-Za-z0-9:_-]{1,120}$/u.test(input.commandId)) {
    throw new ManagedProductAvailabilityError(
      "PROOF_INPUT_INVALID",
      "commandId must use 1-120 safe identity characters.",
    );
  }
  if (input.delta !== "-3" && input.delta !== "3") {
    throw new ManagedProductAvailabilityError(
      "PROOF_INPUT_INVALID",
      "The first proof vertical permits only -3 and +3 stock changes.",
    );
  }
  if (
    (input.reason === "proof-change" && input.delta !== "-3") ||
    (input.reason === "proof-restore" && input.delta !== "3")
  ) {
    throw new ManagedProductAvailabilityError(
      "PROOF_INPUT_INVALID",
      "The proof reason must match its bounded stock delta.",
    );
  }
}

function sameAdjustment(
  left: StockProofAdjustment,
  right: StockProofAdjustment,
): boolean {
  return (
    left.commandId === right.commandId &&
    left.delta === right.delta &&
    left.reason === right.reason
  );
}

export function createManagedProductAvailabilityRuntime(): ManagedProductAvailabilityRuntime {
  const commerceStorage = createMemoryCommerceStorage();
  const catalogStorage = commerceStorage.catalog;
  const inventoryStore = new MemoryInventoryStore();
  const adjustmentInputs = new Map<string, StockProofAdjustment>();
  const adjustmentCommands = new Map<string, AdjustStockCommandV1>();
  let stockManagement: ManagedStockManagement = {
    mode: "managed",
    status: "setup-required",
  };
  let bootstrapPromise: Promise<BootstrapState> | null = null;
  let mutationTail: Promise<void> = Promise.resolve();
  let timestampOffset = 0;
  let receiptCounter = 0;

  const now = (): Date => {
    const timestamp = Date.parse("2026-08-29T17:30:00.000Z") + timestampOffset;
    timestampOffset += 1_000;
    return new Date(timestamp);
  };
  const createReceiptId = (): string => {
    receiptCounter += 1;
    return `receipt-${receiptCounter}`;
  };

  const executeLocation = createExecuteLocationCommand({
    store: inventoryStore,
    now,
    createLocationId: () => binding.defaultFulfillmentLocationId,
    createReceiptId,
  });
  const registerInventorySku = createRegisterManagedSku({
    store: inventoryStore,
    now,
    createInventorySkuId: () => INVENTORY_SKU_ID,
  });
  const setOpeningBalance = createSetOpeningBalance({
    store: inventoryStore,
    now,
    createReceiptId,
  });
  const adjustStock = createAdjustStock({
    store: inventoryStore,
    now,
    createReceiptId,
  });
  const readStock = createReadSkuStock({ store: inventoryStore });
  const readBalance = createReadSkuLocationBalance({ store: inventoryStore });

  async function registerThroughInventory(
    configuration: StoreInventoryConfigurationRecord,
    registration: ManagedSkuRegistration,
  ) {
    const result = await registerInventorySku(
      {
        schema: COMMAND_SCHEMA,
        commandId: registration.operationId,
        type: REGISTER_MANAGED_SKU_TYPE,
        context: {
          siteId: configuration.siteId,
          poolId: registration.request.poolId,
        },
        payload: {
          sku: registration.request.sku,
          displayNameIfNew: registration.request.displayNameIfNew,
          unit: MANAGED_SKU_UNIT,
        },
        references: [{ kind: "commerce.catalog-item", id: PRODUCT_ITEM_ID }],
      },
      { principal: systemPrincipal },
    );
    if (result.outcome === "rejected") {
      return {
        outcome: "rejected" as const,
        code: result.code,
        message: result.message,
      };
    }
    return {
      outcome: result.outcome,
      inventorySku: result.inventorySku,
    };
  }

  async function bootstrap(): Promise<BootstrapState> {
    const configurationResult = await createStoreInventoryConfiguration(
      commerceStorage.configurations,
      binding,
      {
        createRecordId: () => "template-store-inventory-configuration",
        createSiteId: () => PROOF_SITE_ID,
        now,
      },
    );
    const configuration = configurationResult.configuration;
    const { poolId, defaultFulfillmentLocationId: locationId } =
      configuration.binding;
    const locationResult = await executeLocation(
      {
        schema: COMMAND_SCHEMA,
        commandId: "template-store-location-v1",
        type: CREATE_LOCATION_TYPE,
        context: { siteId: configuration.siteId, poolId },
        payload: { name: LOCATION_NAME },
        references: [],
      },
      { principal: systemPrincipal },
    );
    if (locationResult.outcome !== "committed") {
      throw new ManagedProductAvailabilityError(
        "BOOTSTRAP_REJECTED",
        `Inventory location setup was rejected: ${locationResult.code}.`,
      );
    }

    const catalogResult = await createCatalogItem(
      catalogStorage,
      {
        commandId: "template-store-catalog-v1",
        manageStock: true,
        name: PRODUCT_NAME,
        sku: PRODUCT_SKU,
      },
      {
        createId: () => PRODUCT_ITEM_ID,
        now,
      },
    );
    const catalogItem = catalogResult.item;
    stockManagement = catalogItem.stockManagement as ManagedStockManagement;
    const registrationResult = await configureCatalogItemInventory(
      commerceStorage,
      { catalogItemId: catalogItem.itemId },
      {
        createClaimRecordId: () => `claim-${catalogItem.itemId}`,
        createOperationId: () => "template-store-register-sku-v1",
        now,
        resolveProvider: async (configuredStore) =>
          configuredStore.binding.providerRef === binding.providerRef
            ? {
                registerManagedSku: (registration) =>
                  registerThroughInventory(configuredStore, registration),
              }
            : null,
      },
    );
    if (
      registrationResult.outcome !== "inventory-active" ||
      registrationResult.item.stockManagement.mode !== "managed" ||
      registrationResult.item.stockManagement.status !== "active"
    ) {
      throw new ManagedProductAvailabilityError(
        "INVENTORY_STATE_INVALID",
        "Commerce did not establish one active Inventory SKU identity.",
      );
    }
    stockManagement = registrationResult.item.stockManagement;

    const openingResult = await setOpeningBalance(
      {
        schema: COMMAND_SCHEMA,
        commandId: "template-store-opening-balance-v1",
        type: OPENING_BALANCE_TYPE,
        context: {
          siteId: configuration.siteId,
          poolId,
          locationId,
        },
        payload: {
          skuId: stockManagement.inventorySkuId,
          quantity: { value: OPENING_QUANTITY, unit: MANAGED_SKU_UNIT },
        },
        reason: { code: "template-proof", note: "Set starter proof stock" },
        references: [{ kind: "commerce.catalog-item", id: catalogItem.itemId }],
        expectedVersions: [
          {
            skuId: stockManagement.inventorySkuId,
            locationId,
            version: "0",
          },
        ],
      },
      { principal: systemPrincipal },
    );
    if (openingResult.outcome !== "committed") {
      throw new ManagedProductAvailabilityError(
        "BOOTSTRAP_REJECTED",
        `Inventory opening balance was rejected: ${openingResult.code}.`,
      );
    }

    return {
      catalogItem,
      inventorySkuId: stockManagement.inventorySkuId,
      locationId,
      poolId,
      siteId: configuration.siteId,
    };
  }

  function ensureBootstrap(): Promise<BootstrapState> {
    bootstrapPromise ??= bootstrap();
    return bootstrapPromise;
  }

  async function readAvailability(): Promise<ManagedProductAvailability> {
    const state = await ensureBootstrap();
    if (stockManagement.status !== "active") {
      throw new ManagedProductAvailabilityError(
        "CATALOG_STATE_INVALID",
        "The Commerce product is not linked to active Inventory stock.",
      );
    }
    const [stock, balanceResult] = await Promise.all([
      readStock({
        poolId: state.poolId,
        skuId: state.inventorySkuId,
        scope: { kind: "location", locationId: state.locationId },
      }),
      readBalance({
        poolId: state.poolId,
        skuId: state.inventorySkuId,
        locationId: state.locationId,
      }),
    ]);
    if (stock.outcome !== "found" || balanceResult.outcome !== "found") {
      throw new ManagedProductAvailabilityError(
        "INVENTORY_STATE_INVALID",
        "Inventory did not return the managed product's stock truth.",
      );
    }

    return {
      product: {
        itemId: state.catalogItem.itemId,
        name: state.catalogItem.name,
        sku: state.catalogItem.sku,
        state: state.catalogItem.state,
      },
      inventory: {
        inventorySkuId: state.inventorySkuId,
        poolId: state.poolId,
        locationId: state.locationId,
        onHand: stock.stock.onHand.value,
        reserved: stock.stock.reserved.value,
        available: stock.stock.available.value,
        unit: stock.stock.available.unit,
        version: balanceResult.balance.version,
      },
      provenance: PROVENANCE,
    };
  }

  async function executeAdjustment(
    input: StockProofAdjustment,
  ): Promise<ManagedProductAvailability> {
    validAdjustment(input);
    const existingInput = adjustmentInputs.get(input.commandId);
    if (existingInput !== undefined && !sameAdjustment(existingInput, input)) {
      throw new ManagedProductAvailabilityError(
        "PROOF_INPUT_INVALID",
        "commandId was already used for a different proof adjustment.",
      );
    }

    const state = await ensureBootstrap();
    let command = adjustmentCommands.get(input.commandId);
    if (command === undefined) {
      const current = await readBalance({
        poolId: state.poolId,
        locationId: state.locationId,
        skuId: state.inventorySkuId,
      });
      if (current.outcome !== "found") {
        throw new ManagedProductAvailabilityError(
          "INVENTORY_STATE_INVALID",
          "The stock adjustment has no current Inventory balance.",
        );
      }
      command = {
        schema: COMMAND_SCHEMA,
        commandId: input.commandId,
        type: STOCK_ADJUSTMENT_TYPE,
        context: {
          siteId: state.siteId,
          poolId: state.poolId,
          locationId: state.locationId,
        },
        payload: {
          skuId: state.inventorySkuId,
          delta: { value: input.delta, unit: MANAGED_SKU_UNIT },
        },
        reason: {
          note:
            input.reason === "proof-change"
              ? "Prove storefront stock change"
              : "Restore storefront proof stock",
        },
        references: [{ kind: "commerce.catalog-item", id: state.catalogItem.itemId }],
        expectedVersions: [
          {
            skuId: state.inventorySkuId,
            locationId: state.locationId,
            version: current.balance.version,
          },
        ],
      };
      adjustmentInputs.set(input.commandId, structuredClone(input));
      adjustmentCommands.set(input.commandId, structuredClone(command));
    }

    const result = await adjustStock(command, { principal: systemPrincipal });
    if (result.outcome !== "committed") {
      throw new ManagedProductAvailabilityError(
        "STOCK_ADJUSTMENT_REJECTED",
        `Inventory stock adjustment was rejected: ${result.code}.`,
      );
    }
    return readAvailability();
  }

  return {
    read: readAvailability,
    adjust(input) {
      const run = mutationTail.then(() => executeAdjustment(input));
      mutationTail = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

export const managedProductAvailabilityRuntime =
  createManagedProductAvailabilityRuntime();
