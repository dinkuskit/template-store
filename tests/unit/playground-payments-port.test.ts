import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetStorePassCache } from "../../src/features/playground-checkout/index.js";
import {
  playgroundCheckoutHostOptions,
  playgroundPaymentsFetch,
  resolvePlaygroundPayments,
  withCheckoutVisitor,
} from "../../src/features/playground-checkout/payments-port.js";

const env = {
  DINKUS_CHECKOUT_ENABLED: "1",
  PAYMENTS_URL: "https://payments.local.test",
  PAYMENTS_STORE_KEY: `dk_store_${"k".repeat(43)}`,
  PAYMENTS_STRIPE_ACCOUNT_ID: "acct_TEST1",
};
beforeEach(() => resetStorePassCache());

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
    const upstream = vi.fn(async () => Response.json({ outcome: "unknown" }));
    const scoped = playgroundPaymentsFetch(env, { fetchImpl: upstream as never });
    const binding = await scoped("https://payments.local.test/v1/checkout-binding?bindingRef=playground", { method: "GET" });
    expect(await binding.json()).toEqual({ bindingRef: "playground", providerId: "stripe", stripeAccountId: "acct_TEST1", mode: "test", ready: true });
    expect(upstream).not.toHaveBeenCalled();
    await expect(scoped("https://payments.local.test/v1/checkout/session", { method: "POST", headers: { "x-dinkus-site": "playground" } }))
      .rejects.toThrow(/Visitor IP/);
    await withCheckoutVisitor("203.0.113.7", () =>
      scoped("https://payments.local.test/v1/checkout/session", { method: "POST", headers: { "x-dinkus-site": "playground" } }));
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
    const outcome = await withCheckoutVisitor("203.0.113.7", () => port.ensureSession(request as never));
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
    await expect(withCheckoutVisitor("203.0.113.7", () => port.lookup({ attemptId: "a", bindingRef: "playground", lines: [], total: { currency: "USD", minor: "0" }, paymentMethods: ["card"], paymentWindow: { minSeconds: 1800, maxSeconds: 1860 } } as never)))
      .rejects.toThrow();
    expect(upstream).not.toHaveBeenCalled();
  });
});
