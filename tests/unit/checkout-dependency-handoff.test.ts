import { describe, expect, it } from "vitest";
import {
  CHECKOUT_COLLECTION,
  CHECKOUT_GUEST_CAPABILITY_COLLECTION,
  COMMERCE_PLUGIN_ID,
  CURRENT_PAYMENT_WINDOW,
  CURRENT_PAYMENT_WINDOW_MAX_SECONDS,
  CURRENT_PAYMENT_WINDOW_MIN_SECONDS,
  GUEST_CAPABILITY_HEADER,
  GUEST_CHECKOUT_DECLARED_HEADERS,
  GUEST_CHECKOUT_PREPARE_ROUTE,
  GUEST_CHECKOUT_START_ROUTE,
  GUEST_CHECKOUT_STATUS_ROUTE,
  GUEST_ORIGIN_HEADER,
  GUEST_SEC_FETCH_SITE_HEADER,
  GuestCheckoutError,
  LEGACY_EXACT_PAYMENT_WINDOW_SECONDS,
  PAYMENTS_CREATE_RETRY_BOUND_HOURS,
  PAYMENTS_SAFE_PROVIDER_DELAY_SECONDS,
  createCurrentPaymentRequest,
  createPlugin,
  dinkusCommerce,
  isCurrentPaymentRequest,
  isLegacyExact1800PaymentRequest,
  paymentRequestHandoff,
  providerSessionWindowIsValid,
  readFrozenPaymentWindowBounds,
  type LegacyExact1800PaymentRequest,
  type PaymentSession,
} from "@dinkuskit/commerce";

describe("checkout dependency handoff contracts", () => {
  it("exports exact approved payment window bounds matching Commerce PR #37 and Payments #5", () => {
    expect(CURRENT_PAYMENT_WINDOW_MIN_SECONDS).toBe(1800);
    expect(CURRENT_PAYMENT_WINDOW_MAX_SECONDS).toBe(1860);
    expect(LEGACY_EXACT_PAYMENT_WINDOW_SECONDS).toBe(1800);
    expect(PAYMENTS_CREATE_RETRY_BOUND_HOURS).toBe(23);
    expect(PAYMENTS_SAFE_PROVIDER_DELAY_SECONDS).toBe(60);
    expect(CURRENT_PAYMENT_WINDOW).toEqual({
      minSeconds: 1800,
      maxSeconds: 1860,
    });
  });

  it("constructs and distinguishes current bounded payment requests from legacy exact-1800 requests", () => {
    const current = createCurrentPaymentRequest({
      attemptId: "att-current-1",
      bindingRef: "test-binding",
      lines: [
        {
          catalogItemId: "item-1",
          name: "Test Item",
          quantity: 1,
          unitPrice: { currency: "USD", minor: "2000" },
        },
      ],
      total: { currency: "USD", minor: "2000" },
    });

    expect(isCurrentPaymentRequest(current)).toBe(true);
    expect(isLegacyExact1800PaymentRequest(current)).toBe(false);
    expect(current.paymentWindow).toEqual({ minSeconds: 1800, maxSeconds: 1860 });
    expect(current.paymentMethods).toEqual(["card"]);

    const legacy: LegacyExact1800PaymentRequest = {
      attemptId: "att-legacy-1",
      bindingRef: "test-binding",
      lines: [
        {
          catalogItemId: "item-1",
          name: "Test Item",
          quantity: 1,
          unitPrice: { currency: "USD", minor: "2000" },
        },
      ],
      total: { currency: "USD", minor: "2000" },
      paymentMethods: ["card"],
      paymentWindowSeconds: 1800,
    };

    expect(isCurrentPaymentRequest(legacy)).toBe(false);
    expect(isLegacyExact1800PaymentRequest(legacy)).toBe(true);

    const currentHandoff = paymentRequestHandoff(current);
    expect(currentHandoff).toEqual({
      kind: "current-bounded-1800-1860",
      request: current,
    });

    const legacyHandoff = paymentRequestHandoff(legacy);
    expect(legacyHandoff).toEqual({
      kind: "legacy-exact-1800",
      request: legacy,
    });

    const currentBounds = readFrozenPaymentWindowBounds(current);
    expect(currentBounds).toEqual({
      kind: "current-bounded-1800-1860",
      minSeconds: 1800,
      maxSeconds: 1860,
    });

    const legacyBounds = readFrozenPaymentWindowBounds(legacy);
    expect(legacyBounds).toEqual({
      kind: "legacy-exact-1800",
      minSeconds: 1800,
      maxSeconds: 1800,
    });
  });

  it("validates provider session windows strictly against the approved 1800..1860s boundary", () => {
    const current = createCurrentPaymentRequest({
      attemptId: "att-window-test",
      bindingRef: "test-binding",
      lines: [],
      total: { currency: "USD", minor: "0" },
    });

    const now = 1700000000;
    const session1800: PaymentSession = {
      sessionId: "sess-1800",
      redirectUrl: "https://checkout.stripe.test/sess-1800",
      createdAt: now,
      expiresAt: now + 1800,
    };
    const session1830: PaymentSession = {
      sessionId: "sess-1830",
      redirectUrl: "https://checkout.stripe.test/sess-1830",
      createdAt: now,
      expiresAt: now + 1830,
    };
    const session1860: PaymentSession = {
      sessionId: "sess-1860",
      redirectUrl: "https://checkout.stripe.test/sess-1860",
      createdAt: now,
      expiresAt: now + 1860,
    };
    const sessionUnder1800: PaymentSession = {
      sessionId: "sess-1799",
      redirectUrl: "https://checkout.stripe.test/sess-1799",
      createdAt: now,
      expiresAt: now + 1799,
    };
    const sessionOver1860: PaymentSession = {
      sessionId: "sess-1861",
      redirectUrl: "https://checkout.stripe.test/sess-1861",
      createdAt: now,
      expiresAt: now + 1861,
    };

    expect(providerSessionWindowIsValid(session1800, current)).toBe(true);
    expect(providerSessionWindowIsValid(session1830, current)).toBe(true);
    expect(providerSessionWindowIsValid(session1860, current)).toBe(true);
    expect(providerSessionWindowIsValid(sessionUnder1800, current)).toBe(false);
    expect(providerSessionWindowIsValid(sessionOver1860, current)).toBe(false);
  });

  it("enforces guest route identifiers and declared security headers", () => {
    expect(COMMERCE_PLUGIN_ID).toBe("dinkus-commerce");
    expect(GUEST_CHECKOUT_PREPARE_ROUTE).toBe("checkout/guest/prepare");
    expect(GUEST_CHECKOUT_START_ROUTE).toBe("checkout/guest/start");
    expect(GUEST_CHECKOUT_STATUS_ROUTE).toBe("checkout/guest/status");
    expect(CHECKOUT_COLLECTION).toBe("checkoutCarts");
    expect(CHECKOUT_GUEST_CAPABILITY_COLLECTION).toBe("checkoutGuestCapabilities");

    expect(GUEST_CAPABILITY_HEADER).toBe("x-commerce-guest-capability");
    expect(GUEST_ORIGIN_HEADER).toBe("origin");
    expect(GUEST_SEC_FETCH_SITE_HEADER).toBe("sec-fetch-site");
    expect(GUEST_CHECKOUT_DECLARED_HEADERS).toContain("x-commerce-guest-capability");
  });

  it("defines standard HTTP status mappings for guest checkout denial errors", () => {
    expect(new GuestCheckoutError("PAYMENTS_UNAVAILABLE").status).toBe(503);
    expect(new GuestCheckoutError("CAPABILITY_DENIED").status).toBe(403);
    expect(new GuestCheckoutError("INVALID_CART").status).toBe(400);
    expect(new GuestCheckoutError("ORIGIN_DENIED").status).toBe(403);
    expect(new GuestCheckoutError("UNAVAILABLE").status).toBe(503);
  });

  it("demonstrates runtime checkout option dropped in descriptor despite forward input vs createPlugin mounting", () => {
    const siteUrl = "http://127.0.0.1:20141";
    // Forward host input containing checkout option, typed via Parameters<typeof createPlugin>[0]
    const hostOptions: Parameters<typeof createPlugin>[0] = {
      siteUrl,
      enableLocalStockManagement: false,
      checkout: {
        paymentBindingRef: "fixture-binding",
        resolvePayments: async () => null,
      },
    };

    // 1. dinkusCommerce produces a pure EmDash plugin descriptor and readonly drops the checkout option
    const descriptor = dinkusCommerce(hostOptions as Parameters<typeof dinkusCommerce>[0]);
    expect(descriptor.id).toBe("dinkus-commerce");
    expect(descriptor.options?.siteUrl).toBe(siteUrl);
    expect(descriptor.options?.enableLocalStockManagement).toBe(false);
    expect(Object.hasOwn(descriptor.options ?? {}, "checkout")).toBe(false);
    expect("routes" in descriptor).toBe(false);

    // 2. createPlugin mounts all guest checkout routes and collections from runtime options
    const plugin = createPlugin(hostOptions);
    expect(plugin.routes[GUEST_CHECKOUT_PREPARE_ROUTE]).toBeDefined();
    expect(plugin.routes[GUEST_CHECKOUT_START_ROUTE]).toBeDefined();
    expect(plugin.routes[GUEST_CHECKOUT_STATUS_ROUTE]).toBeDefined();
    expect(plugin.storage[CHECKOUT_COLLECTION]).toBeDefined();
    expect(plugin.storage[CHECKOUT_GUEST_CAPABILITY_COLLECTION]).toBeDefined();

    // Route mounting registers HTTP route handlers, but does NOT supply an authenticated Payments bridge.
    // Host JSON serialization drops function properties (resolvePayments), ensuring native routes
    // fail closed with PAYMENTS_UNAVAILABLE (503) unless an in-process bridge is wired.
  });
});
