/**
 * Playground-only Commerce catalog seed.
 *
 * EmDash's playground middleware applies seed/seed.json to each per-visitor
 * Durable Object database, but that seed only covers CMS content. Commerce
 * catalog items live in plugin storage, so a fresh playground DB had none and
 * the storefront fell back to "The catalog is unavailable right now." This
 * creates the simple synthetic demo items from `pnpm seed:demo`, create-only-
 * if-missing (keyed by SKU), and never touches checkout configuration.
 */
import {
  addCatalogVariantOption,
  createCatalogItem,
  createPlugin,
  listCatalogProducts,
  setCatalogItemManualAvailability,
  setCatalogItemRegularPrice,
  setCatalogItemSalePrice,
  CATALOG_COLLECTION,
  CATALOG_MANUAL_AVAILABILITY_COLLECTION,
  CATALOG_PRICES_COLLECTION,
  COMMERCE_PLUGIN_ID,
  loadMerchantStoreSettings,
  saveMerchantStoreSettings,
  type CatalogManualAvailabilityRecord,
  type CatalogPriceRecord,
  type CatalogStorageRecord,
} from "@dinkuskit/commerce";
import { createSettingsAccess, OptionsRepository, PluginStorageRepository } from "emdash";
import { applySeed, type SeedFile } from "emdash/seed";
import { sql } from "kysely";

import { DEMO_PRODUCTS, demoRegularMinorForSku, type DemoProductSeed } from "../../../scripts/demo-seed-policy.js";
import { buildDemoProductEntries } from "./demo-products.js";

type Db = ConstructorParameters<typeof PluginStorageRepository>[0];
interface StorageDeclaration {
  indexes?: Array<string | string[]>;
  uniqueIndexes?: Array<string | string[]>;
}

function repository<T>(db: Db, collection: string, declaration: StorageDeclaration | undefined) {
  return new PluginStorageRepository<T>(db, COMMERCE_PLUGIN_ID, collection, [
    ...(declaration?.indexes ?? []),
    ...(declaration?.uniqueIndexes ?? []),
  ]);
}

export function playgroundCommerceStorage(db: Db) {
  const declarations = createPlugin().storage as Record<string, StorageDeclaration> | undefined;
  return {
    catalog: repository<CatalogStorageRecord>(db, CATALOG_COLLECTION, declarations?.[CATALOG_COLLECTION]),
    prices: repository<CatalogPriceRecord>(db, CATALOG_PRICES_COLLECTION, declarations?.[CATALOG_PRICES_COLLECTION]),
    availability: repository<CatalogManualAvailabilityRecord>(
      db, CATALOG_MANUAL_AVAILABILITY_COLLECTION, declarations?.[CATALOG_MANUAL_AVAILABILITY_COLLECTION],
    ),
  };
}

const SAFE = /^[A-Za-z0-9_-]+$/;

/**
 * EmDash only materializes plugin storage indexes from the scheduler tick
 * (EmDashRuntime.syncPluginStorageIndexesOnce), which never runs against a
 * per-visitor playground Durable Object. Commerce refuses catalog writes until
 * its unique indexes are proven, so create the declared indexes here using
 * EmDash's naming and SQLite expression form (playground DBs are SQLite).
 */
export async function ensureCommerceStorageIndexes(db: Db): Promise<void> {
  const declarations = (createPlugin().storage ?? {}) as Record<string, StorageDeclaration>;
  for (const [collection, declaration] of Object.entries(declarations)) {
    const norm = (list: Array<string | string[]> | undefined) => (list ?? []).map((i) => (Array.isArray(i) ? i : [i]));
    const unique = norm(declaration.uniqueIndexes);
    const uniqueKeys = new Set(unique.map((f) => f.join(",")));
    const entries = [
      ...norm(declaration.indexes).filter((f) => !uniqueKeys.has(f.join(","))).map((fields) => ({ fields, unique: false })),
      ...unique.map((fields) => ({ fields, unique: true })),
    ];
    for (const { fields, unique: isUnique } of entries) {
      if (![COMMERCE_PLUGIN_ID, collection, ...fields].every((part) => SAFE.test(part))) {
        throw new Error(`Unsafe Commerce storage index declaration for ${collection}`);
      }
      const name = `${isUnique ? "uidx" : "idx"}_plugin_${COMMERCE_PLUGIN_ID}_${collection}_${fields.join("_")}`.substring(0, 128);
      const expressions = fields.map((field) => `json_extract(data, '$.${field}')`).join(", ");
      await sql`${sql.raw(isUnique ? "CREATE UNIQUE INDEX" : "CREATE INDEX")} IF NOT EXISTS ${sql.ref(name)}
        ON _plugin_storage(plugin_id, collection, ${sql.raw(expressions)})`.execute(db);
      await db.insertInto("_plugin_indexes" as never).values({
        plugin_id: COMMERCE_PLUGIN_ID, collection, index_name: name, fields: JSON.stringify(fields),
      } as never).onConflict((oc) => oc.columns(["plugin_id", "collection", "index_name"] as never).doNothing()).execute();
    }
  }
}

type Storage = ReturnType<typeof playgroundCommerceStorage>;

async function createProduct(storage: Storage, product: DemoProductSeed): Promise<void> {
  const variant = product.variant;
  const created = await createCatalogItem(storage.catalog, {
    commandId: product.commandId,
    manageStock: false,
    ...(variant ? { fulfillment: "physical" as const } : {}),
    name: product.name,
    sku: product.sku,
  });
  const parentId = created.item.itemId;
  const items = [{ catalogItemId: parentId, sku: product.sku }];
  if (variant) {
    await addCatalogVariantOption({ catalog: storage.catalog }, {
      productId: parentId,
      optionId: variant.optionId,
      optionLabel: variant.optionLabel,
      values: variant.values.map((value, index) => ({
        valueId: value.valueId,
        label: value.label,
        member: index === 0
          ? { catalogItemId: parentId, fulfillment: "physical" as const }
          : { commandId: value.commandId, name: value.name, sku: value.sku, fulfillment: "physical" as const },
      })),
    }, { collection: CATALOG_COLLECTION, pluginId: COMMERCE_PLUGIN_ID });
    const parent = await storage.catalog.get(parentId) as { variantProduct?: { members: { catalogItemId: string }[] } } | null;
    for (const member of parent?.variantProduct?.members ?? []) {
      if (member.catalogItemId === parentId) continue;
      const record = await storage.catalog.get(member.catalogItemId);
      items.push({ catalogItemId: member.catalogItemId, sku: record?.sku ?? product.sku });
    }
  }
  for (const { catalogItemId, sku } of items) {
    await setCatalogItemRegularPrice(storage, {
      catalogItemId, amount: { currency: "USD", minor: demoRegularMinorForSku(product, sku) },
    });
    if (product.saleMinor !== null) {
      await setCatalogItemSalePrice(storage, { catalogItemId, amount: { currency: "USD", minor: product.saleMinor } });
    }
    await setCatalogItemManualAvailability(storage, { catalogItemId, status: product.availability });
  }
}

/** Every demo product, including the size-variant hoodie. */
export const PLAYGROUND_DEMO_PRODUCTS = DEMO_PRODUCTS;

/** Creates missing demo catalog items and product entries. Existing SKUs and entries are left untouched. */
export async function ensurePlaygroundDemoCatalog(db: Db): Promise<{ created: string[] }> {
  await ensureCommerceStorageIndexes(db);
  const settings = createSettingsAccess(new OptionsRepository(db), COMMERCE_PLUGIN_ID);
  const currentSettings = await loadMerchantStoreSettings(settings);
  if (currentSettings.settings.shippingCountries.length === 0) {
    await saveMerchantStoreSettings(settings, {
      expectedRevision: currentSettings.revision,
      storeCountry: "US",
      sellingCountries: ["US"],
      shippingCountries: ["US"],
      requirePhoneNumber: false,
    });
  }
  const storage = playgroundCommerceStorage(db);
  const existing = new Set((await listCatalogProducts(storage)).products.map((p) => p.sku.toUpperCase()));
  const created: string[] = [];
  for (const product of PLAYGROUND_DEMO_PRODUCTS) {
    if (existing.has(product.sku.toUpperCase())) continue;
    await createProduct(storage, product);
    created.push(product.sku);
  }
  // Link each demo Commerce item to a published EmDash product page.
  // onConflict "skip" never changes or republishes an existing entry.
  const links = (await listCatalogProducts(storage)).products
    .map((p) => ({ sku: p.sku, catalogItemId: p.catalogItemId }));
  const entries = buildDemoProductEntries(links);
  if (entries.length > 0) {
    await applySeed(db as Parameters<typeof applySeed>[0], { version: "1", content: { products: entries } } as SeedFile, {
      includeContent: true, onConflict: "skip", skipMediaDownload: true,
    });
  }
  return { created };
}

export { PLAYGROUND_FLAT_RATE_SHIPPING } from "./flat-rate-shipping.js";
