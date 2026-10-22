/**
 * Playground-only welcome card for the admin dashboard
 * (GrillTrack playground-prospect-demo-20261022). It walks a prospect through
 * their throwaway DinkusKit store and ticks off the steps it can see them do.
 * Real stores never install it; it costs Commerce nothing.
 */
import { definePlugin, PluginStorageRepository } from "emdash";
import { getRequestContext } from "emdash/request-context";

export const WELCOME_PLUGIN_ID = "dinkus-playground-welcome";
export const WELCOME_WIDGET = { id: "welcome", size: "full", title: "Welcome to your DinkusKit store" } as const;

const PRODUCTS = "products";
const PRODUCT_EDITED = "product-edited";
const START_REAL_STORE = "https://dinkuskit.com/";

type Db = ConstructorParameters<typeof PluginStorageRepository>[0];
type Kv = { get<T>(key: string): Promise<T | null>; set(key: string, value: unknown): Promise<void> };
type Block = Record<string, unknown>;

/** Orders Commerce holds in this visitor's store, read from Commerce's own storage. */
async function commerceOrderCount(): Promise<number> {
  const db = getRequestContext()?.db as Db | undefined;
  if (!db) return 0;
  try {
    return await new PluginStorageRepository(db, "dinkus-commerce", "orders", []).count();
  } catch {
    return 0;
  }
}

function step(done: boolean | undefined, title: string, text: string, link: Block): Block[] {
  const mark = done === undefined ? "→" : done ? "✓" : "○";
  return [
    { type: "section", text: `${mark} ${title}${done ? " (done)" : ""}`, accessory: link },
    { type: "context", text },
  ];
}

export function welcomeBlocks(origin: string, state: { productEdited: boolean; orders: number }): Block[] {
  const admin = (path: string) => ({ kind: "external", url: `${origin}/_emdash/admin${path}` });
  const done = [state.productEdited, state.orders > 0].filter(Boolean).length;
  return [
    {
      type: "banner",
      variant: "default",
      title: "This is your own store to play with",
      description:
        "Nobody else sees it, nothing you do here costs anything, and it all resets when your playground session ends. Try the steps below; they open in a new tab.",
    },
    { type: "meter", label: `${done} of 2 things to do so far`, value: done, max: 2 },
    ...step(state.productEdited, "Edit a product", "Change a name, a description or a photo, then save. It shows on the storefront straight away.",
      { type: "link", label: "Open Products", target: admin(`/content/${PRODUCTS}`), appearance: "primary" }),
    ...step(state.orders > 0, "Place a test order", "Buy something in your storefront with the test card 4242 4242 4242 4242, a future expiry date and a three-digit CVC. No real money moves.",
      { type: "link", label: "Open the storefront", target: { kind: "external", url: `${origin}/` }, appearance: "secondary" }),
    ...step(undefined, "Look at Shipping", "Ship buys, prints and cancels USPS labels for paid orders. In a real store it connects to DinkusKit.com; here it shows what you would connect.",
      { type: "link", label: "Open Shipping", target: admin("/plugins/dinkus-ship/shipping"), appearance: "secondary" }),
    ...step(undefined, "Look at Payments", "Payments takes card payments through Stripe. In a real store you connect it to DinkusKit.com once; here it stays unconnected.",
      { type: "link", label: "Open Payments", target: admin("/plugins/dinkus-payments/status"), appearance: "secondary" }),
    { type: "divider" },
    { type: "header", text: "Ready for real?" },
    {
      type: "section",
      text: "A real DinkusKit store runs these same plugins on your own EmDash site. You connect it to DinkusKit.com for card payments and postage, and your orders and customers stay yours.",
    },
    { type: "actions", elements: [{ type: "link", label: "Start your real store", target: { kind: "external", url: START_REAL_STORE }, appearance: "primary" }] },
  ];
}

export function createPlugin() {
  return definePlugin({
    id: WELCOME_PLUGIN_ID,
    version: "1.0.0",
    capabilities: ["content:read"],
    admin: { widgets: [WELCOME_WIDGET] },
    hooks: {
      "content:afterSave": async (event, ctx) => {
        if (event.collection !== PRODUCTS || event.isNew) return;
        await (ctx.kv as Kv).set(PRODUCT_EDITED, true);
      },
    },
    routes: {
      admin: {
        handler: async (ctx) => {
          const kv = ctx.kv as Kv;
          const origin = new URL(ctx.request.url).origin;
          return {
            blocks: welcomeBlocks(origin, {
              productEdited: (await kv.get<boolean>(PRODUCT_EDITED)) === true,
              orders: await commerceOrderCount(),
            }),
          };
        },
      },
    },
  });
}

export default createPlugin;
