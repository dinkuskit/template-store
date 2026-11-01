/**
 * Playground-only setup of each visitor's store. The playground runs Commerce's Registry build, the one build
 * Commerce keeps (template-one-build-registry-20261031), inside the visitor's store beside Payments and Ship
 * (playground-plugins-in-store-20261023), so everything Commerce holds is set up through Commerce itself:
 *
 * - its storage indexes, which EmDash builds only on a scheduler tick a visitor's database never gets;
 * - the store's merchant settings (United States, as a real store's owner would choose);
 * - the demo catalog through Commerce's own private routes, as the proof store's seed does;
 * - Commerce connected to the pretend DinkusKit through its own Settings buttons, so checkout is set up
 *   before the visitor's first click (playground-pretend-connected-20261022);
 * - the playground's own pages and the two sample orders.
 *
 * Create-only-if-missing throughout: nothing here changes what the visitor has edited.
 */
import { createSettingsAccess, OptionsRepository, PluginStorageRepository } from "emdash";
import { applySeed, type SeedFile } from "emdash/seed";
import { sql } from "kysely";
import { loadMerchantStoreSettings, saveMerchantStoreSettings } from "@dinkuskit/commerce";

import { DEMO_PRODUCTS } from "../../../scripts/demo-seed-policy.js";
import { PLAYGROUND_INSTALLED_PLUGIN_IDS } from "../playground-plugins/registry-plugins.mjs";
import { ensurePlaygroundSampleOrders } from "./demo-orders.js";
import { callCommerceRoute, ensureDemoCatalogThroughCommerce, type CommerceSeedRuntime } from "./demo-registry-seed.js";
import { PLAYGROUND_TOUR_PAGE_ENTRY } from "../playground-tour/copy.js";

type Db = ConstructorParameters<typeof PluginStorageRepository>[0];
interface StorageDeclaration {
  indexes?: Array<string | string[]>;
  uniqueIndexes?: Array<string | string[]>;
}

/** The installed Commerce's storage declarations, from its Registry manifest (the playground config defines them). */
declare const __PLAYGROUND_COMMERCE_STORAGE__: Record<string, StorageDeclaration> | undefined;
const commerceStorage = (): Record<string, StorageDeclaration> =>
  typeof __PLAYGROUND_COMMERCE_STORAGE__ === "undefined" ? {} : __PLAYGROUND_COMMERCE_STORAGE__;

/** The id the playground installs Commerce under: its Registry runtime id. */
export const PLAYGROUND_COMMERCE_ID: string = PLAYGROUND_INSTALLED_PLUGIN_IDS.commerce;

const SAFE = /^[A-Za-z0-9_-]+$/;

/**
 * EmDash only materializes plugin storage indexes from the scheduler tick
 * (EmDashRuntime.syncPluginStorageIndexesOnce), which never runs against a
 * per-visitor playground Durable Object. Commerce refuses catalog writes until
 * its unique indexes are proven, so create the declared indexes here using
 * EmDash's naming and SQLite expression form (playground DBs are SQLite).
 */
export async function ensureCommerceStorageIndexes(
  db: Db,
  pluginId: string = PLAYGROUND_COMMERCE_ID,
  declarations: Record<string, StorageDeclaration> = commerceStorage(),
): Promise<void> {
  for (const [collection, declaration] of Object.entries(declarations)) {
    const norm = (list: Array<string | string[]> | undefined) => (list ?? []).map((i) => (Array.isArray(i) ? i : [i]));
    const unique = norm(declaration.uniqueIndexes);
    const uniqueKeys = new Set(unique.map((f) => f.join(",")));
    const entries = [
      ...norm(declaration.indexes).filter((f) => !uniqueKeys.has(f.join(","))).map((fields) => ({ fields, unique: false })),
      ...unique.map((fields) => ({ fields, unique: true })),
    ];
    for (const { fields, unique: isUnique } of entries) {
      if (![pluginId, collection, ...fields].every((part) => SAFE.test(part))) {
        throw new Error(`Unsafe Commerce storage index declaration for ${collection}`);
      }
      const name = `${isUnique ? "uidx" : "idx"}_plugin_${pluginId}_${collection}_${fields.join("_")}`.substring(0, 128);
      const expressions = fields.map((field) => `json_extract(data, '$.${field}')`).join(", ");
      await sql`${sql.raw(isUnique ? "CREATE UNIQUE INDEX" : "CREATE INDEX")} IF NOT EXISTS ${sql.ref(name)}
        ON _plugin_storage(plugin_id, collection, ${sql.raw(expressions)})`.execute(db);
      await db.insertInto("_plugin_indexes" as never).values({
        plugin_id: pluginId, collection, index_name: name, fields: JSON.stringify(fields),
      } as never).onConflict((oc) => oc.columns(["plugin_id", "collection", "index_name"] as never).doNothing()).execute();
    }
  }
}

const paragraph = (key: string, text: string) => ({
  _type: "block", _key: key, style: "normal", markDefs: [],
  children: [{ _type: "span", _key: `${key}-text`, text, marks: [] }],
});

/** The page Connect opens in the playground (GrillTrack playground-pretend-connected-20261022). */
export const PLAYGROUND_CONNECT_PAGE_ENTRY = {
  id: "connect-to-dinkuskit",
  slug: "connect-to-dinkuskit",
  status: "published",
  data: {
    title: "Connect to DinkusKit",
    content: [
      paragraph("connect-real", "On a real store, pressing Connect takes you to DinkusKit.com. You sign in, check the store's address and press Approve once, and the plugin is connected for good."),
      paragraph("connect-pretend", "This is the playground, so that step is pretend: it's approved already. Go back and Payments shows Stripe test mode ready, and Shipping lists your orders so you can make practice labels."),
      paragraph("connect-reset", "Nothing here reaches DinkusKit.com or costs anything, and it all resets when your playground session ends."),
    ],
  },
};

/** Every demo product, including the color and size hoodie. */
export const PLAYGROUND_DEMO_PRODUCTS = DEMO_PRODUCTS;

/** The store's merchant settings, saved once: a later pass never replaces what the visitor saved. */
async function ensureMerchantSettings(db: Db): Promise<void> {
  const settings = createSettingsAccess(new OptionsRepository(db), PLAYGROUND_COMMERCE_ID);
  const current = await loadMerchantStoreSettings(settings);
  if (current.revision !== null) return;
  await saveMerchantStoreSettings(settings, {
    expectedRevision: current.revision,
    storeCountry: "US",
    shippingCountries: ["US"],
    requirePhoneNumber: false,
  });
}

type ConnectView = { blocks?: { type?: string; text?: string }[] };
const isConnected = (view: ConnectView) =>
  (view.blocks ?? []).some((block) => block.type === "context" && /^Connected to DinkusKit\.com/u.test(block.text ?? ""));

/**
 * Commerce connected to the pretend DinkusKit, through the same Settings buttons an owner presses: Connect,
 * then Check, which finds the pretend Approve done and fetches the playground's checkout settings. Commerce
 * connects only on an https store, as on a real one; elsewhere the store stays unconnected and checkout closed.
 */
async function ensureCommerceConnected(runtime: CommerceSeedRuntime, origin: string): Promise<boolean> {
  const press = (action_id: string) => callCommerceRoute<ConnectView>(runtime, PLAYGROUND_COMMERCE_ID, origin, "admin",
    { type: "block_action", action_id, page: "/settings" });
  if (isConnected(await callCommerceRoute<ConnectView>(runtime, PLAYGROUND_COMMERCE_ID, origin, "admin", { type: "page_load", page: "/settings" }))) {
    return true;
  }
  if (!origin.startsWith("https://")) return false;
  await press("connect");
  return isConnected(await press("connect.check"));
}

/**
 * Sets up a visitor's store, create-only-if-missing. Needs EmDash's full runtime (a visitor's requests are an
 * Administrator's), since Commerce is set up through its own private routes.
 */
export async function ensurePlaygroundDemoCatalog(
  db: Db,
  options: { runtime: CommerceSeedRuntime; origin: string },
): Promise<{ created: string[]; connected: boolean }> {
  await ensureCommerceStorageIndexes(db);
  await ensureMerchantSettings(db);
  const { created } = await ensureDemoCatalogThroughCommerce(options.runtime, PLAYGROUND_COMMERCE_ID, options.origin);
  const connected = await ensureCommerceConnected(options.runtime, options.origin);
  await applySeed(db as Parameters<typeof applySeed>[0], { version: "1", content: { pages: [PLAYGROUND_CONNECT_PAGE_ENTRY, PLAYGROUND_TOUR_PAGE_ENTRY] } } as SeedFile, {
    includeContent: true, onConflict: "skip", skipMediaDownload: true,
  });
  // Sizes are catalog items of their own, so read every item's SKU, not just listed products.
  const catalog = new PluginStorageRepository<{ itemId: string; sku: string }>(db, PLAYGROUND_COMMERCE_ID, "catalog_items", []);
  const skus = new Map<string, string>();
  let cursor: string | undefined;
  do {
    const page = await catalog.query({ limit: 100, ...(cursor ? { cursor } : {}) });
    for (const row of page.items) if (row.data.sku) skus.set(row.data.sku.toUpperCase(), row.data.itemId);
    cursor = page.cursor;
  } while (cursor);
  await ensurePlaygroundSampleOrders(db, skus);
  return { created, connected };
}

export { PLAYGROUND_FLAT_RATE_SHIPPING } from "./flat-rate-shipping.js";
