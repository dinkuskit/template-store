import { describe, expect, it } from "vitest";
import { createTrustedTestCheckoutHostAssembly } from "../../src/features/test-checkout-host/index.js";
import type { PaymentRequest } from "@dinkuskit/commerce/features/checkout";

const config = {
  paymentsOrigin: "https://payments.example.test", commerceOrigin: "https://shop.example.test",
  siteId: "test-site", bindingRef: "binding-test", providerId: "stripe" as const,
  stripeAccountId: "acct_test", credentialResolver: async () => "synthetic-credential",
};
const binding = { bindingRef: config.bindingRef, providerId: "stripe",
  stripeAccountId: config.stripeAccountId, mode: "test", ready: true };
const result = { outcome: "open", attemptId: "attempt-cap", total: { currency: "USD", minor: "100" },
  session: { sessionId: "session-cap", redirectUrl: "https://checkout.stripe.com/test", createdAt: 1000, expiresAt: 2800 } };
const request: PaymentRequest = {
  attemptId: "attempt-cap", bindingRef: config.bindingRef, lines: [],
  total: { currency: "USD", minor: "100" }, paymentMethods: ["card"],
  paymentWindow: { minSeconds: 1800, maxSeconds: 1860 },
};
const endpoints = ["/v1/checkout-binding", "/v1/checkout/session", "/v1/existing-binding", "/v1/checkout/lookup"];

function streamed(value: unknown, bytes: number, declared: boolean, cancel: () => void) {
  const json = JSON.stringify(value);
  const body = new TextEncoder().encode(json + " ".repeat(bytes - json.length));
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === body.length) { controller.close(); return; }
      const end = Math.min(offset + 8192, body.length);
      controller.enqueue(body.slice(offset, end)); offset = end;
    },
    cancel,
  }), { headers: declared ? { "content-length": String(body.length) } : {} });
}

describe("Assembled canonical payment response caps", () => {
  it.each(endpoints.flatMap(endpoint => [false, true].map(declared => ({ endpoint, declared }))))(
    "rejects actual oversized $endpoint bytes (declared=$declared) before downstream transport",
    async ({ endpoint, declared }) => {
      const calls: string[] = []; let cancelled = false;
      const assembly = createTrustedTestCheckoutHostAssembly({ ...config, async fetch(url) {
        const path = new URL(url).pathname; calls.push(path);
        const value = path.includes("binding") ? binding : result;
        return path === endpoint
          ? streamed(value, 1024 * 1024 + 706, declared, () => { cancelled = true; })
          : Response.json(value);
      } });
      const port = await assembly.checkoutHost.resolvePayments(config.bindingRef);
      expect(port).not.toBeNull();
      const original = structuredClone(request);
      await expect(endpoint.includes("existing") || endpoint.includes("lookup")
        ? port!.lookup(request) : port!.ensureSession(request)).rejects.toThrow("Malformed Payments response");
      expect(cancelled).toBe(true);
      expect(request).toEqual(original);
      if (endpoint.includes("binding")) expect(calls).toEqual([endpoint]);
    },
  );

  it.each(endpoints)("fails closed for unsupported body on %s without reading unbounded JSON", async endpoint => {
    let jsonRead = false;
    const assembly = createTrustedTestCheckoutHostAssembly({ ...config, async fetch(url) {
      const path = new URL(url).pathname;
      const value = path.includes("binding") ? binding : result;
      if (path !== endpoint) return Response.json(value);
      return { ok: true, body: {}, json: async () => { jsonRead = true; return value; } } as unknown as Response;
    } });
    const port = await assembly.checkoutHost.resolvePayments(config.bindingRef);
    await expect(endpoint.includes("existing") || endpoint.includes("lookup")
      ? port!.lookup(request) : port!.ensureSession(request)).rejects.toThrow("Malformed Payments response");
    expect(jsonRead).toBe(false);
  });

  it("accepts an actual 131072-byte binding response at the inclusive cap", async () => {
    const assembly = createTrustedTestCheckoutHostAssembly({ ...config, async fetch(url) {
      return new URL(url).pathname.includes("binding")
        ? streamed(binding, 131072, false, () => { throw new Error("At-cap stream cancelled"); })
        : Response.json(result);
    } });
    const port = await assembly.checkoutHost.resolvePayments(config.bindingRef);
    await expect(port!.ensureSession(request)).resolves.toEqual(result);
  });
});
