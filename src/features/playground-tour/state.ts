/**
 * Where a prospect is in the playground tour (GrillTrack playground-guided-tour-20261023).
 * Every step ticks itself off from what the visitor's own store holds: an
 * edited product page, a finished pretend Connect, their own paid order and their
 * own practice label. The admin card, the tour page and the shop guide all
 * read it here, so they always agree.
 */
import { OptionsRepository, PluginStorageRepository } from "emdash";
import { sql } from "kysely";
import { START_REAL_STORE_URL } from "../playground/contract.js";
import { PLAYGROUND_SAMPLE_ORDER_IDS } from "../playground/demo-orders.js";
import { PLAYGROUND_INSTALLED_PLUGIN_IDS } from "../playground-plugins/registry-plugins.mjs";
import { STAND_IN_STORAGE, standInConnectedOption } from "../playground-plugins/dinkuskit-stand-in.js";
import { DEMO_SHOPPER_ORDER_ID } from "../shopper-account/index.js";
import { PRE_UPGRADE_SHOPPER_ORDER_ID } from "../shopper-account/playground-runtime.js";
import type { TourCopyKey } from "./copy.js";

export const TOUR_PLUGIN_ID = "dinkus-playground-tour";
export const TOUR_WIDGET = { id: "tour", size: "full", title: "Playground tour" } as const;
export const TOUR_ADMIN_PAGE = { path: "/tour", label: "Playground tour", icon: "compass" } as const;
/** The storefront page that shows the whole tour; its words are the CMS page of the same slug. */
export const TOUR_SHOP_PATH = "/playground-tour";

const COMMERCE = "dinkus-commerce";
// The storefront shows the names, prices and photos Commerce keeps in these.
const CATALOG_COLLECTIONS = ["catalogItems", "catalogPrices", "catalogMedia"] as const;
const CATALOG_PAGE_LIMIT = 100;
const CATALOG_MAX_PAGES = 10;
const option = (key: string) => `plugin:${TOUR_PLUGIN_ID}:${key}`;
const CATALOG_BASELINE = option("catalog-baseline");
const PRODUCT_PAGES_BASELINE = option("product-pages-baseline");
const SHOP_VISITED = option("shop-visited");
const CELEBRATED = option("celebrated");
// Before the tour, the welcome card kept the untouched catalog's digest under its own plugin id.
const WELCOME_CATALOG_BASELINE = "plugin:dinkus-playground-welcome:catalog-baseline";
// Payments keeps its own Connect progress here. Visitors who connected before the
// tour have this but no stand-in note, so either one counts.
const PAYMENTS_CONNECT_STATE = `plugin:${PLAYGROUND_INSTALLED_PLUGIN_IDS.payments}:state:registry-v2-control`;
// The shipped sample comes with its practice label; every other label is the visitor's own.
const SAMPLE_LABEL_ID = `practice_${PLAYGROUND_SAMPLE_ORDER_IDS[0]}`;

type Db = ConstructorParameters<typeof PluginStorageRepository>[0];
const options = (db: Db) => new OptionsRepository(db as ConstructorParameters<typeof OptionsRepository>[0]);

// Orders the playground adds itself, as examples; placing a test order means one of the visitor's own.
const EXAMPLE_ORDER_IDS = [...PLAYGROUND_SAMPLE_ORDER_IDS, DEMO_SHOPPER_ORDER_ID, PRE_UPGRADE_SHOPPER_ORDER_ID];

/** Orders the visitor placed in their store, read from Commerce's own storage. */
export async function visitorOrderCount(db: Db): Promise<number> {
  const orders = new PluginStorageRepository(db, COMMERCE, "orders", []);
  const examples = await orders.getMany(EXAMPLE_ORDER_IDS);
  return Math.max(0, (await orders.count()) - examples.size);
}

/** Practice labels the visitor made themselves. */
async function visitorLabelCount(db: Db): Promise<number> {
  const labels = new PluginStorageRepository(db, STAND_IN_STORAGE.pluginId, STAND_IN_STORAGE.labels, []);
  const sample = await labels.getMany([SAMPLE_LABEL_ID]);
  return Math.max(0, (await labels.count()) - sample.size);
}

/** A digest of the products as the storefront shows them. */
async function catalogFingerprint(db: Db): Promise<string> {
  const rows: string[] = [];
  for (const collection of CATALOG_COLLECTIONS) {
    const repo = new PluginStorageRepository(db, COMMERCE, collection, []);
    let cursor: string | undefined;
    for (let page = 0; page < CATALOG_MAX_PAGES; page += 1) {
      const result = await repo.query({ limit: CATALOG_PAGE_LIMIT, ...(cursor ? { cursor } : {}) });
      for (const item of result.items) rows.push(`${collection}:${item.id}:${JSON.stringify(item.data)}`);
      cursor = result.cursor;
      if (!cursor) break;
    }
  }
  rows.sort();
  return sha256(rows.join("\n"));
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * A digest of the product pages in Content > Products as the shop shows them.
 * Products keep revisions, so a saved draft changes nothing here until it is published.
 */
async function productPagesFingerprint(db: Db): Promise<string> {
  const result = await sql<Record<string, unknown>>`
    SELECT id, status, live_revision_id, title, description FROM ec_products
    WHERE deleted_at IS NULL ORDER BY id
  `.execute(db);
  return sha256(result.rows.map((row) => JSON.stringify(row)).join("\n"));
}

async function changedSince(db: Db, key: string, current: string, earlier?: string): Promise<boolean> {
  let baseline = await options(db).get<string>(key);
  if (baseline === null) {
    baseline = (earlier ? await options(db).get<string>(earlier) : null) ?? current;
    await options(db).set(key, baseline);
  }
  return baseline !== current;
}

/**
 * True once a product page in Content > Products, or Commerce's catalog, differs
 * from how it looked the first time the tour (or, for the catalog of a visitor
 * from before the tour, the welcome card) read it. The playground seeds both
 * before the first page loads, so that first look is the untouched store.
 * The catalog still counts so a visitor who edited a price before step 1 moved
 * to Content > Products keeps the tick.
 */
async function productEdited(db: Db): Promise<boolean> {
  const pages = await orFalse(async () => changedSince(db, PRODUCT_PAGES_BASELINE, await productPagesFingerprint(db)), false);
  if (pages) return true;
  return changedSince(db, CATALOG_BASELINE, await catalogFingerprint(db), WELCOME_CATALOG_BASELINE);
}

/** True once Payments' pretend Connect finished, whether before or since the tour arrived. */
async function paymentsConnected(db: Db): Promise<boolean> {
  if ((await options(db).get(standInConnectedOption("payments"))) !== null) return true;
  const control = await options(db).get<{ phase?: unknown }>(PAYMENTS_CONNECT_STATE);
  return control?.phase === "complete";
}

export interface TourState {
  productEdited: boolean;
  paymentsConnected: boolean;
  orders: number;
  labels: number;
  shopVisited: boolean;
  checkoutOpen: boolean;
}

export const EMPTY_TOUR_STATE: TourState = {
  productEdited: false, paymentsConnected: false, orders: 0, labels: 0, shopVisited: false, checkoutOpen: false,
};

async function orFalse<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

/** Reads the visitor's progress. A part that can't be read counts as not done yet. */
export async function readTourState(db: Db, checkoutOpen: boolean): Promise<TourState> {
  return {
    productEdited: await orFalse(() => productEdited(db), false),
    paymentsConnected: await orFalse(() => paymentsConnected(db), false),
    orders: await orFalse(() => visitorOrderCount(db), 0),
    labels: await orFalse(() => visitorLabelCount(db), 0),
    shopVisited: await orFalse(async () => (await options(db).get(SHOP_VISITED)) !== null, false),
    checkoutOpen,
  };
}

/** Notes that the visitor opened their shop, which completes "Look at your shop" when checkout is off. */
export async function recordShopVisit(db: Db): Promise<void> {
  await orFalse(async () => {
    if ((await options(db).get(SHOP_VISITED)) === null) await options(db).set(SHOP_VISITED, true);
  }, undefined);
}

export type TourStepId = "edit-product" | "connect-payments" | "place-order" | "ship-order" | "real-store";
export interface TourStep {
  id: TourStepId;
  copy: TourCopyKey;
  done: boolean;
  /** Where Take me there goes: a path in this store, or an address elsewhere. */
  href: string;
  button: string;
  inAdmin: boolean;
}

const adminPath = (path: string) => `/_emdash/admin${path}`;

/** The tour in order. The last step, Start your real store, is never ticked. */
export function tourSteps(state: TourState): TourStep[] {
  return [
    { id: "edit-product", copy: "edit-product", done: state.productEdited, href: adminPath("/content/products"), button: "Open Products", inAdmin: true },
    { id: "connect-payments", copy: "connect-payments", done: state.paymentsConnected, href: adminPath(`/plugins/${PLAYGROUND_INSTALLED_PLUGIN_IDS.payments}/status`), button: "Open Payments", inAdmin: true },
    state.checkoutOpen
      ? { id: "place-order", copy: "place-order", done: state.orders > 0, href: "/", button: "Open your shop", inAdmin: false }
      : { id: "place-order", copy: "look-at-shop", done: state.shopVisited, href: "/", button: "Open your shop", inAdmin: false },
    { id: "ship-order", copy: "ship-order", done: state.labels > 0, href: adminPath(`/plugins/${PLAYGROUND_INSTALLED_PLUGIN_IDS.ship}/shipping`), button: "Open Shipping", inAdmin: true },
    { id: "real-store", copy: "real-store", done: false, href: START_REAL_STORE_URL, button: "Start your real store", inAdmin: false },
  ];
}

/** The first step not done yet; once the rest are done, Start your real store. */
export function nextTourStep(steps: readonly TourStep[]): TourStep {
  return steps.find((step) => !step.done) ?? steps[steps.length - 1]!;
}

/** Steps finished since the visitor last saw the tour, so it can say well done once. Remembers them as seen. */
export async function newlyDoneSteps(db: Db, steps: readonly TourStep[]): Promise<TourStepId[]> {
  return orFalse(async () => {
    const seen = new Set((await options(db).get<TourStepId[]>(CELEBRATED)) ?? []);
    const fresh = steps.filter((step) => step.done && !seen.has(step.id)).map((step) => step.id);
    if (fresh.length > 0) await options(db).set(CELEBRATED, [...seen, ...fresh]);
    return fresh;
  }, []);
}
