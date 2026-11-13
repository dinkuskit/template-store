import { describe, expect, it } from "vitest";

import {
  COMMERCE_REGISTRY_RUNTIME_ID,
  GUEST_CART_MAX_LINES,
  GUEST_CHECKOUT_CAPABILITY_HEADER,
  GUEST_CHECKOUT_PROJECTION_SCHEMA,
  SUPPORTED_GUEST_CHECKOUT_ROUTES,
} from "../../src/features/guest-cart/index.js";
import {
  CART_COOKIE,
  CART_COUNT_COOKIE,
  addToServerCart,
  cartJson,
  readBoundedBody,
  readBoundedForm,
  readAddForm,
  readContactForm,
  readServerCart,
  sameStoreRequest,
  setServerCartQuantity,
  startServerCheckout,
  type ServerCartContext,
} from "../../src/features/guest-cart/server-cart.js";
import { postAdd, postChange, postUpdate } from "../../src/features/guest-cart/cart-routes.js";
import { loadCheckoutReturn } from "../../src/features/guest-cart/server-return.js";

type Line = { catalogItemId: string; quantity: number };
type Attempt = { attemptId: string; state: "pending" | "paid" | "released-retry"; redirectUrl: string | null };

/** A stand-in for Commerce's public guest routes: prepare, cart (read or versioned replace) and start. */
function fakeCommerce() {
  const carts = new Map<string, { lines: Line[]; version: string | null; writes: number; attempt?: Attempt }>();
  const calls: { route: string; body: Record<string, unknown>; key: string | null }[] = [];
  let next = 0;
  const projection = (attempt?: Attempt) => ({
    schema: GUEST_CHECKOUT_PROJECTION_SCHEMA,
    state: attempt?.state ?? "pending",
    attemptId: attempt?.attemptId ?? null,
    redirectUrl: attempt?.redirectUrl ?? null,
    retryAfter: attempt?.state === "released-retry" ? attempt.attemptId : null,
    lines: [],
    order: attempt?.state === "paid"
      ? {
          orderId: "order:1001", receiptId: "rcpt_1",
          lines: [{ catalogItemId: "item_hat", name: "Hat", quantity: 2, unitPrice: { currency: "USD", minor: "1500" } }],
          total: { currency: "USD", minor: "3000" },
        }
      : null,
  });
  const ok = (id: string, extra: Record<string, unknown> = {}) => {
    const cart = carts.get(id)!;
    return {
      success: true,
      data: {
        ok: true, capabilityId: id, checkout: projection(cart.attempt),
        cart: { lines: cart.attempt?.state === "paid" ? [] : cart.lines, version: cart.version, expiresAt: 1_900_000_000 },
        ...extra,
      },
    };
  };
  const refuse = (code: string) => ({ success: true, data: { ok: false, error: { code, message: code } } });
  const dispatch = async (pluginId: string, method: string, path: string, request: Request) => {
    if (!path.startsWith("checkout/guest/")) return { success: false, error: { code: "NOT_FOUND", message: "not found" } };
    expect(pluginId).toBe(COMMERCE_REGISTRY_RUNTIME_ID);
    expect(method).toBe("POST");
    expect(request.headers.get("sec-fetch-site")).toBe("same-origin");
    const route = path.replace("checkout/guest/", "");
    const body = JSON.parse(await request.text()) as Record<string, unknown>;
    const presented = request.headers.get(GUEST_CHECKOUT_CAPABILITY_HEADER);
    calls.push({ route, body, key: presented });
    if (route === "prepare") {
      const id = `cap${++next}`;
      carts.set(id, { lines: [], version: null, writes: 0 });
      return ok(id, { capability: { capabilityId: id, capability: `${id}.secret`, retention: "json-body", header: GUEST_CHECKOUT_CAPABILITY_HEADER } });
    }
    const id = presented?.split(".")[0] ?? "";
    const cart = carts.get(id);
    if (!cart || presented !== `${id}.secret`) return refuse("CAPABILITY_DENIED");
    if (route === "cart") {
      if (!("lines" in body)) return ok(id);
      if (cart.attempt && cart.attempt.state !== "released-retry") return refuse("CHECKOUT_FROZEN");
      if (body.version !== cart.version) return refuse("CONTENTION");
      const merged = new Map<string, number>();
      for (const line of body.lines as (Line & { productId?: string; options?: Record<string, string> })[]) {
        const itemId = line.catalogItemId ?? (line.productId === "prod_tee" && line.options?.Size === "M" ? "item_tee_m" : null);
        if (!itemId || itemId === "item_gone") return refuse("PRODUCT_UNAVAILABLE");
        merged.set(itemId, (merged.get(itemId) ?? 0) + line.quantity);
      }
      cart.lines = [...merged].map(([catalogItemId, quantity]) => ({ catalogItemId, quantity })).sort((a, b) => a.catalogItemId.localeCompare(b.catalogItemId));
      cart.version = `v${++cart.writes}`;
      return ok(id);
    }
    if (route === "start") {
      if (!cart.lines.length) return refuse("INVALID_CART");
      cart.attempt = { attemptId: `att_${id}`, state: "pending", redirectUrl: "https://checkout.stripe.com/c/pay/cs_test_1" };
      return ok(id);
    }
    return refuse("UNAVAILABLE");
  };
  return { carts, calls, dispatch };
}

function fakeCookies(initial: Record<string, string> = {}) {
  const jar = new Map(Object.entries(initial));
  const set: { name: string; value: string; options: Record<string, unknown> }[] = [];
  return {
    jar,
    set,
    cookies: {
      get: (name: string) => jar.has(name) ? { value: jar.get(name)! } : undefined,
      set: (name: string, value: string, options: Record<string, unknown>) => { jar.set(name, value); set.push({ name, value, options }); },
    },
  };
}

function context(commerce: ReturnType<typeof fakeCommerce>, jar = fakeCookies(), init: RequestInit & { url?: string } = {}): ServerCartContext & { jar: ReturnType<typeof fakeCookies> } {
  const url = new URL(init.url ?? "https://shop.test/cart");
  return {
    locals: {
      emdash: {
        handlePublicPluginApiRoute: commerce.dispatch,
        getRuntimePluginSettingsSchema: () => ({}),
        getPluginRouteMeta: (_id: string, path: string) =>
          SUPPORTED_GUEST_CHECKOUT_ROUTES.includes(path as never) ? { public: true, methods: ["POST"] } : null,
      },
    } as unknown as App.Locals,
    request: new Request(url, init),
    url,
    cookies: jar.cookies as never,
    jar,
  };
}

describe("server cart", () => {
  it("makes a cart on the first add and keeps its key only in an HttpOnly cookie", async () => {
    const commerce = fakeCommerce();
    const ctx = context(commerce);
    const result = await addToServerCart(ctx, { catalogItemId: "item_hat", quantity: 2 });
    expect(result).toMatchObject({ ok: true, cart: { itemCount: 2, version: "v1" } });
    const key = ctx.jar.set.find((entry) => entry.name === CART_COOKIE)!;
    expect(key).toMatchObject({ value: "cap1.secret", options: { httpOnly: true, sameSite: "lax", secure: true, path: "/" } });
    const count = ctx.jar.set.find((entry) => entry.name === CART_COUNT_COOKIE)!;
    expect(count).toMatchObject({ value: "2" });
    expect(count.options.httpOnly).toBeUndefined();
    expect(commerce.calls.map((call) => call.route)).toEqual(["prepare", "cart"]);
  });

  it("adds to, changes and removes from the same cart, quoting what it read", async () => {
    const commerce = fakeCommerce();
    const jar = fakeCookies();
    await addToServerCart(context(commerce, jar), { catalogItemId: "item_hat", quantity: 1 });
    await addToServerCart(context(commerce, jar), { productId: "prod_tee", options: { Size: "M" }, quantity: 1 });
    expect(commerce.calls.at(-1)?.body).toEqual({
      version: "v1",
      lines: [{ catalogItemId: "item_hat", quantity: 1 }, { productId: "prod_tee", options: { Size: "M" }, quantity: 1 }],
    });
    expect(await setServerCartQuantity(context(commerce, jar), "item_hat", 4)).toMatchObject({ ok: true, cart: { itemCount: 5 } });
    expect(await setServerCartQuantity(context(commerce, jar), "item_tee_m", 0)).toMatchObject({
      ok: true, cart: { lines: [{ catalogItemId: "item_hat", quantity: 4 }] },
    });
  });

  it("starts a fresh cart once the old one is paid, or its key is refused", async () => {
    const commerce = fakeCommerce();
    const jar = fakeCookies();
    await addToServerCart(context(commerce, jar), { catalogItemId: "item_hat", quantity: 1 });
    commerce.carts.get("cap1")!.attempt = { attemptId: "att_1", state: "paid", redirectUrl: null };
    await addToServerCart(context(commerce, jar), { catalogItemId: "item_cap", quantity: 1 });
    expect(jar.jar.get(CART_COOKIE)).toBe("cap2.secret");
    const stale = fakeCookies({ [CART_COOKIE]: "cap9.secret" });
    expect(await addToServerCart(context(commerce, stale), { catalogItemId: "item_hat", quantity: 1 })).toMatchObject({ ok: true });
    expect(stale.jar.get(CART_COOKIE)).toBe("cap3.secret");
  });

  it("keeps the cart held while a payment is open and says so", async () => {
    const commerce = fakeCommerce();
    const jar = fakeCookies();
    await addToServerCart(context(commerce, jar), { catalogItemId: "item_hat", quantity: 1 });
    commerce.carts.get("cap1")!.attempt = { attemptId: "att_1", state: "pending", redirectUrl: "https://checkout.stripe.com/c/pay/x" };
    const held = await addToServerCart(context(commerce, jar), { catalogItemId: "item_cap", quantity: 1 });
    expect(held).toMatchObject({ ok: false, error: { code: "CHECKOUT_FROZEN" }, cart: { itemCount: 1 } });
    expect(cartJson(held)).toMatchObject({ ok: false, checkout: { open: true, continueUrl: "https://checkout.stripe.com/c/pay/x" } });
  });

  it("reads no cookie as an empty cart and puts a stale count right", async () => {
    const commerce = fakeCommerce();
    const jar = fakeCookies({ [CART_COUNT_COOKIE]: "3" });
    expect(await readServerCart(context(commerce, jar))).toMatchObject({ ok: false, error: { code: "NO_CART" }, cart: { itemCount: 0 } });
    expect(jar.jar.get(CART_COUNT_COOKIE)).toBe("0");
    expect(commerce.calls).toEqual([]);
  });

  it("starts checkout from the saved cart with only the contact", async () => {
    const commerce = fakeCommerce();
    const jar = fakeCookies();
    await addToServerCart(context(commerce, jar), { catalogItemId: "item_hat", quantity: 1 });
    const started = await startServerCheckout(context(commerce, jar), { email: "a@example.test" });
    expect(started).toMatchObject({ ok: true, checkout: { state: "pending", attemptId: "att_cap1" } });
    expect(commerce.calls.find((call) => call.route === "start")?.body).toEqual({ contact: { email: "a@example.test" } });
    expect(await startServerCheckout(context(commerce, fakeCookies()), { email: "a@example.test" })).toMatchObject({ ok: false, error: { code: "NO_CART" } });
  });
});

describe("store forms", () => {
  it("reads the add form by item id, or by product and options", () => {
    const single = new FormData();
    single.set("id", "item_hat");
    single.set("quantity", "3");
    expect(readAddForm(single)).toEqual({ catalogItemId: "item_hat", quantity: 3 });
    const sized = new FormData();
    sized.set("productId", "prod_tee");
    sized.set("options[Size]", "M");
    expect(readAddForm(sized)).toEqual({ productId: "prod_tee", options: { Size: "M" }, quantity: 1 });
    sized.set("quantity", "0");
    expect(readAddForm(sized)).toBeNull();
    expect(readAddForm(new FormData())).toBeNull();
  });

  it("reads the checkout form with billing same as delivery by default, and names the first missing field", () => {
    const form = new FormData();
    form.set("email", "a@example.test");
    for (const [field, value] of Object.entries({ name: "Ada", line1: "1 Main St", city: "Asheville", region: "NC", postalCode: "28801", country: "us" })) {
      form.set(`delivery[${field}]`, value);
    }
    form.set("billingSame", "on");
    const read = readContactForm(form, true);
    expect(read.error).toBeNull();
    expect(read.contact).toEqual({
      email: "a@example.test",
      delivery: { name: "Ada", line1: "1 Main St", city: "Asheville", region: "NC", postalCode: "28801", country: "US" },
      billing: { name: "Ada", line1: "1 Main St", city: "Asheville", region: "NC", postalCode: "28801", country: "US" },
    });
    form.delete("billingSame");
    expect(readContactForm(form, true).error).toMatchObject({ field: "billing[name]" });
    form.delete("delivery[region]");
    expect(readContactForm(form, true).error).toMatchObject({ field: "delivery[region]" });
    form.set("email", "nope");
    expect(readContactForm(form, true)).toMatchObject({ contact: null, error: { field: "email" }, values: { email: "nope" } });
  });

  it("takes writes only from this store", () => {
    const commerce = fakeCommerce();
    expect(sameStoreRequest(context(commerce, fakeCookies(), { headers: { "sec-fetch-site": "same-origin", origin: "https://shop.test" } }))).toBe(true);
    expect(sameStoreRequest(context(commerce, fakeCookies(), { headers: { "sec-fetch-site": "cross-site" } }))).toBe(false);
    expect(sameStoreRequest(context(commerce, fakeCookies(), { headers: { origin: "https://evil.test" } }))).toBe(false);
  });
});

function apiContext(commerce: ReturnType<typeof fakeCommerce>, jar: ReturnType<typeof fakeCookies>, path: string, body: BodyInit, headers: Record<string, string> = {}) {
  const ctx = context(commerce, jar, { url: `https://shop.test${path}`, method: "POST", body, headers: { origin: "https://shop.test", ...headers } });
  return { ...ctx, locals: ctx.locals, request: ctx.request, url: ctx.url, cookies: ctx.cookies } as never;
}

describe("cart routes", () => {
  it("answers a plain add form with a redirect to the cart, and a script with JSON", async () => {
    const commerce = fakeCommerce();
    const jar = fakeCookies();
    const form = new FormData();
    form.set("id", "item_hat");
    form.set("quantity", "2");
    const plain = await postAdd(apiContext(commerce, jar, "/cart/add", form));
    expect(plain.status).toBe(303);
    expect(plain.headers.get("location")).toBe("/cart?added=2");
    const script = await postAdd(apiContext(commerce, jar, "/cart/add.js", form));
    expect(script.status).toBe(200);
    expect(await script.json()).toMatchObject({ ok: true, cart: { itemCount: 4 } });
  });

  it("adds to an item already in a full cart instead of refusing a 41st line", async () => {
    const commerce = fakeCommerce();
    const jar = fakeCookies();
    const ctx = context(commerce, jar);
    for (let index = 0; index < GUEST_CART_MAX_LINES; index += 1) {
      expect((await addToServerCart(ctx, { catalogItemId: `item_${String(index).padStart(2, "0")}`, quantity: 1 })).ok).toBe(true);
    }
    const more = await addToServerCart(ctx, { catalogItemId: "item_07", quantity: 2 });
    expect(more).toMatchObject({ ok: true });
    expect(more.ok && more.cart.lines.length).toBe(GUEST_CART_MAX_LINES);
    expect(more.ok && more.cart.lines.find((line) => line.catalogItemId === "item_07")?.quantity).toBe(3);
    expect(await addToServerCart(ctx, { catalogItemId: "item_new", quantity: 1 })).toMatchObject({ ok: false, error: { code: "CART_FULL" } });
  });

  it("merges a size picked by its options into a full cart, and puts the cart back when it would not fit", async () => {
    const commerce = fakeCommerce();
    const ctx = context(commerce, fakeCookies());
    for (let index = 0; index < GUEST_CART_MAX_LINES - 1; index += 1) {
      expect((await addToServerCart(ctx, { catalogItemId: `item_${String(index).padStart(2, "0")}`, quantity: 1 })).ok).toBe(true);
    }
    expect((await addToServerCart(ctx, { catalogItemId: "item_tee_m", quantity: 1 })).ok).toBe(true);
    const sized = await addToServerCart(ctx, { productId: "prod_tee", options: { Size: "M" }, quantity: 1 });
    expect(sized).toMatchObject({ ok: true });
    expect(sized.ok && sized.cart.lines.length).toBe(GUEST_CART_MAX_LINES);
    expect(sized.ok && sized.cart.lines.find((line) => line.catalogItemId === "item_tee_m")?.quantity).toBe(2);

    const other = fakeCommerce();
    const full = context(other, fakeCookies());
    for (let index = 0; index < GUEST_CART_MAX_LINES; index += 1) {
      expect((await addToServerCart(full, { catalogItemId: `item_${String(index).padStart(2, "0")}`, quantity: 1 })).ok).toBe(true);
    }
    const refused = await addToServerCart(full, { productId: "prod_tee", options: { Size: "M" }, quantity: 1 });
    expect(refused).toMatchObject({ ok: false, error: { code: "CART_FULL" } });
    const after = await readServerCart(full);
    expect(after.ok && after.cart.lines.length).toBe(GUEST_CART_MAX_LINES);
    expect(after.ok && after.cart.lines.some((line) => line.catalogItemId === "item_tee_m")).toBe(false);
  });

  it("never parses a public form longer than the limit, even without a Content-Length", async () => {
    const commerce = fakeCommerce();
    const big = "x".repeat(64 * 1024);
    const stream = () => new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`id=item_hat&quantity=1&pad=${big}`));
      controller.close();
    } });
    const request = new Request("https://shop.test/cart/add", { method: "POST", body: stream(), duplex: "half",
      headers: { "content-type": "application/x-www-form-urlencoded" } } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();
    expect(await readBoundedForm(request, 8 * 1024)).toBeNull();
    const small = new Request("https://shop.test/cart/add", { method: "POST", body: "id=item_hat&quantity=1",
      headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect((await readBoundedForm(small, 8 * 1024))?.get("id")).toBe("item_hat");
    const json = new Request("https://shop.test/cart/update.js", { method: "POST", body: stream(), duplex: "half",
      headers: { "content-type": "application/json" } } as RequestInit);
    expect(await readBoundedBody(json, 8 * 1024)).toBeNull();
    const response = await postAdd(apiContext(commerce, fakeCookies(), "/cart/add", `id=item_hat&quantity=1&pad=${big}`,
      { "content-type": "application/x-www-form-urlencoded" }));
    expect(response.headers.get("location")).toBe("/cart?cart_error=INVALID_CART");
    expect(commerce.calls).toHaveLength(0);
  });

  it("sends a refused plain form to the cart page, which says why", async () => {
    const commerce = fakeCommerce();
    const form = new FormData();
    form.set("id", "item_gone");
    const response = await postAdd(apiContext(commerce, fakeCookies(), "/cart/add", form, { referer: "https://shop.test/products/gone?x=1" }));
    // The product page has no place for the reason; the cart page draws it (and the Referer is never trusted).
    expect(response.headers.get("location")).toBe("/cart?cart_error=PRODUCT_UNAVAILABLE");
    const crossSite = await postAdd(apiContext(commerce, fakeCookies(), "/cart/add", form, { "sec-fetch-site": "cross-site" }));
    expect(crossSite.headers.get("location")).toBe("/cart?cart_error=INVALID_CART");
  });

  it("changes a quantity and lets an agent replace the cart at a version", async () => {
    const commerce = fakeCommerce();
    const jar = fakeCookies();
    await addToServerCart(context(commerce, jar), { catalogItemId: "item_hat", quantity: 1 });
    const change = new FormData();
    change.set("id", "item_hat");
    change.set("quantity", "3");
    const changed = await postChange(apiContext(commerce, jar, "/cart/change", change));
    expect(changed.headers.get("location")).toBe("/cart");
    const stale = await postUpdate(apiContext(commerce, jar, "/cart/update.js", JSON.stringify({ version: "v1", lines: [] }), { "content-type": "application/json" }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ ok: false, error: { code: "CONTENTION" }, cart: { version: "v2", itemCount: 3 } });
    const fresh = await postUpdate(apiContext(commerce, jar, "/cart/update.js", JSON.stringify({ version: "v2", lines: [{ id: "item_cap", quantity: 1 }] }), { "content-type": "application/json" }));
    expect(await fresh.json()).toMatchObject({ ok: true, cart: { version: "v3", lines: [{ catalogItemId: "item_cap", quantity: 1 }] } });
  });
});

describe("thank-you page", () => {
  it("shows the paid order and zeroes the count, keeping the key so a reload shows it again", async () => {
    const commerce = fakeCommerce();
    const jar = fakeCookies();
    await addToServerCart(context(commerce, jar), { catalogItemId: "item_hat", quantity: 2 });
    commerce.carts.get("cap1")!.attempt = { attemptId: "att_1", state: "paid", redirectUrl: null };
    const paid = await loadCheckoutReturn(context(commerce, jar, { url: "https://shop.test/checkout/success?session_id=cs_forged" }));
    expect(paid).toMatchObject({ kind: "paid", order: { orderNumber: "1001", totals: [{ label: "Total", amount: "$30.00" }] } });
    expect(jar.jar.get(CART_COUNT_COOKIE)).toBe("0");
    expect(jar.jar.get(CART_COOKIE)).toBe("cap1.secret");
  });

  it("reloads while the payment is confirming, then stops after the last check", async () => {
    const commerce = fakeCommerce();
    const jar = fakeCookies();
    await addToServerCart(context(commerce, jar), { catalogItemId: "item_hat", quantity: 1 });
    commerce.carts.get("cap1")!.attempt = { attemptId: "att_1", state: "pending", redirectUrl: "https://checkout.stripe.com/c/pay/x" };
    expect(await loadCheckoutReturn(context(commerce, jar, { url: "https://shop.test/checkout/success" })))
      .toEqual({ kind: "confirming", refreshUrl: "/checkout/success?check=1", refreshSeconds: 3 });
    expect(await loadCheckoutReturn(context(commerce, jar, { url: "https://shop.test/checkout/success?check=10" }))).toEqual({ kind: "slow" });
    expect(await loadCheckoutReturn(context(commerce, jar, { url: "https://shop.test/checkout/success?check=abc" }))).toEqual({ kind: "slow" });
  });

  it("sends an unpaid return back to the cart with the items kept, and has no order without the cookie", async () => {
    const commerce = fakeCommerce();
    const jar = fakeCookies();
    await addToServerCart(context(commerce, jar), { catalogItemId: "item_hat", quantity: 1 });
    expect(await loadCheckoutReturn(context(commerce, jar, { url: "https://shop.test/checkout/success" })))
      .toEqual({ kind: "not-paid", redirect: "/cart?cart_error=NOT_PAID" });
    expect(await loadCheckoutReturn(context(commerce, fakeCookies(), { url: "https://shop.test/checkout/success" }))).toEqual({ kind: "no-cart" });
  });
});
