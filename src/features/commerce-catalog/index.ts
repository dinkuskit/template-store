import { PluginStorageRepository } from "emdash";
import { getDb } from "emdash/runtime";
import {
  COMMERCE_PLUGIN_ID, CATALOG_COLLECTION, CATALOG_PRICES_COLLECTION,
  CATALOG_MANUAL_AVAILABILITY_COLLECTION, CATALOG_BACKORDER_POLICIES_COLLECTION,
  STORE_INVENTORY_CONFIGURATIONS_COLLECTION, STOREFRONT_AVAILABILITY_SETTINGS_COLLECTION,
  listCatalogProducts, resolveCatalogItemPrice, resolveStorefrontAvailability,
  type CatalogStorageRecord, type CatalogPriceRecord, type CatalogManualAvailabilityRecord,
  type CatalogBackorderPolicyRecord, type StoreInventoryConfigurationRecord,
  type StorefrontAvailabilitySettingsRecord, type StorefrontAvailabilityResult,
} from "@dinkuskit/commerce";
import { presentStorefrontPrice, type PublicPriceView } from "../store-shell/index.js";

export interface PublicCommerceProduct {
  id: string;
  name: string;
  sku: string;
  price: PublicPriceView;
  availability: StorefrontAvailabilityResult;
}

export function commerceProductPath(id: string): string {
  return `/shop/${encodeURIComponent(id)}`;
}

export const availabilityLabels: Record<string, string> = {
  "in-stock": "In stock",
  "out-of-stock": "Out of stock",
  "available-on-backorder": "Available on backorder",
  "low-stock": "Low stock",
  "availability-unavailable": "Availability unavailable",
};

export async function readCommerceCatalog(): Promise<PublicCommerceProduct[]> {
  const db = await getDb();
  const storage = {
    catalog: new PluginStorageRepository<CatalogStorageRecord>(db, COMMERCE_PLUGIN_ID, CATALOG_COLLECTION, []),
    prices: new PluginStorageRepository<CatalogPriceRecord>(db, COMMERCE_PLUGIN_ID, CATALOG_PRICES_COLLECTION, []),
    manualAvailability: new PluginStorageRepository<CatalogManualAvailabilityRecord>(db, COMMERCE_PLUGIN_ID, CATALOG_MANUAL_AVAILABILITY_COLLECTION, []),
    backorderPolicies: new PluginStorageRepository<CatalogBackorderPolicyRecord>(db, COMMERCE_PLUGIN_ID, CATALOG_BACKORDER_POLICIES_COLLECTION, []),
    configurations: new PluginStorageRepository<StoreInventoryConfigurationRecord>(db, COMMERCE_PLUGIN_ID, STORE_INVENTORY_CONFIGURATIONS_COLLECTION, []),
    settings: new PluginStorageRepository<StorefrontAvailabilitySettingsRecord>(db, COMMERCE_PLUGIN_ID, STOREFRONT_AVAILABILITY_SETTINGS_COLLECTION, []),
  };
  const { products } = await listCatalogProducts(storage);
  const visible: PublicCommerceProduct[] = [];
  for (const product of products) {
    const availability = await resolveStorefrontAvailability(storage, { catalogItemId: product.catalogItemId });
    if (!availability.listable) continue;
    const price = presentStorefrontPrice(await resolveCatalogItemPrice(storage.prices, product.catalogItemId));
    if (!price.listable) continue;
    visible.push({ id: product.catalogItemId, name: product.name, sku: product.sku, price, availability });
  }
  return visible;
}
