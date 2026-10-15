import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("../../src/features/playground/demo-commerce-seed.js", () => ({ ensurePlaygroundDemoCatalog: vi.fn(async () => ({ created: [] })) }));

const { onRequest } = await import("../../src/middleware.js");
const { COMMERCE_REGISTRY_RUNTIME_ID } = await import("../../src/features/guest-cart/checkout-protocol.js");
const { playgroundCheckoutAdmission } = await import("../../src/features/playground-checkout/index.js");
const { playgroundCheckoutConfigured } = await import("../../src/features/playground-checkout/payments-port.js");

const registryStart = `/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/checkout/guest/start`;
const nativeStart = "/_emdash/api/plugins/dinkus-commerce/checkout/guest/start";
const body = JSON.stringify({ lines: [{ catalogItemId: "item_1", quantity: 1 }] });
const READY = {
  DINKUS_CHECKOUT_ENABLED: "1",
  PAYMENTS_URL: "https://payments.local.test",
  PAYMENTS_STORE_KEY: `dk_store_${"k".repeat(43)}`,
  PAYMENTS_STRIPE_ACCOUNT_ID: "acct_TEST1",
};
const KEYS = [...Object.keys(READY), "DINKUS_STOREFRONT_PROFILE", "DINKUS_CATALOG_PROFILE", "DINKUS_HOSTING_PROFILE"];
let saved: Record<string, string | undefined>;
beforeEach(() => { saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]])); for (const k of KEYS) delete process.env[k]; });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

async function call(path: string, opts: { playground?: boolean; ip?: string | null; limiter?: unknown; raw?: string; omitContentLength?: boolean } = {}) {
  const payload = opts.raw ?? body;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts.omitContentLength) headers["content-length"] = String(new TextEncoder().encode(payload).byteLength);
  if (opts.ip !== null) headers["cf-connecting-ip"] = opts.ip ?? "203.0.113.7";
  const request = new Request(`https://playground.example${path}`, { method: "POST", headers, body: payload });
  const locals: Record<string, unknown> = { emdash: null };
  if (opts.playground !== false) {
    locals.__playgroundDb = {};
    locals.__playgroundCheckoutLimiter = "limiter" in opts ? opts.limiter : { limit: async () => ({ success: true }) };
  }
  const next = vi.fn(async () => new Response("native", { status: 200 }));
  const response = await (onRequest as unknown as (c: unknown, n: unknown) => Promise<Response>)({
    url: new URL(request.url), request, locals, cookies: { get: () => ({ value: "pg-session" }) },
  }, next);
  return { response, next };
}

describe("playground sandbox checkout gates", () => {
  it("stay closed exactly as today with the flag off", async () => {
    Object.assign(process.env, { ...READY, DINKUS_CHECKOUT_ENABLED: "0" });
    const registry = await call(registryStart);
    expect(registry.response.status).toBe(503);
    expect(registry.next).not.toHaveBeenCalled();
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
    for (const missing of ["PAYMENTS_URL", "PAYMENTS_STORE_KEY", "PAYMENTS_STRIPE_ACCOUNT_ID"]) {
      Object.assign(process.env, READY);
      delete process.env[missing];
      const { response, next } = await call(registryStart);
      expect(response.status).toBe(503);
      expect(next).not.toHaveBeenCalled();
      expect((await call(nativeStart)).response.status).toBe(405);
    }
  });

  it("open only for a configured playground session, after validation, IP and limiter", async () => {
    Object.assign(process.env, READY);
    const ok = await call(registryStart);
    expect(ok.response.status).toBe(200);
    expect(ok.next).toHaveBeenCalledWith(nativeStart);
    const streamed = await call(registryStart, { omitContentLength: true });
    expect(streamed.response.status).toBe(200);
    expect(streamed.next).toHaveBeenCalledWith(nativeStart);
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
