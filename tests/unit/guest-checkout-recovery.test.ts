import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  COMMERCE_REGISTRY_RUNTIME_ID,
  GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY,
  MAX_GUEST_CHECKOUT_STATUS_CHECKS,
  canRetryGuestCheckoutStatus,
  callGuestCheckout,
  checkoutCanConfirm,
  createGuestCheckoutController,
  parseGuestCheckoutWireResult,
  readGuestCheckoutRetention,
  retainGuestCheckoutCapability,
  strictStripeCheckoutUrl,
  guestCheckoutRetryUrl,
  updateGuestCheckoutAttempt,
  type GuestCheckoutRetentionStorage,
} from "../../src/features/guest-cart/index.js";
import {
  formatConfirmedDeliveryAddress,
  resolveConfirmedOrderDestination,
  resolveOrderLineThumbnail,
} from "../../src/features/guest-cart/guest-cart-client.js";

function storage(): GuestCheckoutRetentionStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const projection = {
  schema: "dinkuskit.commerce.guest-checkout-projection/v1",
  state: "pending",
  attemptId: null,
  lines: [],
  total: null,
  redirectUrl: null,
  order: null,
  retryAfter: null,
  unavailable: null,
};

const retention = { capabilityId: "cap-1", capability: "cap-1.secret", attemptId: null };

function wire(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    capabilityId: "cap-1",
    checkout: { ...projection, ...overrides },
  };
}

describe("guest checkout protocol and recovery", () => {
  it("bounds return-page status checks without changing checkout state", () => {
    expect(MAX_GUEST_CHECKOUT_STATUS_CHECKS).toBe(5);
    expect(canRetryGuestCheckoutStatus(0)).toBe(true);
    expect(canRetryGuestCheckoutStatus(MAX_GUEST_CHECKOUT_STATUS_CHECKS - 1)).toBe(true);
    expect(canRetryGuestCheckoutStatus(MAX_GUEST_CHECKOUT_STATUS_CHECKS)).toBe(false);
    expect(canRetryGuestCheckoutStatus(-1)).toBe(false);
    expect(canRetryGuestCheckoutStatus(1.5)).toBe(false);
  });

  it("does not mint a capability when server admission is closed", async () => {
    let calls = 0;
    const controller = createGuestCheckoutController({
      admitted: false,
      storage: storage(),
      transport: {
        fetch: async () => {
          calls += 1;
          return Response.json(wire());
        },
      },
    });

    expect((await controller.prepare()).failure).toBe("storage-unavailable");
    expect(calls).toBe(0);
  });

  it("accepts the exact wrapped Commerce wire result and retains the original opaque capability", () => {
    const result = parseGuestCheckoutWireResult({
      success: true,
      data: {
        ok: true,
        capabilityId: "cap-1",
        capability: {
          capabilityId: "cap-1",
          capability: "cap-1.secret",
          retention: "json-body",
          header: "x-commerce-guest-capability",
        },
        checkout: projection,
      },
    });
    expect(result?.ok).toBe(true);
    const saved = retainGuestCheckoutCapability(storage(), result!);
    expect(saved?.capability).toBe("cap-1.secret");
    expect(saved?.attemptId).toBeNull();
  });

  it("rejects forged, wrong-shape, and altered capability presentations", () => {
    expect(parseGuestCheckoutWireResult({ ok: true, capabilityId: "cap-1" })).toBeNull();
    expect(parseGuestCheckoutWireResult({
      ok: true,
      capabilityId: "cap-1",
      capability: {
        capabilityId: "cap-1",
        capability: "forged.secret",
        retention: "cookie",
        header: "x-commerce-guest-capability",
      },
      checkout: projection,
    })).toBeNull();
    expect(readGuestCheckoutRetention(null)).toBeNull();
    expect(readGuestCheckoutRetention(storage())).toBeNull();
    const corrupt = storage();
    corrupt.setItem(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY, "{corrupt");
    expect(readGuestCheckoutRetention(corrupt)).toBeNull();
  });

  it("updates only the retained attempt association and never treats a return URL as payment", () => {
    const savedStorage = storage();
    const prepared = parseGuestCheckoutWireResult({
      ok: true,
      capabilityId: "cap-1",
      capability: {
        capabilityId: "cap-1",
        capability: "cap-1.secret",
        retention: "json-body",
        header: "x-commerce-guest-capability",
      },
      checkout: projection,
    })!;
    retainGuestCheckoutCapability(savedStorage, prepared);
    const started = parseGuestCheckoutWireResult({
      ok: true,
      capabilityId: "cap-1",
      checkout: { ...projection, state: "pending", attemptId: "attempt-1" },
    })!;
    expect(updateGuestCheckoutAttempt(savedStorage, started)).toMatchObject({
      capabilityId: "cap-1",
      attemptId: "attempt-1",
    });
    const unpaid = parseGuestCheckoutWireResult({
      ok: true,
      capabilityId: "cap-1",
      checkout: { ...projection, state: "pending", attemptId: "attempt-1" },
    });
    expect(checkoutCanConfirm(unpaid)).toBe(false);
    expect(strictStripeCheckoutUrl("https://example.test/paid")).toBeNull();
    expect(strictStripeCheckoutUrl("https://checkout.stripe.com/c/pay/cs_test")).toMatch(
      /^https:\/\/checkout\.stripe\.com\//,
    );
  });

  it("posts only browser intent and preserves the original capability on reload/retry", async () => {
    const calls: Array<{ endpoint: string; body: string; capability: string | null }> = [];
    const result = await callGuestCheckout(
      {
        kind: "start",
        intent: { version: 1, lines: [{ id: "item-1", quantity: 2 }] },
        couponCode: "SAVE10",
        contact: {
          email: "shopper@example.test",
          delivery: {
            name: "Shopper",
            line1: "1 Example Way",
            city: "Testville",
            postalCode: "00000",
            country: "US",
          },
        },
      },
      { capabilityId: "cap-1", capability: "cap-1.secret", attemptId: null },
      {
        fetch: async (endpoint, init) => {
          calls.push({
            endpoint,
            body: String(init.body),
            capability: new Headers(init.headers).get("x-commerce-guest-capability"),
          });
          return Response.json({ ok: true, capabilityId: "cap-1", checkout: projection });
        },
      },
    );
    expect(result.failure).toBeNull();
    expect(calls[0]).toMatchObject({
      endpoint: `/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/checkout/guest/start`,
      capability: "cap-1.secret",
    });
    expect(JSON.parse(calls[0]!.body)).toEqual({
      lines: [{ catalogItemId: "item-1", quantity: 2 }],
      couponCode: "SAVE10",
      contact: {
        email: "shopper@example.test",
        delivery: {
          name: "Shopper",
          line1: "1 Example Way",
          city: "Testville",
          postalCode: "00000",
          country: "US",
        },
      },
    });
  });

  it("fails closed before start when capability retention is unavailable", async () => {
    const result = await callGuestCheckout(
      { kind: "start", intent: { version: 1, lines: [{ id: "item-1", quantity: 1 }] } },
      null,
      { fetch: async () => { throw new Error("must not call"); } },
    );
    expect(result.failure).toBe("storage-unavailable");
    expect(result.result).toBeNull();
    expect(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY).toBe("dinkus.guest-checkout.v1");
  });

  it("rejects paid responses without a canonical order and rejects mismatched associations", async () => {
    expect(parseGuestCheckoutWireResult(wire({
      state: "paid",
      order: { orderId: "", receiptId: "receipt-1" },
    }))).toBeNull();
    expect(checkoutCanConfirm(parseGuestCheckoutWireResult(wire({
      state: "paid",
      order: { orderId: "order-1", receiptId: "receipt-1" },
    })))).toBe(false);
    const wrongCapability = await callGuestCheckout(
      { kind: "start", intent: { version: 1, lines: [{ id: "item-1", quantity: 1 }] } },
      retention,
      { fetch: async () => Response.json({ ...wire(), capabilityId: "cap-2" }) },
    );
    expect(wrongCapability.failure).toBe("association");
    const wrongAttempt = await callGuestCheckout(
      { kind: "status", attemptId: "attempt-1" },
      { ...retention, attemptId: "attempt-1" },
      { fetch: async () => Response.json(wire({ attemptId: "attempt-2" })) },
    );
    expect(wrongAttempt.failure).toBe("association");
  });

  it("requires successful bounded responses and sends same-origin no-store requests", async () => {
    let init: RequestInit | undefined;
    const success = await callGuestCheckout(
      { kind: "start", intent: { version: 1, lines: [{ id: "item-1", quantity: 1 }] } },
      retention,
      {
        fetch: async (_endpoint, requestInit) => {
          init = requestInit;
          return Response.json(wire());
        },
      },
    );
    expect(success.failure).toBeNull();
    expect(init).toMatchObject({ cache: "no-store", credentials: "same-origin", redirect: "error" });
    expect((await callGuestCheckout(
      { kind: "start", intent: { version: 1, lines: [{ id: "item-1", quantity: 1 }] } },
      retention,
      { fetch: async () => new Response("no", { status: 502 }) },
    )).failure).toBe("http");
    expect((await callGuestCheckout(
      { kind: "start", intent: { version: 1, lines: [{ id: "item-1", quantity: 1 }] } },
      retention,
      { fetch: async () => new Response("x".repeat(65 * 1024), { status: 200 }) },
    )).failure).toBe("response-too-large");
  });

  it("keeps Commerce refusal reasons from a non-2xx response", async () => {
    const refused = await callGuestCheckout(
      { kind: "start", intent: { version: 1, lines: [{ id: "item-1", quantity: 1 }] } },
      retention,
      {
        fetch: async () => Response.json(
          { ok: false, error: { code: "INVALID_CART", message: "Delivery address is required" } },
          { status: 400 },
        ),
      },
    );
    expect(refused.failure).toBeNull();
    expect(refused.result).toEqual({
      ok: false,
      error: { code: "INVALID_CART", message: "Delivery address is required" },
    });
  });

  it("preserves the original attempt through timeout and reload, requiring status before retry", async () => {
    const saved = storage();
    retainGuestCheckoutCapability(saved, parseGuestCheckoutWireResult({
      ok: true,
      capabilityId: "cap-1",
      capability: {
        capabilityId: "cap-1",
        capability: "cap-1.secret",
        retention: "json-body",
        header: "x-commerce-guest-capability",
      },
      checkout: projection,
    })!);
    let calls = 0;
    const controller = createGuestCheckoutController({
      admitted: true,
      storage: saved,
      transport: {
        fetch: async () => {
          calls += 1;
          if (calls === 1) return Response.json(wire());
          if (calls === 2) throw new DOMException("timed out", "TimeoutError");
          return Response.json(wire({ attemptId: "attempt-1" }));
        },
      },
    });
    expect((await controller.prepare()).failure).toBe("attempt-active");
    expect((await controller.start({ version: 1, lines: [{ id: "item-1", quantity: 1 }] })).failure).toBe("attempt-active");
    expect(calls).toBe(0);
    await controller.status();
    const start = await controller.start({ version: 1, lines: [{ id: "item-1", quantity: 1 }] });
    expect(start.failure).toBe("timeout");
    expect(readGuestCheckoutRetention(saved)?.attemptId).toBeNull();
    expect((await controller.start({ version: 1, lines: [{ id: "item-1", quantity: 1 }] })).failure).toBe("attempt-active");
    const reloaded = createGuestCheckoutController({ admitted: true, storage: saved, transport: { fetch: async () => { throw new Error("must check status first"); } } });
    expect((await reloaded.start({ version: 1, lines: [{ id: "item-1", quantity: 1 }] })).failure).toBe("attempt-active");
    const statusBeforeRetry = await controller.status();
    expect(statusBeforeRetry.result?.ok).toBe(true);
    expect(readGuestCheckoutRetention(saved)?.attemptId).toBe("attempt-1");
    expect((await controller.start({ version: 1, lines: [{ id: "item-1", quantity: 1 }] })).failure)
      .toBe("attempt-active");
  });

  it("retries only after an authoritative release while retaining the original capability and released attempt", async () => {
    const saved = storage();
    saved.setItem(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY, JSON.stringify({ ...retention, attemptId: "attempt-1" }));
    const calls: Array<{ endpoint: string; init: RequestInit }> = [];
    const controller = createGuestCheckoutController({ admitted: true, storage: saved, transport: {
      fetch: async (endpoint, init) => {
        calls.push({ endpoint, init });
        return Response.json(wire(calls.length === 1
          ? { state: "released-retry", attemptId: "attempt-1", retryAfter: "attempt-1" }
          : { state: "pending", attemptId: "attempt-2" }));
      },
    } });
    await controller.status();
    expect(readGuestCheckoutRetention(saved)?.attemptId).toBe("attempt-1");
    expect(controller.canStart()).toBe(true);
    expect((await controller.start({ version: 1, lines: [{ id: "item-1", quantity: 1 }] })).failure).toBeNull();
    expect(calls).toHaveLength(2);
    expect(new Headers(calls[1]!.init.headers).get("x-commerce-guest-capability")).toBe("cap-1.secret");
    expect(readGuestCheckoutRetention(saved)).toEqual({ ...retention, attemptId: "attempt-2" });
    expect(controller.canStart()).toBe(false);
  });

  it("does not replace corrupt saved capabilities or lose Core errors and refuses forged release fences", async () => {
    const saved = storage();
    saved.setItem(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY, "invalid");
    const controller = createGuestCheckoutController({ admitted: true, storage: saved, transport: { fetch: async () => { throw new Error("must not mint"); } } });
    expect((await controller.prepare()).failure).toBe("attempt-active");
    saved.setItem(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY, JSON.stringify({ ...retention, attemptId: "attempt-1" }));
    const checking = createGuestCheckoutController({ admitted: true, storage: saved, transport: { fetch: async () => Response.json({ ok: false, error: { code: "UNAVAILABLE", message: "Unavailable" } }) } });
    expect((await checking.status()).result).toMatchObject({ ok: false });
    expect(readGuestCheckoutRetention(saved)?.attemptId).toBe("attempt-1");
    expect(checking.canStart()).toBe(false);
    expect(parseGuestCheckoutWireResult(wire({ state: "released-retry", attemptId: "attempt-1", retryAfter: "attempt-2" }))).toBeNull();
  });

  it("recovers a lost successor response from the current capability after reload, not the released parent hint", async () => {
    const saved = storage();
    saved.setItem(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY, JSON.stringify({ ...retention, attemptId: "attempt-1" }));
    const first = createGuestCheckoutController({ admitted: true, storage: saved, transport: {
      fetch: async (endpoint) => {
        if (endpoint.endsWith("/status")) return Response.json(wire({ state: "released-retry", attemptId: "attempt-1", retryAfter: "attempt-1" }));
        throw new DOMException("response lost", "TimeoutError");
      },
    } });
    await first.status();
    expect((await first.start({ version: 1, lines: [{ id: "item-1", quantity: 1 }] })).failure).toBe("timeout");
    expect(readGuestCheckoutRetention(saved)).toEqual({ ...retention, attemptId: "attempt-1", awaitingStart: true });
    let requestedBody: unknown;
    const reloaded = createGuestCheckoutController({ admitted: true, storage: saved, transport: {
      fetch: async (_endpoint, init) => {
        requestedBody = JSON.parse(String(init.body));
        return Response.json(wire({ attemptId: "attempt-2" }));
      },
    } });
    expect((await reloaded.start({ version: 1, lines: [{ id: "item-1", quantity: 1 }] })).failure).toBe("attempt-active");
    await reloaded.status();
    expect(requestedBody).toEqual({});
    expect(readGuestCheckoutRetention(saved)).toEqual({ ...retention, attemptId: "attempt-2" });
    expect(reloaded.canStart()).toBe(false);
  });

  it("fails closed when capability persistence fails and validates Stripe redirect authority", () => {
    const failingStorage: GuestCheckoutRetentionStorage = {
      getItem: () => null,
      setItem: () => { throw new Error("quota"); },
    };
    const prepared = parseGuestCheckoutWireResult({
      ok: true,
      capabilityId: "cap-1",
      capability: {
        capabilityId: "cap-1",
        capability: "cap-1.secret",
        retention: "json-body",
        header: "x-commerce-guest-capability",
      },
      checkout: projection,
    })!;
    expect(retainGuestCheckoutCapability(failingStorage, prepared)).toBeNull();
    expect(strictStripeCheckoutUrl("https://checkout.stripe.com:444/pay")).toBeNull();
  });

  it("offers the hosted-checkout retry link only for retryable, unconfirmed statuses with a redirect", () => {
    const redirectUrl = "https://checkout.stripe.com/c/pay/cs_test_retry";
    const parse = (overrides: Record<string, unknown>) => parseGuestCheckoutWireResult(wire(overrides));
    expect(guestCheckoutRetryUrl(parse({ state: "recoverable-failure", attemptId: "att-1", redirectUrl })))
      .toBe(redirectUrl);
    expect(guestCheckoutRetryUrl(parse({ state: "pending", attemptId: "att-1", redirectUrl }))).toBe(redirectUrl);
    // Confirmed orders never show retry.
    expect(guestCheckoutRetryUrl(parse({
      state: "paid",
      attemptId: "att-1",
      redirectUrl,
      order: { orderId: "order:1", receiptId: "receipt:1", lines: [] },
    }))).toBeNull();
    // Released attempts restart from the cart instead.
    expect(guestCheckoutRetryUrl(parse({
      state: "released-retry", attemptId: "att-1", retryAfter: "att-1", redirectUrl,
    }))).toBeNull();
    // No redirect, non-Stripe redirect, Commerce refusal, or no result at all (tokenless return).
    expect(guestCheckoutRetryUrl(parse({ state: "recoverable-failure", attemptId: "att-1" }))).toBeNull();
    expect(guestCheckoutRetryUrl(parse({
      state: "recoverable-failure", attemptId: "att-1", redirectUrl: "https://evil.example/pay",
    }))).toBeNull();
    expect(guestCheckoutRetryUrl({ ok: false, error: { code: "ORDER_NOT_FOUND", message: "x" } } as never)).toBeNull();
    expect(guestCheckoutRetryUrl(null)).toBeNull();
  });
});

describe("retained checkout with unavailable advisory readiness", () => {
  it("requires authoritative status before resuming and never prepares a new capability", async () => {
    const saved = storage();
    saved.setItem(GUEST_CHECKOUT_CAPABILITY_STORAGE_KEY, JSON.stringify(retention));
    const calls: string[] = [];
    const controller = createGuestCheckoutController({ admitted: false, storage: saved, transport: {
      fetch: async (endpoint) => {
        calls.push(endpoint);
        return Response.json(endpoint.endsWith("/status") ? wire() : wire({ attemptId: "attempt-1" }));
      },
    } });
    expect((await controller.prepare()).failure).toBe("storage-unavailable");
    expect((await controller.start({ version: 1, lines: [{ id: "item-1", quantity: 1 }] })).failure).toBeTruthy();
    expect(calls).toHaveLength(0);
    expect((await controller.status()).result?.ok).toBe(true);
    expect(controller.canStart()).toBe(true);
    expect((await controller.start({ version: 1, lines: [{ id: "item-1", quantity: 1 }] })).result?.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(readGuestCheckoutRetention(saved)).toEqual({ ...retention, attemptId: "attempt-1" });
    expect(controller.canStart()).toBe(false);
  });
});

describe("order confirmation receipt enrichment (garment thumbnails, variants, and shipping destination)", () => {
  it("resolves line thumbnails from explicit safe URLs or catalog snapshots and returns null when media is missing", () => {
    expect(resolveOrderLineThumbnail({
      id: "item-1",
      name: "Studio Hoodie",
      imageUrl: "/images/products/hoodie.svg",
      imageAlt: "Studio Hoodie front",
    })).toEqual({
      src: "/images/products/hoodie.svg",
      alt: "Studio Hoodie front",
    });
    expect(resolveOrderLineThumbnail({
      id: "demo-hoodie",
      name: "Heavyweight Hoodie",
    })).toBeNull();
    expect(resolveOrderLineThumbnail({
      id: "demo-cap",
      name: "Canvas Cap",
    })).toBeNull();
    expect(resolveOrderLineThumbnail({
      id: "fixture-shirt",
      name: "Synthetic fixture shirt",
    })).toBeNull();
    const snapshotMap = new Map([
      [
        "fixture-shirt",
        {
          id: "fixture-shirt",
          found: true as const,
          name: "Synthetic fixture shirt",
          sku: "FIXTURE",
          thumbnail: { src: "/images/products/shirt.svg", alt: "Synthetic fixture shirt photo" },
          price: { listable: true, regularText: "$24.00", saleText: null, unitMinor: "2400" },
          availability: { status: "in-stock", sellable: true, listable: true },
        },
      ],
    ]);
    expect(resolveOrderLineThumbnail({
      id: "fixture-shirt",
      name: "Synthetic fixture shirt",
    }, snapshotMap)).toEqual({
      src: "/images/products/shirt.svg",
      alt: "Synthetic fixture shirt photo",
    });
  });

  it("extracts Commerce variantSelections and safe thumbnails onto confirmed order lines", () => {
    const parsed = parseGuestCheckoutWireResult(wire({
      state: "paid",
      attemptId: "attempt-paid",
      variantSelections: [
        {
          catalogItemId: "fixture-shirt",
          productId: "prod-1",
          selections: [
            { optionId: "size", optionLabel: "Size", valueId: "l", valueLabel: "Large" },
            { optionId: "color", optionLabel: "Color", valueId: "oat", valueLabel: "Oatmeal" },
          ],
          fulfillment: "physical",
        },
      ],
      order: {
        orderId: "order:paid-1",
        receiptId: "receipt:paid-1",
        lines: [
          {
            catalogItemId: "fixture-shirt",
            quantity: 1,
            name: "Synthetic fixture shirt",
            imageUrl: "/images/products/shirt.svg",
            imageAlt: "Synthetic fixture shirt front view",
            sku: "FIXTURE-SHIRT-L",
            unitPrice: { currency: "USD", minor: "2400" },
          },
          {
            catalogItemId: "unsafe-thumb",
            quantity: 1,
            name: "Unsafe image item",
            imageUrl: "javascript:alert(1)",
            variant: "One Size",
          },
          {
            catalogItemId: "backslash-thumb",
            quantity: 1,
            name: "Backslash path item",
            imageUrl: "/images\\secret.png",
          },
          {
            catalogItemId: "credential-thumb",
            quantity: 1,
            name: "Credential URL item",
            imageUrl: "https://user:pass@example.com/a.png",
          },
          {
            catalogItemId: "encoded-traversal-thumb",
            quantity: 1,
            name: "Encoded traversal item",
            imageUrl: "/images/%2e%2e/secret.png",
          },
        ],
        total: { currency: "USD", minor: "2400" },
      },
    }));
    expect(parsed?.ok).toBe(true);
    if (!parsed?.ok) return;
    expect(parsed.checkout.order?.lines).toEqual([
      {
        id: "fixture-shirt",
        quantity: 1,
        name: "Synthetic fixture shirt",
        variant: "Size: Large / Color: Oatmeal",
        imageUrl: "/images/products/shirt.svg",
        imageAlt: "Synthetic fixture shirt front view",
        sku: "FIXTURE-SHIRT-L",
        unitPrice: { currency: "USD", minor: "2400" },
      },
      {
        id: "unsafe-thumb",
        quantity: 1,
        name: "Unsafe image item",
        variant: "One Size",
      },
      {
        id: "backslash-thumb",
        quantity: 1,
        name: "Backslash path item",
      },
      {
        id: "credential-thumb",
        quantity: 1,
        name: "Credential URL item",
      },
      {
        id: "encoded-traversal-thumb",
        quantity: 1,
        name: "Encoded traversal item",
      },
    ]);
  });

  it("retains checkout contact across start and status and resolves the confirmed shipping destination", async () => {
    const saved = storage();
    const contact = {
      email: "shopper@example.test",
      delivery: {
        name: "Ada Lovelace",
        line1: "12 Analytical Way",
        line2: "Suite 4",
        city: "Portland",
        region: "OR",
        postalCode: "97201",
        country: "US",
      },
    };
    const controller = createGuestCheckoutController({
      admitted: true,
      storage: saved,
      transport: {
        fetch: async (endpoint) => {
          if (endpoint.endsWith("/prepare")) {
            return Response.json({
              ok: true,
              capabilityId: "cap-1",
              capability: {
                capabilityId: "cap-1",
                capability: "cap-1.secret",
                retention: "json-body",
                header: "x-commerce-guest-capability",
              },
              checkout: projection,
            });
          }
          if (endpoint.endsWith("/start")) {
            return Response.json(wire({
              state: "pending",
              attemptId: "attempt-1",
              redirectUrl: "https://checkout.stripe.com/c/pay/cs_test_1",
            }));
          }
          return Response.json(wire({
            state: "paid",
            attemptId: "attempt-1",
            pricing: {
              merchandiseSubtotal: { currency: "USD", minor: "2400" },
              shipping: { mode: "flat", charge: { currency: "USD", minor: "500" } },
              finalTotal: { currency: "USD", minor: "2900" },
            },
            order: {
              orderId: "order:paid-1",
              receiptId: "receipt:paid-1",
              lines: [{ catalogItemId: "fixture-shirt", quantity: 1, name: "Synthetic fixture shirt" }],
              total: { currency: "USD", minor: "2900" },
            },
          }));
        },
      },
    });
    await controller.prepare();
    await controller.start({ version: 1, lines: [{ id: "fixture-shirt", quantity: 1 }] }, undefined, contact);
    const retainedAfterStart = readGuestCheckoutRetention(saved);
    expect(retainedAfterStart?.contact).toEqual(contact);

    const statusResponse = await controller.status();
    expect(statusResponse.result?.ok).toBe(true);
    const retainedAfterStatus = readGuestCheckoutRetention(saved);
    expect(retainedAfterStatus?.contact).toEqual(contact);

    const destination = resolveConfirmedOrderDestination(statusResponse.result!, retainedAfterStatus);
    expect(destination).toEqual({
      email: "shopper@example.test",
      recipient: "Ada Lovelace",
      address: "12 Analytical Way, Suite 4, Portland OR 97201, US",
      delivery: contact.delivery,
      shippingMethod: "Flat rate ($5.00)",
    });
    expect(formatConfirmedDeliveryAddress(contact.delivery)).toBe(
      "12 Analytical Way, Suite 4, Portland OR 97201, US",
    );
  });

  it("preserves all FEATURE_MAP selectors, destination summary, and shopper account link in GuestCheckoutReturn.astro", () => {
    const markup = readFileSync("src/features/guest-cart/GuestCheckoutReturn.astro", "utf8");
    for (const token of [
      "data-guest-checkout-return",
      'id="guest-checkout-return-title"',
      "data-guest-checkout-return-status",
      "data-guest-checkout-order",
      "data-guest-checkout-order-number",
      "data-guest-checkout-test",
      "data-guest-checkout-order-items",
      "data-guest-checkout-order-totals",
      "data-guest-checkout-destination",
      "data-guest-checkout-email",
      "data-guest-checkout-recipient",
      "data-guest-checkout-address",
      "data-guest-checkout-shipping-method",
      "data-guest-checkout-contact",
      "data-guest-checkout-retry",
      "data-guest-checkout-status-retry",
      'class="guest-checkout-continue"',
      'data-guest-checkout-account href="/account"',
    ]) {
      expect(markup).toContain(token);
    }
  });
});
