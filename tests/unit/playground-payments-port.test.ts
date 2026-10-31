import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { admitRegistryCheckoutConfig } from "@dinkuskit/commerce/features/checkout";
import { resetStorePassCache } from "../../src/features/playground-checkout/index.js";
import {
  playgroundAttemptBelongsToVisitor,
  playgroundPaymentsFetch,
  withCheckoutVisitor,
} from "../../src/features/playground-checkout/payments-port.js";
import type { PlaygroundCheckoutBindingStore } from "../../src/features/playground-checkout/payments-port.js";
import { playgroundDinkusKitFetch, standInStoreKey } from "../../src/features/playground-plugins/dinkuskit-stand-in.js";
import { PLAYGROUND_FLAT_RATE_SHIPPING } from "../../src/features/playground/flat-rate-shipping.js";

const env = {
  DINKUS_CHECKOUT_ENABLED: "1",
  PAYMENTS_URL: "https://payments.dinkuskit.com",
  PAYMENTS_STORE_KEY: `dk_store_${"k".repeat(43)}`,
  PAYMENTS_STRIPE_ACCOUNT_ID: "acct_TEST1",
};
const STORE = "https://playground.dinkuskit.com";
let bindings: PlaygroundCheckoutBindingStore;
beforeEach(() => {
  resetStorePassCache();
  const records = new Map<string, Awaited<ReturnType<PlaygroundCheckoutBindingStore["get"]>>>();
  bindings = {
    get: async (id) => records.get(id) ?? null,
    put: async (id, value) => { records.set(id, value); },
  };
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** A real pass the real DinkusKit.com would hand the playground's own checkout key. */
const realPass = (secondsLeft = 300) =>
  `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsLeft })).replaceAll("=", "")}.s`;
const json = (init: RequestInit) => JSON.stringify(init.body === undefined ? {} : JSON.parse(init.body as string));
const post = (body: unknown, key?: string): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
  body: JSON.stringify(body),
});

describe("the pretend DinkusKit sets up the visitor's Commerce (template-one-build-registry-20261031)", () => {
  const standIn = (environment: Record<string, unknown>, network = vi.fn(async () => new Response("network", { status: 599 }))) =>
    ({ network, fetch: playgroundDinkusKitFetch(network as never, { env: () => environment, origin: () => STORE }) });
  const settingsPass = async (fetch: typeof globalThis.fetch) => {
    const key = await standInStoreKey("dinkus-commerce-emdash");
    const pass = await (await fetch("https://dinkuskit.com/api/store-passes",
      post({ site_id: "playground", scope: "commerce:settings", audience: "dinkuskit" }, key))).json() as { access_token: string };
    return pass.access_token;
  };
  const settings = async (fetch: typeof globalThis.fetch) => (await fetch("https://dinkuskit.com/api/commerce-settings?shipping=free-over",
    { method: "GET", headers: { authorization: `Bearer ${await settingsPass(fetch)}` } })).json();

  it("hands Commerce the playground's checkout settings, which Commerce's own rules admit", async () => {
    const { fetch, network } = standIn(env);
    const value = await settings(fetch);
    expect(value).toMatchObject({ enabled: true, siteId: "playground", bindingRef: "playground", providerId: "stripe", stripeAccountId: "acct_TEST1",
      mode: "test", paymentsOrigin: "https://payments.dinkuskit.com", commerceOrigin: STORE });
    expect((value as { shipping: unknown }).shipping).toEqual(PLAYGROUND_FLAT_RATE_SHIPPING);
    expect(admitRegistryCheckoutConfig(value, STORE)).toMatchObject({ siteId: "playground", mode: "test" });
    expect(network).not.toHaveBeenCalled();
  });

  it("hands Commerce turned-off settings, so its checkout stays closed, unless the flag and every value are set", async () => {
    for (const environment of [{ ...env, DINKUS_CHECKOUT_ENABLED: "0" }, { ...env, PAYMENTS_URL: undefined },
      { ...env, PAYMENTS_STORE_KEY: undefined }, { ...env, PAYMENTS_STRIPE_ACCOUNT_ID: undefined }]) {
      const value = await settings(standIn(environment).fetch);
      expect(value).toEqual({ schema: "dinkuskit.commerce.registry-checkout/v1", enabled: false });
      expect(admitRegistryCheckoutConfig(value, STORE)).toBeNull();
    }
  });

  it("gives Commerce's checkout pass from the playground's real key, and none when checkout is off", async () => {
    const pass = realPass();
    const passes = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${env.PAYMENTS_STORE_KEY}`);
      expect(JSON.parse(init.body as string)).toEqual({ site_id: "playground", scope: "payments:checkout", audience: "dinkus-payments" });
      return Response.json({ access_token: pass, token_type: "Bearer", expires_in: 300 });
    });
    vi.stubGlobal("fetch", passes);
    const key = await standInStoreKey("dinkus-commerce-emdash");
    const ask = post({ site_id: "playground", scope: "payments:checkout", audience: "dinkus-payments" }, key);
    const answer = await (await standIn(env).fetch("https://dinkuskit.com/api/store-passes", ask)).json() as { access_token: string; expires_in: number };
    expect(answer.access_token).toBe(pass);
    expect(answer.expires_in).toBeGreaterThan(250);
    expect(passes).toHaveBeenCalledTimes(1);
    const off = await standIn({ ...env, DINKUS_CHECKOUT_ENABLED: "0" }).fetch("https://dinkuskit.com/api/store-passes", ask);
    expect(off.status).toBe(403);
    resetStorePassCache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    expect((await standIn(env).fetch("https://dinkuskit.com/api/store-passes", ask)).status).toBe(503);
  });

  it("puts Commerce's real-pass Payments calls through the playground's checkout guard", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 1800;
    const network = vi.fn(async (_url: string, init: RequestInit) =>
      Response.json({ outcome: "open", attemptId: JSON.parse(init.body as string).attemptId, session: { sessionId: "cs_test_1", expiresAt } }));
    const { fetch } = standIn(env, network as never);
    const binding = await fetch("https://payments.dinkuskit.com/v1/checkout-binding?bindingRef=playground", { method: "GET", headers: { authorization: `Bearer ${realPass()}` } });
    expect(await binding.json()).toEqual({ bindingRef: "playground", providerId: "stripe", stripeAccountId: "acct_TEST1", mode: "test", ready: true });
    // EmDash hands a plugin's request body over as bytes.
    const body = new TextEncoder().encode(JSON.stringify({ attemptId: "att_1" })).buffer;
    const session = await withCheckoutVisitor("203.0.113.7", "visitor-a", () => fetch("https://payments.dinkuskit.com/v1/checkout/session",
      { method: "POST", headers: { authorization: `Bearer ${realPass()}` }, body }), bindings);
    expect(session.status).toBe(200);
    expect(new Headers((network.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get("x-dinkus-client-ip")).toBe("203.0.113.7");
    expect(await playgroundAttemptBelongsToVisitor("att_1", "visitor-a", bindings)).toBe(true);
    // Another visitor's lookup, and a route the playground tenant does not serve, are refused before any call.
    const before = network.mock.calls.length;
    const foreign = await withCheckoutVisitor("203.0.113.8", "visitor-b", () => fetch("https://payments.dinkuskit.com/v1/checkout/lookup",
      { method: "POST", headers: { authorization: `Bearer ${realPass()}` }, body: JSON.stringify({ attemptId: "att_1" }) }), bindings);
    expect(foreign.status).toBe(503);
    expect((await fetch("https://payments.dinkuskit.com/v1/checkout/wakes?bindingRef=playground", { method: "GET", headers: { authorization: `Bearer ${realPass()}` } })).status).toBe(503);
    expect(network.mock.calls.length).toBe(before);
    expect(json({ body: undefined })).toBe("{}");
  });
});

describe("the playground's checkout guard", () => {
  it("answers the binding pre-check locally and adds the visitor IP to session calls", async () => {
    const upstream = vi.fn(async () => Response.json({
      outcome: "open",
      attemptId: "att_0",
      session: { sessionId: "cs_test_0", expiresAt: Math.floor(Date.now() / 1000) + 1800 },
    }));
    const scoped = playgroundPaymentsFetch(env, { fetchImpl: upstream as never });
    const binding = await scoped("https://payments.dinkuskit.com/v1/checkout-binding?bindingRef=playground", { method: "GET" });
    expect(await binding.json()).toEqual({ bindingRef: "playground", providerId: "stripe", stripeAccountId: "acct_TEST1", mode: "test", ready: true });
    expect(upstream).not.toHaveBeenCalled();
    await expect(scoped("https://payments.dinkuskit.com/v1/checkout/session", { method: "POST", headers: { "x-dinkus-site": "playground" } }))
      .rejects.toThrow(/Visitor session/);
    await withCheckoutVisitor("203.0.113.7", "visitor-a", () =>
      scoped("https://payments.dinkuskit.com/v1/checkout/session", {
        method: "POST",
        headers: { "x-dinkus-site": "playground" },
        body: JSON.stringify({ attemptId: "att_0" }),
      }), bindings);
    const headers = new Headers((upstream.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.get("x-dinkus-client-ip")).toBe("203.0.113.7");
    expect(headers.get("x-dinkus-site")).toBe("playground");
    await expect(scoped("https://evil.test/v1/checkout/session", { method: "POST" })).rejects.toThrow();
    await expect(scoped("https://payments.dinkuskit.com/v1/checkout/wakes?bindingRef=playground", { method: "GET" })).rejects.toThrow();
  });

  it("binds payment attempts to the playground session before lookup, and refuses expired ones", async () => {
    const upstream = vi.fn(async (_url: string, init: RequestInit) => Response.json({
      outcome: "open", attemptId: JSON.parse(init.body as string).attemptId,
      session: { sessionId: "cs_isolated", expiresAt: Math.floor(Date.now() / 1000) + 1800 },
    }));
    const scoped = playgroundPaymentsFetch(env, { fetchImpl: upstream as never });
    const call = (path: string, visitor: string) => withCheckoutVisitor("203.0.113.7", visitor, () =>
      scoped(`https://payments.dinkuskit.com${path}`, { method: "POST", body: JSON.stringify({ attemptId: "att_isolated" }) }), bindings);
    await call("/v1/checkout/session", "visitor-a");
    const callsAfterCreate = upstream.mock.calls.length;
    await expect(call("/v1/checkout/lookup", "visitor-b")).rejects.toThrow(/visitor mismatch|not bound/);
    await expect(call("/v1/checkout/lookup", "visitor-reset")).rejects.toThrow(/visitor mismatch|not bound/);
    expect(upstream).toHaveBeenCalledTimes(callsAfterCreate);
    await call("/v1/checkout/lookup", "visitor-a");
    expect(upstream).toHaveBeenCalledTimes(callsAfterCreate + 1);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31 * 60 * 1000);
    await expect(call("/v1/checkout/lookup", "visitor-a")).rejects.toThrow(/expired/);
    expect(await playgroundAttemptBelongsToVisitor("missing-attempt", "visitor-a", bindings)).toBe(false);
  });
});

describe("playground Payments session response bounding", () => {
  function streamed(chunks: number, chunkBytes: number, onCancel: () => Promise<void> = () => new Promise(() => {})) {
    let sent = 0;
    return new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= chunks) { controller.close(); return; }
        sent += 1;
        controller.enqueue(new Uint8Array(chunkBytes).fill(32));
      },
      // An upstream whose cancellation never settles must not stall the rejection.
      cancel: onCancel,
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  const session = (scoped: ReturnType<typeof playgroundPaymentsFetch>) => withCheckoutVisitor("203.0.113.7", "visitor-a", () =>
    scoped("https://payments.dinkuskit.com/v1/checkout/session", { method: "POST", body: JSON.stringify({ attemptId: "att_big" }) }), bindings);

  it("rejects an oversized session body without a Content-Length promptly and writes no binding", async () => {
    const scoped = playgroundPaymentsFetch(env, { fetchImpl: (async () => streamed(40, 8 * 1024)) as never });
    const outcome = await Promise.race([
      session(scoped).then(() => "resolved", (error: Error) => error.message),
      new Promise((resolve) => setTimeout(() => resolve("stalled"), 1_000)),
    ]);
    expect(outcome).toBe("Payments response too large");
    expect(await bindings.get("att_big")).toBeNull();
  });

  it("hands Commerce a readable session body after recording the binding", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 1800;
    const payload = JSON.stringify({ outcome: "open", attemptId: "att_ok", session: { sessionId: "cs_test_ok", expiresAt } });
    const scoped = playgroundPaymentsFetch(env, { fetchImpl: (async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(payload)); controller.close(); },
    }), { status: 200, headers: { "content-type": "application/json" } })) as never });
    const response = await withCheckoutVisitor("203.0.113.7", "visitor-a", () =>
      scoped("https://payments.dinkuskit.com/v1/checkout/session", { method: "POST", body: JSON.stringify({ attemptId: "att_ok" }) }), bindings);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual(JSON.parse(payload));
    expect(await bindings.get("att_ok")).toMatchObject({ sessionId: "visitor-a", expiresAt: expiresAt * 1000 });
  });
});
