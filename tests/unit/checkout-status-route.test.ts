import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../src/pages/api/checkout/status.js";
import { checkoutCanConfirm, parseGuestCheckoutWireResult } from "../../src/features/guest-cart/index.js";

const site = "https://store.example.test";
const projection = { schema: "dinkuskit.commerce.guest-checkout-projection/v1", state: "pending",
  attemptId: null, redirectUrl: null, order: null, retryAfter: null };
let dispatch: ReturnType<typeof vi.fn>;
let runtime: { handlePublicPluginApiRoute: ReturnType<typeof vi.fn>; getPluginRouteMeta: ReturnType<typeof vi.fn> };
function request(headers: Record<string, string> = {}, body: string | ReadableStream = "{}", url = site) {
  return new Request(url + "/api/checkout/status", { method: "POST", headers: {
    origin: site, "x-commerce-guest-capability": "cap.synthetic", ...headers,
  }, body, duplex: "half" } as RequestInit);
}
function call(req = request(), host: unknown = runtime) {
  return POST({ request: req, locals: { emdash: host } } as never);
}

beforeEach(() => {
  vi.stubEnv("EMDASH_SITE_URL", site);
  vi.stubEnv("DINKUS_CATALOG_PROFILE", "shipping");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("HTTP is forbidden"); }));
  dispatch = vi.fn().mockResolvedValue({ success: true, data: { ok: true, capabilityId: "cap", checkout: projection } });
  runtime = { handlePublicPluginApiRoute: dispatch, getPluginRouteMeta: vi.fn(() => ({ public: true, methods: ["POST"] })) };
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("installed public status dispatcher", () => {
  it("preserves admission and forwards only the fixed public route and approved headers", async () => {
    const { admitGuestCheckoutWrite } = await import("../../.artifacts/source-deps/commerce/src/features/checkout/origin-admission.js");
    const response = await call(request({ cookie: "private-cookie", authorization: "private-authorization" }));
    expect(response.status).toBe(200);
    expect(dispatch).toHaveBeenCalledTimes(1);
    const [id, method, path, forwarded] = dispatch.mock.calls[0];
    expect([id, method, path]).toEqual(["r_gshdrqaldna3r7sn", "POST", "checkout/guest/status"]);
    expect(forwarded.url).toBe(site + "/_emdash/api/plugins/r_gshdrqaldna3r7sn/checkout/guest/status");
    expect(Object.fromEntries(forwarded.headers)).toEqual({ accept: "application/json", "content-type": "application/json",
      origin: site, "x-commerce-guest-capability": "cap.synthetic" });
    admitGuestCheckoutWrite({ requestUrl: forwarded.url, headers: forwarded.headers, siteOrigin: site });
    expect(await forwarded.text()).toBe("{}");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("returns only the validated status projection, never extra fields or a capability secret", async () => {
    dispatch.mockResolvedValue({ success: true, private: "hidden", data: { ok: true, capabilityId: "cap", private: "hidden",
      capability: { capabilityId: "cap", capability: "cap.synthetic", retention: "json-body", header: "x-commerce-guest-capability" },
      checkout: { ...projection, private: "hidden" } } });
    expect(await (await call()).json()).toEqual({ ok: true, capabilityId: "cap", checkout: projection });
  });
  it("relays a paid answer the return page can confirm, with Commerce's line ids and pricing", async () => {
    const money = (minor: string) => ({ currency: "USD", minor });
    const line = { catalogItemId: "e2e-tee", name: "E2E Tee", quantity: 2, unitPrice: money("1500") };
    const pricing = { merchandiseSubtotal: money("3000"), couponDiscount: money("0"), netMerchandise: money("3000"),
      shipping: { mode: "flat", charge: money("500") }, finalTotal: money("3500") };
    // Commerce's paid projection, as its guest status route answers it.
    const paid = { ...projection, state: "paid", attemptId: "attempt-1", lines: [line], total: money("3500"),
      pricing: { ...pricing, private: "hidden", shipping: { ...pricing.shipping, private: "hidden" } }, unavailable: null,
      order: { orderId: "order-1", receiptId: "receipt-1", lines: [line], total: money("3500"), pricing } };
    dispatch.mockResolvedValue({ success: true, data: { ok: true, capabilityId: "cap", checkout: paid } });
    const body = await (await call()).json();
    expect(body.checkout.order).toEqual({ orderId: "order-1", receiptId: "receipt-1", lines: [line], total: money("3500") });
    expect(body.checkout.pricing).toEqual(pricing);
    const relayed = parseGuestCheckoutWireResult(body);
    expect(checkoutCanConfirm(relayed)).toBe(true);
    expect(relayed?.ok && relayed.checkout.order?.lines).toEqual([{ id: "e2e-tee", quantity: 2, name: "E2E Tee", unitPrice: money("1500") }]);
  });
  it.each([undefined, null, {}, { handlePluginApiRoute: vi.fn() }])("fails closed without a public dispatcher: %j", async host => {
    const response = await POST({ request: request(), locals: host === undefined ? undefined : { emdash: host } } as never);
    expect(response.status).toBe(503); expect(dispatch).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("preserves the installed guest route metadata", async () => {
    runtime.getPluginRouteMeta.mockImplementation((_id, path) => ({ public: path !== "checkout/guest/start", methods: ["POST"] }));
    expect((await call()).status).toBe(503); expect(dispatch).not.toHaveBeenCalled();
  });
  it.each([null, { success: true }, { success: true, data: { ok: true } }, { success: true, data: { ok: true, capabilityId: "cap", checkout: { ...projection, private: "x".repeat(65537) } } }])("bounds and validates HandlerResponse: %j", async value => {
    dispatch.mockResolvedValue(value); const response = await call();
    expect(response.status).toBe(503); expect((await response.json()).error.code).toBe("CHECKOUT_STATUS_RESPONSE_INVALID");
  });
  it("fails closed when route metadata lookup throws", async () => {
    runtime.getPluginRouteMeta.mockImplementation(() => { throw new Error("private metadata exception"); });
    expect((await call()).status).toBe(503);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("does not expose a dispatcher exception", async () => {
    dispatch.mockRejectedValue(new Error("private exception"));
    expect(await (await call()).json()).toEqual({ ok: false, error: { code: "CHECKOUT_STATUS_UNAVAILABLE", message: "Checkout status unavailable." } });
  });
});

describe("original caller and body bounds", () => {
  it.each(["", "null", "https://foreign.example.test", site + "/path"])("rejects untrusted Origin: %s", async origin => {
    const response = await call(request({ origin }));
    expect(response.status).toBe(403); expect(dispatch).not.toHaveBeenCalled();
  });
  it("rejects missing origin, foreign request host, contradictory fetch metadata and missing configuration", async () => {
    const missing = request(); missing.headers.delete("origin");
    expect((await call(missing)).status).toBe(403);
    expect((await call(request({}, "{}", "https://foreign.example.test"))).status).toBe(403);
    expect((await call(request({ "sec-fetch-site": "cross-site" }))).status).toBe(403);
    vi.stubEnv("EMDASH_SITE_URL", ""); expect((await call()).status).toBe(403);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it("rejects missing capability and oversized declared bodies before dispatch", async () => {
    const missing = request(); missing.headers.delete("x-commerce-guest-capability");
    expect((await call(missing)).status).toBe(400);
    expect((await call(request({ "content-length": "2097152" }, "x"))).status).toBe(413);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it.each([9, 1000])("bounds chunked request and discard work: %s chunks", async limit => {
    let pulls = 0;
    const body = new ReadableStream({ pull(controller) {
      if (pulls === limit) { controller.close(); return; }
      pulls++; controller.enqueue(new Uint8Array(1024));
    } });
    expect((await call(request({}, body))).status).toBe(413);
    expect(pulls).toBeLessThanOrEqual(70); expect(dispatch).not.toHaveBeenCalled();
  });
});

// The playground runs Commerce's Registry build too (template-one-build-registry-20261031): status recovery
// dispatches to the visitor's own Commerce under its Registry id, and a configured playground shows a terminal
// status only to the visitor whose session started that payment.
describe("playground status recovery", () => {
  const READY = {
    DINKUS_CHECKOUT_ENABLED: "1",
    PAYMENTS_URL: "https://payments.local.test",
    PAYMENTS_STORE_KEY: `dk_store_${"k".repeat(43)}`,
    PAYMENTS_STRIPE_ACCOUNT_ID: "acct_TEST1",
  };
  function playgroundCall(req = request()) {
    return POST({ request: req, locals: { emdash: runtime, __playgroundDb: {} } } as never);
  }
  it("dispatches a configured playground session to the visitor's Commerce status route", async () => {
    for (const [key, value] of Object.entries(READY)) vi.stubEnv(key, value);
    const response = await playgroundCall(request({ cookie: "emdash_playground=s1", "cf-connecting-ip": "203.0.113.7" }));
    expect(response.status).toBe(200);
    const [id, method, path, forwarded] = dispatch.mock.calls[0];
    expect([id, method, path]).toEqual(["r_gshdrqaldna3r7sn", "POST", "checkout/guest/status"]);
    expect(forwarded.url).toBe(site + "/_emdash/api/plugins/r_gshdrqaldna3r7sn/checkout/guest/status");
    expect(Object.fromEntries(forwarded.headers)).toEqual({ accept: "application/json", "content-type": "application/json",
      origin: site, "x-commerce-guest-capability": "cap.synthetic" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("requires the resolved terminal attempt to remain bound to the visitor", async () => {
    for (const [key, value] of Object.entries(READY)) vi.stubEnv(key, value);
    dispatch.mockResolvedValue({
      success: true,
      data: {
        ok: true,
        capabilityId: "cap",
        checkout: {
          ...projection,
          state: "paid",
          attemptId: "attempt-paid",
          order: { orderId: "order-1", receiptId: "receipt-1", lines: [{ catalogItemId: "fixture", quantity: 1 }] },
        },
      },
    });
    const bindings = {
      get: vi.fn(async (attemptId: string) => attemptId === "attempt-paid"
        ? { recordKind: "playground-checkout-binding", attemptId, sessionId: "visitor-a", expiresAt: Date.now() + 60_000 }
        : null),
      put: vi.fn(),
    };
    const response = await POST({
      request: request({ cookie: "emdash_playground=visitor-a" }),
      locals: { emdash: runtime, __playgroundDb: {}, __playgroundCheckoutBindings: bindings },
    } as never);
    expect(response.status).toBe(200);
    const foreign = await POST({
      request: request({ cookie: "emdash_playground=visitor-b" }),
      locals: { emdash: runtime, __playgroundDb: {}, __playgroundCheckoutBindings: bindings },
    } as never);
    expect(foreign.status).toBe(403);
  });
  it("keeps capability and origin checks, and leaves an unconfigured playground to Commerce's own answer", async () => {
    for (const [key, value] of Object.entries(READY)) vi.stubEnv(key, value);
    const missing = request(); missing.headers.delete("x-commerce-guest-capability");
    expect((await playgroundCall(missing)).status).toBe(400);
    expect((await playgroundCall(request({ origin: "https://foreign.example.test" }))).status).toBe(403);
    expect(dispatch).not.toHaveBeenCalled();
    // Checkout off: Commerce's own settings say so; the route still reaches the installed Commerce only.
    vi.stubEnv("DINKUS_CHECKOUT_ENABLED", "0");
    expect((await playgroundCall()).status).toBe(200);
    expect(dispatch.mock.calls.at(-1)?.[0]).toBe("r_gshdrqaldna3r7sn");
  });
});
