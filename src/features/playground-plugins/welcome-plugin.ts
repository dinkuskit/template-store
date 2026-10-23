/**
 * Playground-only welcome card for the admin dashboard
 * (GrillTrack playground-prospect-demo-20261022). It walks a prospect through
 * their throwaway DinkusKit store and ticks off the steps it can see them do.
 * Real stores never install it; it costs Commerce nothing.
 */
import { definePlugin, PluginStorageRepository } from "emdash";
import { getRequestContext } from "emdash/request-context";
import { playgroundCheckoutConfigured } from "../playground-checkout/index.js";
import { START_REAL_STORE_URL } from "../playground/contract.js";
import { PLAYGROUND_INSTALLED_PLUGIN_IDS } from "./registry-plugins.mjs";

export const WELCOME_PLUGIN_ID = "dinkus-playground-welcome";
export const WELCOME_WIDGET = { id: "welcome", size: "full", title: "Welcome to your DinkusKit store" } as const;

const COMMERCE = "dinkus-commerce";
// The storefront shows the names, prices and photos Commerce keeps in these.
const CATALOG_COLLECTIONS = ["catalogItems", "catalogPrices", "catalogMedia"] as const;
const CATALOG_BASELINE = "catalog-baseline";
const CATALOG_PAGE_LIMIT = 100;
const CATALOG_MAX_PAGES = 10;

type Db = ConstructorParameters<typeof PluginStorageRepository>[0];
type Kv = { get<T>(key: string): Promise<T | null>; set(key: string, value: unknown): Promise<void> };
type Block = Record<string, unknown>;

function requestDb(): Db | undefined {
  return getRequestContext()?.db as Db | undefined;
}

/** Orders Commerce holds in this visitor's store, read from Commerce's own storage. */
async function commerceOrderCount(): Promise<number> {
  const db = requestDb();
  if (!db) return 0;
  try {
    return await new PluginStorageRepository(db, COMMERCE, "orders", []).count();
  } catch {
    return 0;
  }
}

/** A digest of the products as the storefront shows them, or null when Commerce's storage can't be read. */
async function catalogFingerprint(): Promise<string | null> {
  const db = requestDb();
  if (!db) return null;
  try {
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
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rows.join("\n")));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/**
 * True once the products differ from how they looked the first time this
 * visitor's dashboard opened. The playground seeds the catalog before the
 * dashboard first loads, so that first look is the untouched store.
 */
async function productEdited(kv: Kv): Promise<boolean> {
  const current = await catalogFingerprint();
  if (current === null) return false;
  const baseline = await kv.get<string>(CATALOG_BASELINE);
  if (baseline === null) {
    await kv.set(CATALOG_BASELINE, current);
    return false;
  }
  return baseline !== current;
}

function checkoutOpen(): boolean {
  const env = (globalThis as { __dinkusPlaygroundEnv?: Record<string, unknown> }).__dinkusPlaygroundEnv ?? process.env;
  return playgroundCheckoutConfigured(env);
}

function step(done: boolean | undefined, title: string, text: string, link: Block): Block[] {
  const mark = done === undefined ? "→" : done ? "✓" : "○";
  return [
    { type: "section", text: `${mark} ${title}${done ? " (done)" : ""}`, accessory: link },
    { type: "context", text },
  ];
}

export type WelcomeState = { productEdited: boolean; orders: number; checkoutOpen: boolean };

export function welcomeBlocks(origin: string, state: WelcomeState): Block[] {
  const admin = (path: string) => ({ kind: "external", url: `${origin}/_emdash/admin${path}` });
  const goals = state.checkoutOpen ? [state.productEdited, state.orders > 0] : [state.productEdited];
  const done = goals.filter(Boolean).length;
  const things = goals.length === 1 ? "thing" : "things";
  return [
    {
      type: "banner",
      variant: "default",
      title: "This is your own store to play with",
      description:
        "Nobody else sees it, nothing you do here costs anything, and it all resets when your playground session ends. Try the steps below; they open in a new tab.",
    },
    { type: "meter", label: `${done} of ${goals.length} ${things} to do so far`, value: done, max: goals.length, custom_value: `${done}/${goals.length}` },
    ...step(state.productEdited, "Edit a product", "On Commerce's Products page, pick a product and change its name or price. The storefront shows the change straight away.",
      { type: "link", label: "Open Products", target: admin(`/plugins/${COMMERCE}/products`), appearance: "primary" }),
    ...(state.checkoutOpen
      ? step(state.orders > 0, "Place a test order", "Buy something in your storefront with the test card 4242 4242 4242 4242, a future expiry date and a three-digit CVC. No real money moves.",
        { type: "link", label: "Open the storefront", target: { kind: "external", url: `${origin}/` }, appearance: "secondary" })
      : step(undefined, "Look at your storefront", "Test checkout is switched off in this playground, so the cart says checkout is unavailable. In a real store, shoppers pay by card through Payments.",
        { type: "link", label: "Open the storefront", target: { kind: "external", url: `${origin}/` }, appearance: "secondary" })),
    ...step(undefined, "Make a practice shipping label", "Ship buys, prints and cancels USPS labels for paid orders. Press Connect (it's pretend here), then open an order and press Make practice label.",
      { type: "link", label: "Open Shipping", target: admin(`/plugins/${PLAYGROUND_INSTALLED_PLUGIN_IDS.ship}/shipping`), appearance: "secondary" }),
    ...step(undefined, "Look at Payments", "Payments takes card payments through Stripe. Press Connect (it's pretend here) and it shows Stripe test mode ready.",
      { type: "link", label: "Open Payments", target: admin(`/plugins/${PLAYGROUND_INSTALLED_PLUGIN_IDS.payments}/status`), appearance: "secondary" }),
    { type: "divider" },
    { type: "header", text: "Ready for real?" },
    {
      type: "section",
      text: "A real DinkusKit store runs these same plugins on your own EmDash site. You connect it to DinkusKit.com for card payments and postage, and your orders and customers stay yours.",
    },
    { type: "actions", elements: [{ type: "link", label: "Start your real store", target: { kind: "external", url: START_REAL_STORE_URL }, appearance: "primary" }] },
  ];
}

export function createPlugin() {
  return definePlugin({
    id: WELCOME_PLUGIN_ID,
    version: "1.0.0",
    capabilities: [],
    admin: { widgets: [WELCOME_WIDGET] },
    routes: {
      admin: {
        handler: async (ctx) => {
          const origin = new URL(ctx.request.url).origin;
          return {
            blocks: welcomeBlocks(origin, {
              productEdited: await productEdited(ctx.kv as Kv),
              orders: await commerceOrderCount(),
              checkoutOpen: checkoutOpen(),
            }),
          };
        },
      },
    },
  });
}

export default createPlugin;
