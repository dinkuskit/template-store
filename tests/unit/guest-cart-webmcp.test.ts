import { describe, expect, it } from "vitest";
import {
  WEBMCP_ANTI_SCRAPE_NOTICE,
  WEBMCP_REGISTRATION_SYMBOL,
  buildStorefrontWebMcpTools,
  createStorefrontActions,
  installStorefrontWebMcp,
  type GuestCartCatalogSnapshot,
  type ModelContextHost,
  type WebMcpToolDescriptor,
} from "../../src/features/guest-cart/index.js";

function product(id: string, unitMinor: string, sellable = true): GuestCartCatalogSnapshot {
  return {
    id,
    found: true,
    name: `Product ${id}`,
    sku: id.toUpperCase(),
    fulfillment: "physical",
    thumbnail: null,
    price: { listable: true, regularText: "", saleText: null, unitMinor },
    availability: { status: sellable ? "in-stock" : "out-of-stock", sellable, listable: true },
  };
}

const CATALOG = [product("prod_hoodie", "6500"), product("prod_cap", "2800"), product("prod_soldout", "1800", false)];

async function snapshots(ids: readonly string[]): Promise<readonly GuestCartCatalogSnapshot[]> {
  return ids.map((id) => CATALOG.find((entry) => entry.id === id) ?? { id, found: false as const });
}

/** A stand-in for the store's /cart.js and /cart/update.js: a versioned cart, as Commerce keeps it. */
function fakeStore(initial: { catalogItemId: string; quantity: number }[] = []) {
  let lines = initial;
  let version: string | null = initial.length ? "v1" : null;
  let writes = 0;
  const requests: { path: string; body: unknown }[] = [];
  const fetch = async (path: string, init?: RequestInit): Promise<Response> => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ path, body });
    const answer = (ok: boolean, extra: Record<string, unknown> = {}, status = 200) => Response.json({
      ok, cart: { lines, version, itemCount: lines.reduce((sum, line) => sum + line.quantity, 0), expiresAt: 0 },
      checkout: { state: "pending", open: false, continueUrl: null }, ...extra,
    }, { status });
    if (path === "/cart.js") return answer(true);
    if (path === "/cart/update.js") {
      if (body.version !== version) return answer(false, { error: { code: "CONTENTION", message: "x" } }, 409);
      lines = body.lines.map((line: { catalogItemId: string; quantity: number }) => ({ catalogItemId: line.catalogItemId, quantity: line.quantity }));
      writes += 1;
      version = `v${writes + 1}`;
      return answer(true);
    }
    // The store's variant link: Commerce's id resolved to the published page's slug.
    if (path === "/variants/var_m") return Response.json({ ok: true, url: "/products/sized-tee?variant=var_m" });
    if (path.startsWith("/variants/")) return Response.json({ ok: false, error: { code: "NOT_FOUND", message: "x" } }, { status: 404 });
    return new Response("not found", { status: 404 });
  };
  return { fetch, requests, get version() { return version; }, changeElsewhere() { version = "elsewhere"; } };
}

function actionsFor(store: ReturnType<typeof fakeStore>, navigated: string[] = [], counts: number[] = []) {
  return createStorefrontActions({
    fetch: store.fetch,
    fetchSnapshot: snapshots,
    navigate: (path) => navigated.push(path),
    onCartChanged: (count) => counts.push(count),
  });
}

describe("browser agent tools on the server cart", () => {
  it("reads the server cart with its version and Commerce prices", async () => {
    const store = fakeStore([{ catalogItemId: "prod_hoodie", quantity: 2 }]);
    const cart = await actionsFor(store).getCart();
    expect(cart).toMatchObject({ ok: true, untrustedContent: true, version: "v1", itemCount: 2, subtotalMinor: 13000 });
    if (!cart.ok) throw new Error("expected a cart");
    expect(cart.lines[0]).toMatchObject({ id: "prod_hoodie", name: "Product prod_hoodie", unitPriceMinor: 6500, lineSubtotalMinor: 13000, sellable: true });
    expect(cart.reviewFingerprint).toMatch(/^cart:[0-9a-f]{8}:1$/u);
  });

  it("replaces the whole cart quoting the version, and a stale version changes nothing", async () => {
    const store = fakeStore([{ catalogItemId: "prod_hoodie", quantity: 1 }]);
    const counts: number[] = [];
    const actions = actionsFor(store, [], counts);
    const updated = await actions.updateCart({ version: "v1", lines: [{ id: "prod_cap", quantity: 3 }], key: "retry-1" });
    expect(updated).toMatchObject({ ok: true, cart: { itemCount: 3, version: "v2" } });
    expect(store.requests.at(-1)).toEqual({
      path: "/cart/update.js",
      body: { version: "v1", lines: [{ catalogItemId: "prod_cap", quantity: 3 }], key: "retry-1" },
    });
    expect(counts).toEqual([3]);
    const stale = await actions.updateCart({ version: "v1", lines: [] });
    expect(stale).toMatchObject({ ok: false, code: "CONTENTION", cart: { itemCount: 3, version: "v2" } });
    expect(stale.ok ? "" : stale.message).toContain("get_cart");
    expect(counts).toEqual([3]);
  });

  it("sends a product with its options so Commerce picks the variant", async () => {
    const store = fakeStore();
    await actionsFor(store).updateCart({ version: null, lines: [{ productId: "prod_tee", options: { Size: "M" }, quantity: 1 }] });
    expect(store.requests.at(-1)?.body).toEqual({ version: null, lines: [{ productId: "prod_tee", options: { Size: "M" }, quantity: 1 }] });
  });

  it("refuses bad lines before any request", async () => {
    const store = fakeStore();
    const actions = actionsFor(store);
    for (const lines of [[{ id: "../x", quantity: 1 }], [{ id: "prod_cap", quantity: 0 }], [{ id: "prod_cap", quantity: 100 }], "nope"]) {
      const result = await actions.updateCart({ version: null, lines: lines as never });
      expect(result).toMatchObject({ ok: false, code: "INVALID_INPUT", instruction: WEBMCP_ANTI_SCRAPE_NOTICE });
    }
    expect(store.requests).toEqual([]);
  });

  it("creates a cart only when the shopper has none, and cancel empties it", async () => {
    const store = fakeStore();
    const actions = actionsFor(store);
    expect(await actions.createCart([{ id: "prod_cap", quantity: 1 }])).toMatchObject({ ok: true, cart: { itemCount: 1 } });
    expect(await actions.createCart([{ id: "prod_hoodie", quantity: 1 }])).toMatchObject({ ok: false, code: "CART_EXISTS" });
    expect(await actions.cancelCart({ version: store.version })).toMatchObject({ ok: true, cart: { itemCount: 0, lines: [] } });
  });

  it("opens a product on a variant at its published page", async () => {
    const navigated: string[] = [];
    const actions = actionsFor(fakeStore(), navigated);
    // The page lives at its published slug (sized-tee), not at the Commerce id (prod_tee).
    expect(await actions.showVariant({ productId: "prod_tee", variantId: "var_m" })).toEqual({ ok: true, url: "/products/sized-tee?variant=var_m" });
    expect(await actions.showVariant({ productId: "prod_gone" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await actions.showVariant({ productId: "../admin" })).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(navigated).toEqual(["/products/sized-tee?variant=var_m"]);
  });

  it("asks for the shopper's review before opening checkout, and a cart change resets it", async () => {
    const store = fakeStore([{ catalogItemId: "prod_cap", quantity: 1 }]);
    const navigated: string[] = [];
    const actions = actionsFor(store, navigated);
    const forged = await actions.proceedToCheckout({ buyerConfirmed: true, reviewFingerprint: "cart:00000000:1" });
    expect(forged).toMatchObject({ ok: true, status: "buyer_review_required", subtotalMinor: 2800 });
    expect(navigated).toEqual([]);
    const first = await actions.proceedToCheckout();
    if (!first.ok) throw new Error("expected a review step");
    store.changeElsewhere();
    const afterChange = await actions.proceedToCheckout({ buyerConfirmed: true, reviewFingerprint: first.reviewFingerprint });
    expect(afterChange).toMatchObject({ status: "buyer_review_required" });
    if (!afterChange.ok) throw new Error("expected a review step");
    const confirmed = await actions.proceedToCheckout({ buyerConfirmed: true, reviewFingerprint: afterChange.reviewFingerprint });
    expect(confirmed).toMatchObject({ ok: true, status: "requires_escalation", continueUrl: "/checkout" });
    expect(navigated).toEqual(["/checkout"]);
  });

  it("will not open checkout for an empty cart or an item that cannot be bought", async () => {
    expect(await actionsFor(fakeStore()).proceedToCheckout()).toMatchObject({ ok: false, code: "EMPTY_CART" });
    expect(await actionsFor(fakeStore([{ catalogItemId: "prod_soldout", quantity: 1 }])).proceedToCheckout())
      .toMatchObject({ ok: false, code: "UNSELLABLE_LINE" });
    expect(await actionsFor(fakeStore([{ catalogItemId: "prod_gone", quantity: 1 }])).proceedToCheckout())
      .toMatchObject({ ok: false, code: "UNSELLABLE_LINE" });
  });
});

describe("WebMCP registration", () => {
  it("registers Shopify's tool names once and attaches window.Dinkus.actions", async () => {
    const registered: WebMcpToolDescriptor[] = [];
    const host: ModelContextHost = { registerTool: (tool) => registered.push(tool) };
    const target: Record<string, unknown> = {};
    const store = fakeStore();
    const first = installStorefrontWebMcp({ modelContext: host, globalTarget: target, fetch: store.fetch, fetchSnapshot: snapshots });
    const second = installStorefrontWebMcp({ modelContext: host, globalTarget: target, fetch: store.fetch, fetchSnapshot: snapshots });
    expect(first.toolNames).toEqual(["get_cart", "create_cart", "update_cart", "cancel_cart", "show_variant", "proceed_to_checkout"]);
    expect(registered.map((tool) => tool.name)).toEqual(first.toolNames);
    expect(second.actions).toBe(first.actions);
    expect(host[WEBMCP_REGISTRATION_SYMBOL]).toBe(true);
    expect((target.Dinkus as { actions: unknown }).actions).toBe(first.actions);
    for (const tool of registered) expect(tool.annotations.untrustedContentHint).toBe(true);
    expect(registered.find((tool) => tool.name === "proceed_to_checkout")?.annotations.consequentialHint).toBe(true);
    const update = registered.find((tool) => tool.name === "update_cart")!;
    expect(update.inputSchema).toMatchObject({ required: ["version", "lines"] });
    expect(await update.execute({ version: null, lines: [{ id: "prod_cap", quantity: 2 }] })).toMatchObject({ ok: true, cart: { itemCount: 2 } });
  });

  it("attaches only the actions when no browser agent is present", () => {
    const target: Record<string, unknown> = {};
    expect(installStorefrontWebMcp({ modelContext: null, globalTarget: target })).toMatchObject({ webMcpRegistered: false, toolNames: [] });
    expect(target.Dinkus).toBeDefined();
    expect(buildStorefrontWebMcpTools(createStorefrontActions({ fetch: fakeStore().fetch })).length).toBe(6);
  });
});
