import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetStorePassCache } from "../../src/features/playground-checkout/index.js";
import {
  playgroundCheckoutHostOptions,
  playgroundAttemptBelongsToVisitor,
  playgroundPaymentsFetch,
  resolvePlaygroundPayments,
  withCheckoutVisitor,
} from "../../src/features/playground-checkout/payments-port.js";
import type { PlaygroundCheckoutBindingStore } from "../../src/features/playground-checkout/payments-port.js";

const env = {
  DINKUS_CHECKOUT_ENABLED: "1",
  PAYMENTS_URL: "https://payments.local.test",
  PAYMENTS_STORE_KEY: `dk_store_${"k".repeat(43)}`,
  PAYMENTS_STRIPE_ACCOUNT_ID: "acct_TEST1",
};
let bindings: PlaygroundCheckoutBindingStore;
beforeEach(() => {
  resetStorePassCache();
  const records = new Map<string, Awaited<ReturnType<PlaygroundCheckoutBindingStore["get"]>>>();
  bindings = {
    get: async (id) => records.get(id) ?? null,
    put: async (id, value) => { records.set(id, value); },
  };
});

describe("playground host-side Payments port", () => {
  it("is absent (fail closed) unless the flag and every value are set", async () => {
    expect(resolvePlaygroundPayments({ ...env, DINKUS_CHECKOUT_ENABLED: "0" })).toBeNull();
    for (const key of ["PAYMENTS_URL", "PAYMENTS_STORE_KEY", "PAYMENTS_STRIPE_ACCOUNT_ID"]) {
      expect(resolvePlaygroundPayments({ ...env, [key]: undefined })).toBeNull();
    }
    const options = playgroundCheckoutHostOptions({});
    expect(options.paymentBindingRef).toBe("playground");
    expect(await options.resolvePayments!("playground")).toBeNull();
    expect(await playgroundCheckoutHostOptions(env).resolvePayments!("other")).toBeNull();
  });

  it("prices flat-rate $5 shipping", async () => {
    expect(await playgroundCheckoutHostOptions(env).pricing!.resolveShippingConfiguration())
      .toEqual({ configurationId: "playground-flat-rate", revision: 1, mode: "flat", amount: { currency: "USD", minor: "500" } });
  });

  it("answers the binding pre-check locally and adds the visitor IP to session calls", async () => {
    const upstream = vi.fn(async () => Response.json({
      outcome: "open",
      attemptId: "att_0",
      session: { sessionId: "cs_test_0", expiresAt: Math.floor(Date.now() / 1000) + 1800 },
    }));
    const scoped = playgroundPaymentsFetch(env, { fetchImpl: upstream as never });
    const binding = await scoped("https://payments.local.test/v1/checkout-binding?bindingRef=playground", { method: "GET" });
    expect(await binding.json()).toEqual({ bindingRef: "playground", providerId: "stripe", stripeAccountId: "acct_TEST1", mode: "test", ready: true });
    expect(upstream).not.toHaveBeenCalled();
    await expect(scoped("https://payments.local.test/v1/checkout/session", { method: "POST", headers: { "x-dinkus-site": "playground" } }))
      .rejects.toThrow(/Visitor session/);
    await withCheckoutVisitor("203.0.113.7", "visitor-a", () =>
      scoped("https://payments.local.test/v1/checkout/session", {
        method: "POST",
        headers: { "x-dinkus-site": "playground" },
        body: JSON.stringify({ attemptId: "att_0" }),
      }), bindings);
    const headers = new Headers((upstream.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.get("x-dinkus-client-ip")).toBe("203.0.113.7");
    expect(headers.get("x-dinkus-site")).toBe("playground");
    await expect(scoped("https://evil.test/v1/checkout/session", { method: "POST" })).rejects.toThrow();
    await expect(scoped("https://payments.local.test/v1/checkout/wakes?bindingRef=playground", { method: "GET" })).rejects.toThrow();
  });

  it("creates a Stripe test session through Commerce's port with a minted pass (mocked Payments)", async () => {
    const passFetchImpl = vi.fn(async () => Response.json({ access_token: "h.p.s", token_type: "Bearer", expires_in: 300 }));
    const now = Math.floor(Date.now() / 1000);
    const upstream = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(init.body as string) as { attemptId: string; total: unknown };
      return Response.json({
        outcome: "open", attemptId: request.attemptId, total: request.total,
        session: { sessionId: "cs_test_mock1", redirectUrl: "https://checkout.stripe.com/c/pay/cs_test_mock1", createdAt: now, expiresAt: now + 1800 },
      });
    });
    const port = resolvePlaygroundPayments(env, { fetchImpl: upstream as never, passFetchImpl: passFetchImpl as never })!;
    const request = {
      attemptId: "att_1", bindingRef: "playground",
      lines: [{ catalogItemId: "item_1", quantity: 1, name: "Tee", unitPrice: { currency: "USD" as const, minor: "2500" } }],
      total: { currency: "USD" as const, minor: "2500" },
      paymentMethods: ["card"] as const, paymentWindow: { minSeconds: 1800 as const, maxSeconds: 1860 as const },
    };
    const outcome = await withCheckoutVisitor("203.0.113.7", "visitor-a", () => port.ensureSession(request as never), bindings);
    expect(outcome).toMatchObject({ outcome: "open", session: { sessionId: "cs_test_mock1" } });
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://payments.local.test/v1/checkout/session");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer h.p.s");
    expect(headers.get("x-dinkus-site")).toBe("playground");
    expect(headers.get("x-dinkus-client-ip")).toBe("203.0.113.7");
    expect(passFetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the pass exchange fails", async () => {
    const upstream = vi.fn();
    const port = resolvePlaygroundPayments(env, { fetchImpl: upstream as never, passFetchImpl: (async () => new Response("", { status: 401 })) as never })!;
    await expect(withCheckoutVisitor("203.0.113.7", "visitor-a", () => port.lookup({ attemptId: "a", bindingRef: "playground", lines: [], total: { currency: "USD", minor: "0" }, paymentMethods: ["card"], paymentWindow: { minSeconds: 1800, maxSeconds: 1860 } } as never), bindings))
      .rejects.toThrow();
    expect(upstream).not.toHaveBeenCalled();
  });

  it("binds payment attempts to the playground session before lookup", async () => {
    const passFetchImpl = vi.fn(async () => Response.json({ access_token: "h.p.s", token_type: "Bearer", expires_in: 300 }));
    const upstream = vi.fn(async (_url: string, init: RequestInit) => {
      const request = JSON.parse(init.body as string) as { attemptId: string };
      return Response.json({
        outcome: "open",
        attemptId: request.attemptId,
        total: { currency: "USD", minor: "2500" },
        session: { sessionId: "cs_isolated", redirectUrl: "https://checkout.stripe.com/c/pay/cs_isolated", createdAt: 1, expiresAt: Math.floor(Date.now() / 1000) + 1800 },
      });
    });
    const port = resolvePlaygroundPayments(env, { fetchImpl: upstream as never, passFetchImpl: passFetchImpl as never })!;
    const request = {
      attemptId: "att_isolated", bindingRef: "playground",
      lines: [{ catalogItemId: "item_1", quantity: 1, name: "Tee", unitPrice: { currency: "USD" as const, minor: "2500" } }],
      total: { currency: "USD" as const, minor: "2500" },
      paymentMethods: ["card"] as const, paymentWindow: { minSeconds: 1800 as const, maxSeconds: 1860 as const },
    };
    await withCheckoutVisitor("203.0.113.7", "visitor-a", () => port.ensureSession(request as never), bindings);
    const callsAfterCreate = upstream.mock.calls.length;
    await expect(withCheckoutVisitor("203.0.113.8", "visitor-b", () =>
      port.lookup(request as never), bindings)).rejects.toThrow(/visitor mismatch|not bound/);
    await expect(withCheckoutVisitor("203.0.113.7", "visitor-reset", () =>
      port.lookup(request as never), bindings)).rejects.toThrow(/visitor mismatch|not bound/);
    expect(upstream).toHaveBeenCalledTimes(callsAfterCreate);
  });

  it("encodes visitor binding into new attempt identities for isolate recovery", async () => {
    const options = playgroundCheckoutHostOptions(env);
    const attemptId = withCheckoutVisitor("203.0.113.7", "visitor-a", () =>
      options.createAttemptId!(), bindings);
    expect(attemptId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(await playgroundAttemptBelongsToVisitor(attemptId, "visitor-a")).toBe(false);
    expect(await playgroundAttemptBelongsToVisitor(attemptId, "visitor-a", bindings)).toBe(false);
    expect(await playgroundAttemptBelongsToVisitor(attemptId, "visitor-b", bindings)).toBe(false);
    expect(await playgroundAttemptBelongsToVisitor("missing-attempt", "visitor-a", bindings)).toBe(false);
  });

  it("rejects an expired binding before lookup transport", async () => {
    const passFetchImpl = vi.fn(async () => Response.json({ access_token: "h.p.s", token_type: "Bearer", expires_in: 300 }));
    const upstream = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { attemptId: string };
      return Response.json({
        outcome: "open", attemptId: body.attemptId, total: { currency: "USD", minor: "2500" },
        session: { sessionId: "cs_expiring", redirectUrl: "https://checkout.stripe.com/c/pay/cs_expiring", createdAt: 1, expiresAt: Math.floor(Date.now() / 1000) + 1800 },
      });
    });
    const port = resolvePlaygroundPayments(env, { fetchImpl: upstream as never, passFetchImpl: passFetchImpl as never })!;
    const request = {
      attemptId: "att_expiring", bindingRef: "playground",
      lines: [{ catalogItemId: "item_1", quantity: 1, name: "Tee", unitPrice: { currency: "USD" as const, minor: "2500" } }],
      total: { currency: "USD" as const, minor: "2500" },
      paymentMethods: ["card"] as const, paymentWindow: { minSeconds: 1800 as const, maxSeconds: 1860 as const },
    };
    await withCheckoutVisitor("203.0.113.7", "visitor-a", () => port.ensureSession(request as never), bindings);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 31 * 60 * 1000);
    await expect(withCheckoutVisitor("203.0.113.7", "visitor-a", () => port.lookup(request as never), bindings))
      .rejects.toThrow(/expired/);
    await expect(withCheckoutVisitor("203.0.113.8", "visitor-b", () => port.lookup(request as never), bindings))
      .rejects.toThrow(/expired/);
    expect(upstream).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});
