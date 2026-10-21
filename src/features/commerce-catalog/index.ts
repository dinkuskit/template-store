import { PluginStorageRepository } from "emdash";
import { getDb } from "emdash/runtime";
import {
  COMMERCE_PLUGIN_ID, CATALOG_COLLECTION, CATALOG_PRICES_COLLECTION,
  CATALOG_MANUAL_AVAILABILITY_COLLECTION, CATALOG_BACKORDER_POLICIES_COLLECTION,
  STORE_INVENTORY_CONFIGURATIONS_COLLECTION, STOREFRONT_AVAILABILITY_SETTINGS_COLLECTION,
  listCatalogProducts, resolveCatalogItemPrice, resolveStorefrontAvailability,
  type CatalogStorageRecord, type CatalogPriceRecord, type CatalogManualAvailabilityRecord,
  type CatalogBackorderPolicyRecord, type StoreInventoryConfigurationRecord,
  type StorefrontAvailabilitySettingsRecord,
} from "@dinkuskit/commerce";
import { readInstalledCommerceCatalog, readInstalledCommerceProducts, type InstalledCatalogContext } from "./installed.js";
import { presentStorefrontPrice, type PublicPriceView } from "../store-shell/index.js";
import type { PublicCommerceProduct } from "./types.js";

export type { PublicCommerceImage } from "./media.js";
export {
  PUBLIC_FEED_CHANNELS,
  type PublicCommerceProduct,
  type PublicCommerceVariant,
  type PublicFeedChannel,
} from "./types.js";

export const availabilityLabels: Record<string, string> = {
  "in-stock": "In stock",
  "out-of-stock": "Out of stock",
  "available-on-backorder": "Available on backorder",
  "low-stock": "Low stock",
  "availability-unavailable": "Availability unavailable",
};

export type CommerceCatalogSnapshot =
  | Readonly<{ id: string; found: false }>
  | Readonly<{
      id: string;
      found: true;
      name: string;
      sku: string;
      fulfillment: "physical" | "digital";
      price: PublicPriceView;
      availability: Readonly<{ status: string; sellable: boolean; listable: boolean }>;
    }>;

async function openCommerceCatalogStorage() {
  const db = await getDb();
  const manualAvailability = new PluginStorageRepository<CatalogManualAvailabilityRecord>(
    db,
    COMMERCE_PLUGIN_ID,
    CATALOG_MANUAL_AVAILABILITY_COLLECTION,
    [],
  );
  return {
    catalog: new PluginStorageRepository<CatalogStorageRecord>(db, COMMERCE_PLUGIN_ID, CATALOG_COLLECTION, []),
    prices: new PluginStorageRepository<CatalogPriceRecord>(db, COMMERCE_PLUGIN_ID, CATALOG_PRICES_COLLECTION, []),
    availability: manualAvailability,
    manualAvailability,
    backorderPolicies: new PluginStorageRepository<CatalogBackorderPolicyRecord>(db, COMMERCE_PLUGIN_ID, CATALOG_BACKORDER_POLICIES_COLLECTION, []),
    configurations: new PluginStorageRepository<StoreInventoryConfigurationRecord>(db, COMMERCE_PLUGIN_ID, STORE_INVENTORY_CONFIGURATIONS_COLLECTION, []),
    settings: new PluginStorageRepository<StorefrontAvailabilitySettingsRecord>(db, COMMERCE_PLUGIN_ID, STOREFRONT_AVAILABILITY_SETTINGS_COLLECTION, []),
  };
}

export async function readCommerceCatalog(context?: InstalledCatalogContext): Promise<PublicCommerceProduct[]> {
  if (process.env.DINKUS_CATALOG_PROFILE !== "native-development") {
    if (!context) throw new Error("Installed catalog context unavailable");
    return readInstalledCommerceCatalog(context);
  }
  const storage = await openCommerceCatalogStorage();
  const { products } = await listCatalogProducts(storage);
  const visible: PublicCommerceProduct[] = [];
  for (const product of products) {
    const availability = await resolveStorefrontAvailability(storage, { catalogItemId: product.catalogItemId });
    if (!availability.listable) continue;
    const price = presentStorefrontPrice(await resolveCatalogItemPrice(storage.prices, product.catalogItemId));
    if (!price.listable) continue;
    visible.push({
      id: product.catalogItemId,
      name: product.name,
      sku: product.sku,
      price,
      availability,
      image: null,
      gallery: [],
    });
  }
  return visible;
}

/** Carts up to this many lines look items up one by one; larger carts read the catalog. */
const SNAPSHOT_ITEM_LOOKUP_LIMIT = 8;

export async function readCommerceCatalogSnapshots(
  ids: readonly string[],
  context?: InstalledCatalogContext,
): Promise<CommerceCatalogSnapshot[]> {
  if (process.env.DINKUS_CATALOG_PROFILE !== "native-development") {
    if (!context) throw new Error("Installed catalog context unavailable");
    // A small cart reads just its own items; the whole catalog is several
    // sandboxed pages with an image read per product, slow enough on a real
    // store to run past the cart's time limit.
    const byId = ids.length <= SNAPSHOT_ITEM_LOOKUP_LIMIT
      ? await readInstalledCommerceProducts(ids, context)
      : new Map((await readInstalledCommerceCatalog(context)).map(product => [product.id, product]));
    return ids.map(id => {
      const product = byId.get(id);
      return product
        ? { ...product, fulfillment: product.fulfillment ?? "physical", found: true as const }
        : { id, found: false as const };
    });
  }
  const storage = await openCommerceCatalogStorage();
  const { products } = await listCatalogProducts(storage);
  const byId = new Map(products.map((product) => [product.catalogItemId, product]));
  const snapshots: CommerceCatalogSnapshot[] = [];
  for (const id of ids) {
    const product = byId.get(id);
    if (!product) {
      snapshots.push({ id, found: false });
      continue;
    }
    const availability = await resolveStorefrontAvailability(storage, {
      catalogItemId: product.catalogItemId,
    });
    const resolved = await resolveCatalogItemPrice(storage.prices, product.catalogItemId);
    const shown = presentStorefrontPrice(resolved);
    // The cart totals use the amount the shopper pays for one unit.
    const unitMinor = shown.listable ? (resolved.sale ?? resolved.regular)?.minor : undefined;
    const price = unitMinor ? { ...shown, unitMinor } : shown;
    const publicName = price.listable || availability.listable ? product.name : id;
    const publicSku = price.listable || availability.listable ? product.sku : "";
    snapshots.push({
      id,
      found: true,
      name: publicName,
      sku: publicSku,
      fulfillment: (product as unknown as { fulfillment?: "physical" | "digital" }).fulfillment ?? "physical",
      price,
      availability: {
        status: availability.status,
        sellable: availability.sellable,
        listable: availability.listable,
      },
    });
  }
  return snapshots;
}
