import { PluginStorageRepository } from "emdash";
import { getDb } from "emdash/runtime";
import {
  COMMERCE_PLUGIN_ID, CATALOG_COLLECTION, CATALOG_PRICES_COLLECTION,
  CATALOG_MEDIA_COLLECTION,
  CATALOG_MANUAL_AVAILABILITY_COLLECTION, CATALOG_BACKORDER_POLICIES_COLLECTION,
  STORE_INVENTORY_CONFIGURATIONS_COLLECTION, STOREFRONT_AVAILABILITY_SETTINGS_COLLECTION,
  listCatalogProducts, resolveCatalogItemPrice, resolveStorefrontAvailability,
  type CatalogStorageRecord, type CatalogPriceRecord, type CatalogManualAvailabilityRecord,
  type CatalogMediaRecord,
  type CatalogBackorderPolicyRecord, type StoreInventoryConfigurationRecord,
  type StorefrontAvailabilitySettingsRecord, type StorefrontAvailabilityResult,
} from "@dinkuskit/commerce";
import { readInstalledCommerceCatalog, type InstalledCatalogContext } from "./installed.js";
import type { PublicCommerceImage } from "./media.js";
import { presentStorefrontPrice, type PublicPriceView } from "../store-shell/index.js";

export type { PublicCommerceImage } from "./media.js";

export interface PublicCommerceProduct {
  id: string;
  name: string;
  sku: string;
  fulfillment?: "physical" | "digital";
  price: PublicPriceView;
  availability: Pick<StorefrontAvailabilityResult, "status" | "sellable" | "listable">;
  image: PublicCommerceImage | null;
  gallery: readonly PublicCommerceImage[];
  variants?: CommerceProductVariants;
}

export interface CommerceProductVariants {
  schema: "dinkuskit.commerce.product-variants/v1";
  productId: string;
  options: readonly {
    optionId: string;
    label: string;
    values: readonly { valueId: string; label: string }[];
  }[];
  members: readonly {
    catalogItemId: string;
    selections: readonly {
      optionId: string;
      optionLabel: string;
      valueId: string;
      valueLabel: string;
    }[];
    price: PublicPriceView;
    availability: Readonly<Pick<StorefrontAvailabilityResult, "status" | "sellable" | "listable">>;
    fulfillment: "physical" | "digital";
  }[];
}

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
      image: PublicCommerceImage | null;
      gallery: readonly PublicCommerceImage[];
      variants?: CommerceProductVariants;
      price: PublicPriceView;
      availability: Readonly<Pick<StorefrontAvailabilityResult, "status" | "sellable" | "listable">>;
    }>;

async function nativeVariants(
  variant: NonNullable<Awaited<ReturnType<typeof listCatalogProducts>>["products"][number]["variantProduct"]>,
): Promise<CommerceProductVariants> {
  return {
    schema: "dinkuskit.commerce.product-variants/v1",
    productId: variant.productId,
    options: variant.options,
    members: variant.members.map((member) => ({
      catalogItemId: member.catalogItemId,
      selections: member.selections,
      price: {
        listable: member.regular !== null,
        regularText: member.regular,
        saleText: member.sale,
      },
      availability: {
        status: member.stockStatus === "on-backorder" ? "available-on-backorder" : member.stockStatus ?? "availability-unavailable",
        sellable: member.stockStatus !== "out-of-stock",
        listable: member.stockStatus !== null,
      },
      fulfillment: member.fulfillment,
    })),
  };
}

async function nativeGallery(
  storage: Awaited<ReturnType<typeof openCommerceCatalogStorage>>,
  itemId: string,
  name: string,
): Promise<PublicCommerceImage[]> {
  const record = await storage.media.get(itemId) as CatalogMediaRecord | null;
  if (!record || !Array.isArray(record.gallery)) return [];
  return record.gallery.flatMap((entry) => {
    const id = entry?.mediaId;
    return typeof id === "string" ? [{ id, alt: name, width: null, height: null, placeholder: false }] : [];
  });
}

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
    media: new PluginStorageRepository<CatalogMediaRecord>(db, COMMERCE_PLUGIN_ID, CATALOG_MEDIA_COLLECTION, []),
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
      gallery: await nativeGallery(storage, product.catalogItemId, product.name),
      ...(product.variantProduct ? { variants: await nativeVariants(product.variantProduct) } : {}),
    });
  }
  return visible;
}

export async function readCommerceCatalogSnapshots(
  ids: readonly string[],
  context?: InstalledCatalogContext,
): Promise<CommerceCatalogSnapshot[]> {
  if (process.env.DINKUS_CATALOG_PROFILE !== "native-development") {
    if (!context) throw new Error("Installed catalog context unavailable");
    const products = await readInstalledCommerceCatalog(context);
    const byId = new Map(products.map(product => [product.id, product]));
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
    const price = presentStorefrontPrice(
      await resolveCatalogItemPrice(storage.prices, product.catalogItemId),
    );
    const publicName = price.listable || availability.listable ? product.name : id;
    const publicSku = price.listable || availability.listable ? product.sku : "";
    snapshots.push({
      id,
      found: true,
      name: publicName,
      sku: publicSku,
      fulfillment: (product as unknown as { fulfillment?: "physical" | "digital" }).fulfillment ?? "physical",
      image: null,
      gallery: await nativeGallery(storage, product.catalogItemId, product.name),
      price,
      availability: {
        status: availability.status,
        sellable: availability.sellable,
        listable: availability.listable,
      },
      ...(product.variantProduct ? { variants: await nativeVariants(product.variantProduct) } : {}),
    });
  }
  return snapshots;
}
