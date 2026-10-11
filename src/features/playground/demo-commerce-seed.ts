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
  type CatalogManualAvailabilityRecord,
  type CatalogPriceRecord,
  type CatalogStorageRecord,
} from "@dinkuskit/commerce";
import { PluginStorageRepository } from "emdash";
import { sql } from "kysely";

import { DEMO_PRODUCTS, type DemoProductSeed } from "../../../scripts/demo-seed-policy.js";

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
  const created = await createCatalogItem(storage.catalog, {
    commandId: product.commandId,
    manageStock: false,
    name: product.name,
    sku: product.sku,
  });
  const catalogItemId = created.item.itemId;
  await setCatalogItemRegularPrice(storage, { catalogItemId, amount: { currency: "USD", minor: product.regularMinor } });
  if (product.saleMinor !== null) {
    await setCatalogItemSalePrice(storage, { catalogItemId, amount: { currency: "USD", minor: product.saleMinor } });
  }
  await setCatalogItemManualAvailability(storage, { catalogItemId, status: product.availability });
}

/**
 * Simple (non-variant) demo products. Commerce projects a variant parent
 * without a top-level price, which the storefront's installed-catalog reader
 * rejects as a whole ("Invalid installed catalog projection"), so the
 * playground leaves variant demo products out.
 */
export const PLAYGROUND_DEMO_PRODUCTS = DEMO_PRODUCTS.filter((product) => !product.variant);

/** Creates missing demo catalog items. Existing SKUs are left untouched. */
export async function ensurePlaygroundDemoCatalog(db: Db): Promise<{ created: string[] }> {
  await ensureCommerceStorageIndexes(db);
  const storage = playgroundCommerceStorage(db);
  const existing = new Set((await listCatalogProducts(storage)).products.map((p) => p.sku.toUpperCase()));
  const created: string[] = [];
  for (const product of PLAYGROUND_DEMO_PRODUCTS) {
    if (existing.has(product.sku.toUpperCase())) continue;
    await createProduct(storage, product);
    created.push(product.sku);
  }
  return { created };
}
