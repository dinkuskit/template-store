import {
  addCatalogVariantOption,
  createCatalogItem,
  createPlugin,
  listCatalogProducts,
  setCatalogItemManualAvailability,
  saveCatalogItemMedia,
  setCatalogItemRegularPrice,
  setCatalogItemSalePrice,
  clearCatalogItemSalePrice,
  CATALOG_COLLECTION,
  CATALOG_MEDIA_COLLECTION,
  CATALOG_MANUAL_AVAILABILITY_COLLECTION,
  CATALOG_PRICES_COLLECTION,
  COMMERCE_PLUGIN_ID,
  type CatalogManualAvailabilityRecord,
  type CatalogMediaRecord,
  type CatalogPriceRecord,
  type CatalogStorageRecord,
} from "@dinkuskit/commerce";
import { PluginStorageRepository } from "emdash";
import { applySeed, type SeedFile } from "emdash/seed";
import { DEMO_PRODUCTS } from "../../../scripts/demo-seed-policy.js";
import { buildDemoProductEntries } from "../../../scripts/demo-product-entries.js";
import { PLAYGROUND_PRODUCT_SEED } from "./products.js";

type PlaygroundDb = Parameters<typeof applySeed>[0];

function repository<T>(db: PlaygroundDb, collection: string, declaration: unknown): PluginStorageRepository<T> {
  const indexes = (declaration as { indexes?: Array<string | string[]>; uniqueIndexes?: Array<string | string[]> } | undefined);
  return new PluginStorageRepository<T>(
    db,
    COMMERCE_PLUGIN_ID,
    collection,
    [...(indexes?.indexes ?? []), ...(indexes?.uniqueIndexes ?? [])],
  );
}

export async function seedPlaygroundCommerce(db: PlaygroundDb): Promise<void> {
  const plugin = createPlugin();
  const storageMap = plugin.storage as Record<string, unknown>;
  const catalog = repository<CatalogStorageRecord>(db, CATALOG_COLLECTION, storageMap[CATALOG_COLLECTION]);
  const prices = repository<CatalogPriceRecord>(db, CATALOG_PRICES_COLLECTION, storageMap[CATALOG_PRICES_COLLECTION]);
  const availability = repository<CatalogManualAvailabilityRecord>(
    db,
    CATALOG_MANUAL_AVAILABILITY_COLLECTION,
    storageMap[CATALOG_MANUAL_AVAILABILITY_COLLECTION],
  );
  const media = repository<CatalogMediaRecord>(db, CATALOG_MEDIA_COLLECTION, storageMap[CATALOG_MEDIA_COLLECTION]);

  for (const product of DEMO_PRODUCTS) {
    const existing = (await listCatalogProducts({ catalog, prices, availability })).products.find((item) => item.sku === product.sku);
    const created = existing
      ? { item: { itemId: existing.catalogItemId } }
      : await createCatalogItem(catalog, {
        commandId: product.commandId,
        manageStock: false,
        name: product.name,
        sku: product.sku,
      });
    const catalogItemId = created.item.itemId;
    const variant = product.variant;
    if (variant) {
      await addCatalogVariantOption(
        { catalog },
        {
          productId: catalogItemId,
          optionId: variant.optionId,
          optionLabel: variant.optionLabel,
          values: variant.values.map((value, index) => ({
            valueId: value.valueId,
            label: value.label,
            member: index === 0
              ? { catalogItemId, fulfillment: "physical" as const }
              : { commandId: value.commandId, name: value.name, sku: value.sku, fulfillment: "physical" as const },
          })),
        },
        { collection: CATALOG_COLLECTION, pluginId: COMMERCE_PLUGIN_ID },
      );
    }
    const current = await catalog.get(catalogItemId);
    const itemIds = [catalogItemId, ...((current as { variantProduct?: { members?: Array<{ catalogItemId: string }> } } | null)?.variantProduct?.members?.map((member) => member.catalogItemId) ?? []).filter((id) => id !== catalogItemId)];
    for (const itemId of itemIds) {
      await setCatalogItemRegularPrice({ catalog, prices }, { catalogItemId: itemId, amount: { currency: "USD", minor: product.regularMinor } });
      if (product.saleMinor) {
        await setCatalogItemSalePrice({ catalog, prices }, { catalogItemId: itemId, amount: { currency: "USD", minor: product.saleMinor } });
      } else {
        await clearCatalogItemSalePrice({ catalog, prices }, { catalogItemId: itemId });
      }
      await setCatalogItemManualAvailability({ catalog, availability }, { catalogItemId: itemId, status: product.availability });
      if (product.gallery) {
        await saveCatalogItemMedia(
          { catalog, media },
          { catalogItemId: itemId, gallery: product.gallery },
        );
      }
    }
  }

  const listed = await listCatalogProducts({ catalog, prices, availability });
  const links = listed.products.map((product) => ({ sku: product.sku, catalogItemId: product.catalogItemId }));
  const entries = buildDemoProductEntries("playground", links);
  const seed: SeedFile = {
    ...PLAYGROUND_PRODUCT_SEED,
    content: {
      ...PLAYGROUND_PRODUCT_SEED.content,
      products: entries,
    },
  };
  await applySeed(db, seed, { includeContent: true, onConflict: "skip", skipMediaDownload: true });
}
