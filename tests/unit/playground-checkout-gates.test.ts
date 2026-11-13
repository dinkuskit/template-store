import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("../../src/features/playground/demo-commerce-seed.js", () => ({ ensurePlaygroundDemoCatalog: vi.fn(async () => ({ created: [] })) }));

const { onRequest } = await import("../../src/middleware.js");
const { COMMERCE_REGISTRY_RUNTIME_ID } = await import("../../src/features/guest-cart/checkout-protocol.js");
const { playgroundCheckoutAdmission } = await import("../../src/features/playground-checkout/index.js");
const { storeBannerText } = await import("../../src/features/store-shell/checkout-copy.js");
const { playgroundCheckoutConfigured, playgroundEnvOf } = await import("../../src/features/playground-checkout/payments-port.js");

const registryStart = `/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/checkout/guest/start`;
const nativeStart = "/_emdash/api/plugins/dinkus-commerce/checkout/guest/start";
const body = JSON.stringify({ contact: { email: "shopper@example.test" } });
const READY = {
  DINKUS_CHECKOUT_ENABLED: "1",
  PAYMENTS_URL: "https://payments.local.test",
  PAYMENTS_STORE_KEY: `dk_store_${"k".repeat(43)}`,
  PAYMENTS_STRIPE_ACCOUNT_ID: "acct_TEST1",
  EMDASH_SITE_URL: "https://playground.example",
};
const KEYS = [...Object.keys(READY), "DINKUS_STOREFRONT_PROFILE", "DINKUS_CATALOG_PROFILE", "DINKUS_HOSTING_PROFILE", "DINKUS_LOCAL_PROOF"];
let saved: Record<string, string | undefined>;
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); for (const k of KEYS) delete process.env[k]; });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

async function call(path: string, opts: { playground?: boolean; ip?: string | null; limiter?: unknown; raw?: string; omitContentLength?: boolean; commerce?: boolean } = {}) {
  const payload = opts.raw ?? body;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts.omitContentLength) headers["content-length"] = String(new TextEncoder().encode(payload).byteLength);
  if (opts.ip !== null) headers["cf-connecting-ip"] = opts.ip ?? "203.0.113.7";
  const request = new Request(`https://playground.example${path}`, { method: "POST", headers, body: payload });
  const dispatch = vi.fn(async (_pluginId: string, _method: string, _path: string, forwarded: Request) =>
    ({ success: true, data: { forwardedBody: await forwarded.text(), forwardedUrl: forwarded.url } }));
  const locals: Record<string, unknown> = { emdash: opts.commerce ? { handlePublicPluginApiRoute: dispatch } : null };
  if (opts.playground !== false) {
    locals.__playgroundDb = {};
    locals.__playgroundCheckoutLimiter = "limiter" in opts ? opts.limiter : { limit: async () => ({ success: true }) };
  }
  // The visitor's own Commerce (its Registry build, installed in the store) answers behind next().
  const next = vi.fn(async () => Response.json({ success: true, data: { forwardedBody: await request.text() } }));
  const response = await (onRequest as unknown as (c: unknown, n: unknown) => Promise<Response>)({
    url: new URL(request.url), request, locals, cookies: { get: () => ({ value: "pg-session" }) },
  }, next);
  return { response, next, dispatch };
}

describe("playground sandbox checkout gates", () => {
  it("stay closed exactly as today with the flag off", async () => {
    Object.assign(process.env, { ...READY, DINKUS_CHECKOUT_ENABLED: "0" });
    const registry = await call(registryStart);
    expect(registry.response.status).toBe(503);
    expect(registry.next).not.toHaveBeenCalled();
    expect(registry.dispatch).not.toHaveBeenCalled();
    const native = await call(nativeStart);
    expect(native.response.status).toBe(405);
    expect(native.next).not.toHaveBeenCalled();
  });

  it("stay closed on non-playground hosts even when fully configured", async () => {
    Object.assign(process.env, READY);
    expect((await call(registryStart, { playground: false })).response.status).toBe(503);
    expect((await call(nativeStart, { playground: false })).response.status).toBe(405);
  });

  it("stay closed on the playground when required env is missing", async () => {
    for (const missing of ["PAYMENTS_URL", "PAYMENTS_STORE_KEY", "PAYMENTS_STRIPE_ACCOUNT_ID", "EMDASH_SITE_URL"]) {
      Object.assign(process.env, READY);
      delete process.env[missing];
      const { response, next } = await call(registryStart);
      expect(response.status).toBe(503);
      expect(next).not.toHaveBeenCalled();
      // With the visitor's Commerce installed, its checkout routes are still never reached.
      for (const path of [registryStart, registryStart.replace("/start", "/prepare")]) {
        const installed = await call(path, { commerce: true, raw: path.endsWith("/prepare") ? "{}" : undefined });
        expect(installed.response.status, `${missing} ${path}`).toBe(503);
        expect(installed.next).not.toHaveBeenCalled();
      }
      expect((await call(nativeStart)).response.status).toBe(405);
    }
  });

  it("open only for a configured playground session, after validation, IP and limiter", async () => {
    Object.assign(process.env, READY);
    // The cart's Registry-path call reaches the visitor's own Commerce (template-one-build-registry-20261031),
    // with the body the guard validated still unread.
    const ok = await call(registryStart, { commerce: true });
    expect(ok.response.status).toBe(200);
    expect(ok.next).toHaveBeenCalledTimes(1);
    expect(ok.dispatch).not.toHaveBeenCalled();
    expect(await ok.response.json()).toEqual({ success: true, data: { forwardedBody: body } });
    const streamed = await call(registryStart, { omitContentLength: true, commerce: true });
    expect(streamed.response.status).toBe(200);
    expect(streamed.next).toHaveBeenCalledTimes(1);
    expect((await call(registryStart, { raw: JSON.stringify({ lines: [{ catalogItemId: "a", quantity: 1, price: 1 }] }) })).response.status).toBe(400);
    expect((await call(registryStart, { ip: null })).response.status).toBe(400);
    expect((await call(registryStart, { limiter: { limit: async () => ({ success: false }) } })).response.status).toBe(429);
    // A missing limiter binding fails closed.
    expect((await call(registryStart, { limiter: undefined })).response.status).toBe(429);
  });

  it("admits the cart only for a configured playground session", () => {
    Object.assign(process.env, READY);
    expect(playgroundCheckoutConfigured()).toBe(true);
    expect(playgroundCheckoutAdmission(true, true)).not.toBeNull();
    expect(playgroundCheckoutAdmission(false, true)).toBeNull();
    expect(playgroundCheckoutAdmission(true, false)).toBeNull();
    expect(playgroundCheckoutConfigured({ ...READY, DINKUS_CHECKOUT_ENABLED: "true" })).toBe(false);
    expect(playgroundCheckoutConfigured({ ...READY, PAYMENTS_STRIPE_ACCOUNT_ID: "sk_test_x" })).toBe(false);
  });

  it("does not admit checkout without a valid trusted return origin, even with the flag and Payments env", async () => {
    const payments: Record<string, string> = { ...READY };
    delete payments.EMDASH_SITE_URL;
    const invalid = [undefined, "", "   ", "not a url", "playground.example", "ftp://playground.example",
      "http://playground.example", "http://127.0.0.1:4397", "https://user:pw@playground.example",
      "https://playground.example/shop", "https://playground.example/?x=1", "https://playground.example/#top"];
    for (const site of invalid) {
      const env = site === undefined ? payments : { ...payments, EMDASH_SITE_URL: site };
      expect(playgroundCheckoutConfigured(env), String(site)).toBe(false);
      // The cart derives its admission and banner from the same gate: checkout shows unavailable.
      const admission = playgroundCheckoutAdmission(true, playgroundCheckoutConfigured(env));
      expect(admission).toBeNull();
      expect(storeBannerText(Boolean(admission))).toContain("checkout are unavailable");
    }
    // Loopback http is accepted only for the local proof harness.
    expect(playgroundCheckoutConfigured({ ...payments, EMDASH_SITE_URL: "http://127.0.0.1:4397", DINKUS_LOCAL_PROOF: "1" })).toBe(true);
    expect(playgroundCheckoutConfigured({ ...payments, EMDASH_SITE_URL: "http://localhost:4397", DINKUS_LOCAL_PROOF: "1" })).toBe(true);
    expect(playgroundCheckoutConfigured({ ...payments, EMDASH_SITE_URL: "http://playground.example", DINKUS_LOCAL_PROOF: "1" })).toBe(false);
    expect(playgroundCheckoutConfigured({ ...payments, EMDASH_SITE_URL: "https://playground.example" })).toBe(true);
    // Pages judge the playground on the environment the checkout routes are gated on, not on the Site URL the
    // Worker derives into process.env for EmDash.
    Object.assign(process.env, { ...payments, EMDASH_SITE_URL: "https://playground.example" });
    expect(playgroundCheckoutConfigured(playgroundEnvOf({ __playgroundEnv: payments }))).toBe(false);
    expect(playgroundCheckoutConfigured(playgroundEnvOf({}))).toBe(true);
    delete process.env.EMDASH_SITE_URL;

    // The live gates stay closed too: no Commerce dispatch for the cart's checkout calls.
    Object.assign(process.env, payments);
    const registry = await call(registryStart);
    expect(registry.response.status).toBe(503);
    expect(registry.next).not.toHaveBeenCalled();
    expect((await call(nativeStart)).response.status).toBe(405);
    // Nothing reaches the playground's native Commerce checkout route.
    const routed = await call(registryStart, { commerce: true });
    expect(routed.dispatch.mock.calls.map((args) => args[0])).not.toContain("dinkus-commerce");
  });
});

describe("sandbox checkout body guard", () => {
  it("rejects an oversized streamed body with 413 without waiting on the unread original", async () => {
    Object.assign(process.env, READY);
    const chunk = new Uint8Array(1024).fill(32);
    let pulls = 0;
    // An endless chunked body: awaiting cancellation of one tee branch would hang here.
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { pulls += 1; controller.enqueue(chunk); } });
    const request = new Request(`https://playground.example${registryStart}`, {
      method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" }, body: stream, duplex: "half",
    } as RequestInit);
    const next = vi.fn(async () => new Response("native", { status: 200 }));
    const response = await Promise.race([
      (onRequest as unknown as (c: unknown, n: unknown) => Promise<Response>)({
        url: new URL(request.url), request,
        locals: { emdash: null, __playgroundDb: {}, __playgroundCheckoutLimiter: { limit: async () => ({ success: true }) } },
        cookies: { get: () => ({ value: "pg-session" }) },
      }, next),
      new Promise<Response>((_, reject) => setTimeout(() => reject(new Error("guard stalled")), 2_000)),
    ]);
    expect(response.status).toBe(413);
    expect(next).not.toHaveBeenCalled();
    expect(pulls).toBeGreaterThan(4);
  });
});

describe("the store's own checkout calls in the playground", () => {
  it("need the visitor's IP and pass the limiter before Commerce starts a payment", async () => {
    const { startServerCheckout } = await import("../../src/features/guest-cart/server-cart.js");
    Object.assign(process.env, READY);
    const dispatch = vi.fn(async () => ({ success: true, data: { ok: false, error: { code: "INVALID_CART", message: "x" } } }));
    const ctx = (ip: string | null, limiter: unknown) => {
      const url = new URL("https://playground.example/checkout");
      return {
        url,
        request: new Request(url, { method: "POST", headers: ip ? { "cf-connecting-ip": ip } : {} }),
        locals: { emdash: { handlePublicPluginApiRoute: dispatch }, __playgroundDb: {}, __playgroundCheckoutLimiter: limiter } as never,
        cookies: { get: (name: string) => name === "dk_cart" ? { value: "cap1.secret" } : { value: "pg-session" }, set: () => undefined } as never,
      };
    };
    const allow = { limit: async () => ({ success: true }) };
    expect(await startServerCheckout(ctx(null, allow), { email: "a@example.test" })).toMatchObject({ ok: false, error: { code: "UNAVAILABLE" } });
    expect(await startServerCheckout(ctx("203.0.113.7", { limit: async () => ({ success: false }) }), { email: "a@example.test" }))
      .toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
    expect(await startServerCheckout(ctx("203.0.113.7", undefined), { email: "a@example.test" })).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
