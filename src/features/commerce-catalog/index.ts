import { PluginStorageRepository, handleMediaGet } from "emdash";
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
import type { GuestCartPublicThumbnail } from "../guest-cart/present.js";
import { presentStorefrontPrice, type PublicPriceView } from "../store-shell/index.js";
import { readInstalledCommerceCatalog, readInstalledCommerceProducts, type InstalledCatalogContext } from "./installed.js";
import { resolveCommerceImage, type PublicCommerceImage } from "./media.js";
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
      thumbnail?: GuestCartPublicThumbnail | null;
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
  // Every store reads the installed Commerce's public catalog; the storage read below is the playground's,
  // which alone still runs the native copy (template-one-build-registry-20261031).
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
    const price = presentStorefrontPrice(await resolveCatalogItemPrice(storage.prices, product.catalogItemId, storage.catalog));
    if (!price.listable) continue;
    // The page that sells it, as Commerce's public catalog lists it (template-no-commerce-box-20261029).
    const page = (await storage.catalog.get(product.catalogItemId) as { pageId?: unknown } | null)?.pageId;
    visible.push({
      id: product.catalogItemId,
      name: product.name,
      sku: product.sku,
      price,
      availability,
      image: null,
      gallery: [],
      ...(typeof page === "string" && page ? { page } : {}),
    });
  }
  return visible;
}

/** Carts up to this many lines look items up one by one; larger carts read the catalog. */
const SNAPSHOT_ITEM_LOOKUP_LIMIT = 8;

/**
 * Resolve a cart thumbnail through the same media contract as ProductMedia.
 * No resolvable Commerce image means no thumbnail; the cart shows a neutral
 * placeholder rather than artwork guessed from the product's name or SKU.
 */
async function resolveSnapshotThumbnail(
  image: PublicCommerceImage | null,
  listable: boolean,
  context?: InstalledCatalogContext,
): Promise<GuestCartPublicThumbnail | null> {
  if (!listable || !image || !context) return null;
  const resolved = await resolveCommerceImage(image, {
    origin: new URL(context.request.url).origin,
    getPublicMediaUrl: (
      context.runtime as { getPublicMediaUrl?: (storageKey: string) => string } | null | undefined
    )?.getPublicMediaUrl,
    async getMedia(mediaId) {
      try {
        const result = await handleMediaGet(await getDb(), mediaId);
        const item = result.success ? result.data?.item : null;
        if (!item?.storageKey || !item.mimeType) return null;
        return { mimeType: item.mimeType, storageKey: item.storageKey, status: item.status };
      } catch {
        return null;
      }
    },
  });
  return resolved ? { src: resolved.src, alt: resolved.alt } : null;
}

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
    return Promise.all(ids.map(async (id): Promise<CommerceCatalogSnapshot> => {
      const product = byId.get(id);
      if (!product) return { id, found: false as const };
      const listable = product.price.listable || product.availability.listable;
      const publicName = listable ? product.name : id;
      const publicSku = listable ? product.sku : "";
      const thumbnail = await resolveSnapshotThumbnail(product.image, listable, context);
      return {
        ...product,
        name: publicName,
        sku: publicSku,
        fulfillment: product.fulfillment ?? "physical",
        thumbnail,
        found: true as const,
      };
    }));
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
    const resolved = await resolveCatalogItemPrice(storage.prices, product.catalogItemId, storage.catalog);
    const shown = presentStorefrontPrice(resolved);
    // The cart totals use the amount the shopper pays for one unit.
    const unitMinor = shown.listable ? (resolved.sale ?? resolved.regular)?.minor : undefined;
    const price = unitMinor ? { ...shown, unitMinor } : shown;
    const listable = price.listable || availability.listable;
    const publicName = listable ? product.name : id;
    const publicSku = listable ? product.sku : "";
    snapshots.push({
      id,
      found: true,
      name: publicName,
      sku: publicSku,
      fulfillment: (product as unknown as { fulfillment?: "physical" | "digital" }).fulfillment ?? "physical",
      thumbnail: null,
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
