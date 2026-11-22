/**
 * Fresh and existing visitor databases: a real EmDash-migrated SQLite database
 * seeded the way the playground middleware seeds it. The visitor's Commerce is its Registry build
 * (template-one-build-registry-20261031); a stand-in for EmDash's runtime answers its routes as an
 * already-seeded, already-connected store, since the catalog and Connect themselves are proved against the
 * real build by the playground's local and preview runs and the proof store's browser tests. The merchant settings
 * bootstrap runs only for a fresh store, saved settings survive repeat seeding
 * (an isolate restart), and checkout bindings persisted in an existing database
 * stay readable and authoritative after re-seeding.
 */
import { ContentRepository, createSettingsAccess, OptionsRepository, PluginStorageRepository } from "emdash";
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ORDERS_COLLECTION,
  loadMerchantStoreSettings,
  saveMerchantStoreSettings,
  type OrderRecord,
} from "@dinkuskit/commerce";
import { applySeed } from "emdash/seed";
import { readFileSync } from "node:fs";
import { ensurePlaygroundDemoCatalog, PLAYGROUND_COMMERCE_ID } from "../../src/features/playground/demo-commerce-seed.js";
import { DEMO_PRODUCTS } from "../../scripts/demo-seed-policy.js";
import { PLAYGROUND_SAMPLE_ORDER_IDS } from "../../src/features/playground/demo-orders.js";
import { newlyDoneSteps, readTourState, recordShopVisit, tourSteps, visitorOrderCount } from "../../src/features/playground-tour/state.js";
import { playgroundDinkusKitFetch } from "../../src/features/playground-plugins/dinkuskit-stand-in.js";
import { runWithContext } from "emdash/request-context";
import { playgroundCheckoutBindingStore } from "../../src/features/playground-checkout/binding-store.js";
import { playgroundAttemptBelongsToVisitor } from "../../src/features/playground-checkout/binding-auth.js";

let db: Kysely<never>;
async function visitorDb(): Promise<Kysely<never>> {
  const visitor = new Kysely<never>({ dialect: createDialect({ url: ":memory:" }) });
  await runMigrations(visitor as never);
  // The playground's own seed (schema only), as every visitor database gets it.
  const seed = JSON.parse(readFileSync(new URL("../../seed/seed.json", import.meta.url), "utf8"));
  await applySeed(visitor as never, seed, { includeContent: false, onConflict: "skip", skipMediaDownload: true });
  return visitor;
}
beforeEach(async () => { db = await visitorDb(); });

const COMMERCE_PLUGIN_ID = PLAYGROUND_COMMERCE_ID;
/** EmDash's runtime as the seed sees it: Commerce answers as a store whose demo catalog exists and that is connected. */
const seededRuntime = (target: Kysely<never>) => ({
  db: target,
  getPluginRouteMeta: () => ({ public: false }),
  async handlePluginApiRoute(_pluginId: string, _method: string, path: string) {
    if (path === "catalog") return { success: true, data: { products: DEMO_PRODUCTS.map((product) => ({ catalogItemId: `item-${product.sku}`, sku: product.sku })) } };
    if (path === "admin") return { success: true, data: { blocks: [{ type: "context", text: "Connected to DinkusKit.com, store playground." }] } };
    return { success: false, error: { code: "NOT_FOUND", message: path } };
  },
});
/** Every demo SKU's catalog item, as Commerce holds them once the seed's routes have run. */
const DEMO_SKUS = DEMO_PRODUCTS.flatMap((product) => [product.sku, ...(product.variant?.members.map((member) => member.sku) ?? [])]);
const seed = async (target: Kysely<never> = db) => {
  const catalog = new PluginStorageRepository<Record<string, unknown>>(target as never, COMMERCE_PLUGIN_ID, "catalog_items", []);
  for (const sku of new Set(DEMO_SKUS)) {
    if (!(await catalog.get(`item-${sku}`))) await catalog.put(`item-${sku}`, { recordKind: "catalog-item", itemId: `item-${sku}`, sku, name: sku });
  }
  return ensurePlaygroundDemoCatalog(target as never, { runtime: seededRuntime(target), origin: "https://playground.dinkuskit.com" });
};
afterEach(async () => { await db.destroy(); });

const settingsOf = () => loadMerchantStoreSettings(createSettingsAccess(new OptionsRepository(db as never), COMMERCE_PLUGIN_ID));

describe("playground visitor database state", () => {
  it("bootstraps US merchant settings once for a fresh store", async () => {
    expect((await settingsOf()).revision).toBeNull();
    await seed(db);
    const fresh = await settingsOf();
    expect(fresh.revision).not.toBeNull();
    expect(fresh.settings).toMatchObject({ storeCountry: "US", sellingCountries: ["US"], shippingCountries: ["US"] });
  });

  it("preserves saved settings, including an empty country list, across repeat seeding", async () => {
    await seed(db);
    const settings = createSettingsAccess(new OptionsRepository(db as never), COMMERCE_PLUGIN_ID);
    const before = await loadMerchantStoreSettings(settings);
    await saveMerchantStoreSettings(settings, { expectedRevision: before.revision, storeCountry: "US",
      sellingCountries: ["US"], shippingCountries: [], requirePhoneNumber: true });
    const saved = await settingsOf();
    await seed(db);
    await seed(db);
    const after = await settingsOf();
    expect(after.revision).toBe(saved.revision);
    expect(after.settings).toMatchObject({ shippingCountries: [], requirePhoneNumber: true });
  });

  it("keeps persisted checkout bindings authoritative in an existing database after re-seeding", async () => {
    await seed(db);
    const expiresAt = Date.now() + 30 * 60_000;
    await playgroundCheckoutBindingStore(db as never).put("attempt-existing", {
      recordKind: "playground-checkout-binding", attemptId: "attempt-existing", sessionId: "visitor-a", expiresAt });
    await seed(db);
    // A new store instance over the same database, as after an isolate restart.
    const reopened = playgroundCheckoutBindingStore(db as never);
    expect(await playgroundAttemptBelongsToVisitor("attempt-existing", "visitor-a", reopened)).toBe(true);
    expect(await playgroundAttemptBelongsToVisitor("attempt-existing", "visitor-b", reopened)).toBe(false);
    expect(await playgroundAttemptBelongsToVisitor("attempt-missing", "visitor-a", reopened)).toBe(false);
  });

  it("gives the playground's sample orders numbers no other order in the store has, and never counts them as the visitor's", async () => {
    const numbersIn = async (visitor: Kysely<never>) => {
      const orders = new PluginStorageRepository<OrderRecord>(visitor as never, COMMERCE_PLUGIN_ID, ORDERS_COLLECTION, []);
      const all = (await orders.query({ limit: 100 })).items.map((row) => row.data.number);
      const samples: Array<number | null | undefined> = [];
      for (const id of PLAYGROUND_SAMPLE_ORDER_IDS) samples.push((await orders.get(id))?.number);
      return { all, samples };
    };
    const nextIn = async (visitor: Kysely<never>) =>
      (await new PluginStorageRepository<{ next: number }>(visitor as never, COMMERCE_PLUGIN_ID, "order_numbers", []).get("next"))?.next;

    // An existing store that already holds placed orders #1001 to #1003.
    const placed = new PluginStorageRepository<Record<string, unknown>>(db as never, COMMERCE_PLUGIN_ID, ORDERS_COLLECTION, []);
    for (const number of [1001, 1002, 1003]) {
      await placed.put(`ord_visitor_${number}`, { number, revision: 1, paidOrder: { orderId: `ord_visitor_${number}` } });
    }
    await new PluginStorageRepository<{ next: number }>(db as never, COMMERCE_PLUGIN_ID, "order_numbers", []).put("next", { next: 1004 });
    await seed(db);
    await seed(db);
    const existing = await numbersIn(db);
    expect(existing.samples).toEqual([1004, 1005]);
    expect(new Set(existing.all).size).toBe(existing.all.length);
    expect(await nextIn(db)).toBe(1006);
    expect(await visitorOrderCount(db as never)).toBe(3);
    // A store that used the old instant demo sign-in keeps its demo shopper orders; they are not the visitor's.
    for (const id of ["ord_demo_shopper_1001", "ord_pre_upgrade_1000"]) {
      await placed.put(id, { number: 1100, revision: 1, paidOrder: { orderId: id } });
    }
    expect(await visitorOrderCount(db as never)).toBe(3);

    // A fresh store, where the samples take the first numbers.
    const fresh = await visitorDb();
    await seed(fresh);
    const later = await numbersIn(fresh);
    expect(later.samples).toEqual([1001, 1002]);
    expect(new Set(later.all).size).toBe(later.all.length);
    expect(await nextIn(fresh)).toBe(1003);
    expect(await visitorOrderCount(fresh as never)).toBe(0);
    await fresh.destroy();
  });

  it("ticks the playground tour off from what the visitor's own store holds", async () => {
    await seed(db);
    // The shipped sample's practice label and the sample orders are the playground's, not the visitor's.
    const first = await readTourState(db as never, true);
    expect(first).toEqual({ productEdited: false, paymentsConnected: false, orders: 0, labels: 0, shopVisited: false, checkoutOpen: true });
    expect(await newlyDoneSteps(db as never, tourSteps(first))).toEqual([]);

    // Change a product the way Commerce's Products page saves it.
    const items = new PluginStorageRepository<Record<string, unknown>>(db as never, COMMERCE_PLUGIN_ID, "catalog_items", []);
    const [item] = (await items.query({ limit: 1 })).items;
    await items.put(item!.id, { ...item!.data, title: "Renamed by the visitor" });

    // Finish Payments' pretend Connect through the stand-in, inside the visitor's request.
    const network = async () => new Response("network", { status: 599 });
    const standIn = playgroundDinkusKitFetch(network as unknown as typeof fetch, { env: () => ({}), origin: () => "https://playground.dinkuskit.com" });
    await runWithContext({ editMode: false, db } as never, () => standIn("https://dinkuskit.com/api/store-connections/token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: "dinkus-payments-emdash", connection_id: "c", code_verifier: "v" }),
    }));

    // The visitor's own paid order and practice label.
    await new PluginStorageRepository<Record<string, unknown>>(db as never, COMMERCE_PLUGIN_ID, ORDERS_COLLECTION, [])
      .put("ord_visitor", { number: 1005, revision: 1, paidOrder: { orderId: "ord_visitor" } });
    await new PluginStorageRepository<Record<string, unknown>>(db as never, "dinkuskit-playground", "labels", [])
      .put("practice_visitor", { labelId: "practice_visitor", orderId: "ord_visitor" });
    await recordShopVisit(db as never);

    const later = await readTourState(db as never, true);
    expect(later).toEqual({ productEdited: true, paymentsConnected: true, orders: 1, labels: 1, shopVisited: true, checkoutOpen: true });
    // Each finished step is announced once.
    expect(await newlyDoneSteps(db as never, tourSteps(later))).toEqual(["edit-product", "connect-payments", "place-order", "ship-order"]);
    expect(await newlyDoneSteps(db as never, tourSteps(later))).toEqual([]);
  });

  it("ticks Edit a product when the visitor publishes a change to a product page in Content > Products", async () => {
    await seed(db);
    expect(await readTourState(db as never, true)).toMatchObject({ productEdited: false });

    // Publishing writes the page's live values; a new short description is enough.
    const pages = new ContentRepository(db as never);
    const [page] = (await pages.findMany("products", { limit: 1 })).items;
    expect(page).toBeTruthy();
    await pages.update("products", page!.id, { data: { description: "Changed by the visitor" } });

    const later = await readTourState(db as never, true);
    expect(later).toMatchObject({ productEdited: true });
    expect(await newlyDoneSteps(db as never, tourSteps(later))).toEqual(["edit-product"]);
  });

  it("doesn't tick Edit a product for a new product that is only a draft, until it is published", async () => {
    await seed(db);
    expect(await readTourState(db as never, true)).toMatchObject({ productEdited: false });

    const pages = new ContentRepository(db as never);
    const draft = await pages.create({ type: "products", slug: "visitor-draft", status: "draft", data: { title: "Visitor draft", description: "Not in the shop yet" } });
    expect(await readTourState(db as never, true)).toMatchObject({ productEdited: false });

    await pages.update("products", draft.id, { status: "published" });
    expect(await readTourState(db as never, true)).toMatchObject({ productEdited: true });
  });

  it("keeps the progress a visitor made before the tour replaced the welcome card", async () => {
    await seed(db);
    const options = new OptionsRepository(db as never);
    // The welcome card's first look at the untouched catalog, kept under its own plugin id.
    await readTourState(db as never, true);
    const untouched = await options.get<string>("plugin:dinkus-playground-tour:catalog-baseline");
    await options.delete("plugin:dinkus-playground-tour:catalog-baseline");
    await options.set("plugin:dinkus-playground-welcome:catalog-baseline", untouched);

    // Before the tour: the visitor renamed a product and finished Payments' Connect, which Payments saved itself.
    const items = new PluginStorageRepository<Record<string, unknown>>(db as never, COMMERCE_PLUGIN_ID, "catalog_items", []);
    const [item] = (await items.query({ limit: 1 })).items;
    await items.put(item!.id, { ...item!.data, title: "Renamed before the tour" });
    await options.set("plugin:r_3brsc2on3bu673rn:state:registry-v2-control", { phase: "complete", flowId: "flow_before" });

    const upgraded = await readTourState(db as never, true);
    expect(upgraded).toMatchObject({ productEdited: true, paymentsConnected: true });
    expect(await newlyDoneSteps(db as never, tourSteps(upgraded))).toEqual(["edit-product", "connect-payments"]);

    // A Connect that never finished doesn't count.
    const unfinished = await visitorDb();
    await seed(unfinished);
    await new OptionsRepository(unfinished as never).set("plugin:r_3brsc2on3bu673rn:state:registry-v2-control", { phase: "pending" });
    expect(await readTourState(unfinished as never, true)).toMatchObject({ productEdited: false, paymentsConnected: false });
    await unfinished.destroy();
  });
});
