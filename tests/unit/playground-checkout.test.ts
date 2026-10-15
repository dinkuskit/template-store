import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkoutLimited,
  checkoutRouteKind,
  isCheckoutEnabled,
  offersCheckout,
  getStorePass,
  resetStorePassCache,
  SANDBOX_RATE_LIMITED_MESSAGE,
  SANDBOX_CLIENT_IP_MESSAGE,
  readPaymentsConfig,
  SANDBOX_RATE_LIMIT_NOTICE,
  SANDBOX_TEST_CARD_NOTICE,
  showsSandboxCheckoutNotice,
  validateCheckoutBody,
  visitorIp,
} from "../../src/features/playground-checkout/index.js";
import { COMMERCE_REGISTRY_RUNTIME_ID } from "../../src/features/guest-cart/checkout-protocol.js";

const startPath = `/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/checkout/guest/start`;

describe("DINKUS_CHECKOUT_ENABLED gate", () => {
  it("is off by default and only exactly \"1\" enables it", () => {
    expect(isCheckoutEnabled({})).toBe(false);
    expect(isCheckoutEnabled({ DINKUS_CHECKOUT_ENABLED: "true" })).toBe(false);
    expect(isCheckoutEnabled({ DINKUS_CHECKOUT_ENABLED: "0" })).toBe(false);
    expect(isCheckoutEnabled({ DINKUS_CHECKOUT_ENABLED: "1" })).toBe(true);
  });

  it("keeps shipping stores as before and gates playground/demo on the flag", () => {
    for (const checkoutEnabled of [false, true]) {
      expect(offersCheckout({ profile: "shipping", isPlayground: false, checkoutEnabled })).toBe(true);
      expect(offersCheckout({ profile: "proof", isPlayground: false, checkoutEnabled })).toBe(false);
      expect(offersCheckout({ profile: "proof", isPlayground: true, checkoutEnabled })).toBe(checkoutEnabled);
      expect(offersCheckout({ profile: "shipping", isPlayground: true, checkoutEnabled })).toBe(checkoutEnabled);
      expect(offersCheckout({ profile: "proof", isPlayground: false, isDemo: true, checkoutEnabled })).toBe(checkoutEnabled);
    }
  });

  it("shows the sandbox notice only for playground/demo with the flag on", () => {
    expect(showsSandboxCheckoutNotice({ profile: "proof", isPlayground: true, checkoutEnabled: true })).toBe(true);
    expect(showsSandboxCheckoutNotice({ profile: "proof", isPlayground: true, checkoutEnabled: false })).toBe(false);
    expect(showsSandboxCheckoutNotice({ profile: "shipping", isPlayground: false, checkoutEnabled: true })).toBe(false);
  });
});

describe("sandbox checkout notice", () => {
  it("names the test card and the public per-visitor limit", () => {
    expect(SANDBOX_TEST_CARD_NOTICE).toContain("4242 4242 4242 4242");
    expect(SANDBOX_TEST_CARD_NOTICE).toMatch(/any future expiry/);
    expect(SANDBOX_TEST_CARD_NOTICE).toMatch(/any CVC/);
    expect(SANDBOX_RATE_LIMIT_NOTICE).toBe("Each visitor is limited to 3 checkouts per 10 minutes.");
  });

  it("renders both notices on the cart and never pre-fills card fields", () => {
    const notice = readFileSync("src/features/playground-checkout/SandboxCheckoutNotice.astro", "utf8");
    expect(notice).toContain("{SANDBOX_TEST_CARD_NOTICE}");
    expect(notice).toContain("{SANDBOX_RATE_LIMIT_NOTICE}");
    expect(notice).not.toMatch(/<input|<form/);
    const cart = readFileSync("src/pages/cart.astro", "utf8");
    expect(cart).toContain("{sandboxCheckout && <SandboxCheckoutNotice />}");
    for (const file of ["src/pages/cart.astro", "src/features/guest-cart/GuestCart.astro", "src/features/playground-checkout/index.ts"]) {
      expect(readFileSync(file, "utf8")).not.toMatch(/cc-number|card-number|value="4242/i);
    }
  });
});

describe("checkout body validation", () => {
  const valid = JSON.stringify({ lines: [{ catalogItemId: "item_1", quantity: 2 }] });

  it("recognizes only the guest checkout routes", () => {
    expect(checkoutRouteKind(startPath)).toBe("start");
    expect(checkoutRouteKind(startPath.replace("start", "prepare"))).toBe("prepare");
    expect(checkoutRouteKind(`${startPath}/x`)).toBeNull();
    expect(checkoutRouteKind("/_emdash/api/plugins/dinkus-commerce/checkout/guest/start")).toBe("start");
    expect(checkoutRouteKind("/_emdash/api/plugins/other/checkout/guest/start")).toBeNull();
    expect(checkoutRouteKind("/cart")).toBeNull();
  });

  it("accepts ids and quantities, with optional contact", () => {
    expect(validateCheckoutBody("start", valid)).toEqual({ ok: true });
    expect(validateCheckoutBody("start", JSON.stringify({
      lines: [{ catalogItemId: "item_1", quantity: 1 }],
      contact: { email: "a@example.test", delivery: { name: "A", line1: "1 St", city: "X", postalCode: "1", country: "US" } },
    }))).toEqual({ ok: true });
    expect(validateCheckoutBody("prepare", "{}")).toEqual({ ok: true });
    expect(validateCheckoutBody("status", JSON.stringify({ attemptId: "att_1" }))).toEqual({ ok: true });
  });

  it("rejects client prices, unknown fields and malformed carts", () => {
    const bad = [
      JSON.stringify({ lines: [{ catalogItemId: "item_1", quantity: 1, price: 1 }] }),
      JSON.stringify({ lines: [{ catalogItemId: "item_1", quantity: 1 }], amount: { minor: "1" } }),
      JSON.stringify({ lines: [] }),
      JSON.stringify({ lines: [{ catalogItemId: "../x", quantity: 1 }] }),
      JSON.stringify({ lines: [{ catalogItemId: "item_1", quantity: 0 }] }),
      JSON.stringify({ lines: [{ catalogItemId: "item_1", quantity: 100 }] }),
      JSON.stringify({ lines: [{ catalogItemId: "a", quantity: 1 }, { catalogItemId: "a", quantity: 1 }] }),
      JSON.stringify({ lines: Array.from({ length: 41 }, (_, i) => ({ catalogItemId: `i${i}`, quantity: 1 })) }),
      JSON.stringify({ lines: [{ catalogItemId: "a", quantity: 1 }], contact: { email: "nope" } }),
      "not json",
      "[]",
      `{"lines":[${"x".repeat(5000)}]}`,
    ];
    for (const body of bad) expect(validateCheckoutBody("start", body).ok).toBe(false);
    expect(validateCheckoutBody("prepare", JSON.stringify({ price: 1 })).ok).toBe(false);
    expect(validateCheckoutBody("status", JSON.stringify({ attemptId: "", x: 1 })).ok).toBe(false);
  });

  it("fails closed when the limiter is missing or denies", async () => {
    const request = new Request("https://p.test/x", { headers: { "cf-connecting-ip": "1.2.3.4" } });
    expect(await checkoutLimited(request, undefined)).toBe(true);
    expect(await checkoutLimited(request, { limit: async () => ({ success: false }) })).toBe(true);
    const limit = vi.fn(async () => ({ success: true }));
    expect(await checkoutLimited(request, { limit })).toBe(false);
    expect(limit).toHaveBeenCalledWith({ key: "checkout:1.2.3.4" });
  });

  it("guards checkout routes in middleware before seeding the playground DB", () => {
    const middleware = readFileSync("src/middleware.ts", "utf8");
    expect(middleware.indexOf("guardSandboxCheckout(context.request"))
      .toBeLessThan(middleware.indexOf("await ensurePlaygroundDemoCatalog(db)"));
    expect(middleware.indexOf("guardSandboxCheckout(context.request"))
      .toBeLessThan(middleware.indexOf("withCheckoutVisitor("));
  });
});

describe("Payments config and store pass", () => {
  const storeKey = `dk_store_${"a".repeat(43)}`;
  const config = { baseUrl: "https://payments.example", storeKey };
  const passFetchImpl = vi.fn(async () => Response.json({ access_token: "h.p.s", token_type: "Bearer", expires_in: 300 }));
  beforeEach(() => { resetStorePassCache(); passFetchImpl.mockClear(); });

  it("reads PAYMENTS_URL and PAYMENTS_STORE_KEY, https and dk_store_ only", () => {
    expect(readPaymentsConfig({})).toBeNull();
    expect(readPaymentsConfig({ PAYMENTS_URL: "http://payments.example", PAYMENTS_STORE_KEY: storeKey })).toBeNull();
    expect(readPaymentsConfig({ PAYMENTS_URL: "https://payments.example/", PAYMENTS_STORE_KEY: "dk_store_short" })).toBeNull();
    expect(readPaymentsConfig({ PAYMENTS_URL: "https://payments.example/", PAYMENTS_CHECKOUT_TOKEN: "h.p.s" })).toBeNull();
    expect(readPaymentsConfig({ PAYMENTS_URL: "https://payments.example/", PAYMENTS_STORE_KEY: storeKey }))
      .toEqual({ baseUrl: "https://payments.example", storeKey });
  });

  it("trades the store key for a pass and caches it until 60 s before expiry", async () => {
    let now = 1_000_000;
    const deps = { fetchImpl: passFetchImpl as never, now: () => now };
    expect(await getStorePass(config, deps)).toBe("h.p.s");
    const [url, init] = passFetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://dinkuskit.com/api/store-passes");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${storeKey}`);
    expect(JSON.parse(init.body as string)).toEqual({ site_id: "playground", scope: "payments:checkout", audience: "dinkus-payments" });
    now += 239_000;
    expect(await getStorePass(config, deps)).toBe("h.p.s");
    expect(passFetchImpl).toHaveBeenCalledTimes(1);
    now += 2_000; // past expires_in - 60 s
    await getStorePass(config, deps);
    expect(passFetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the exchange fails or returns a bad pass, and never logs", async () => {
    const log = vi.spyOn(console, "error");
    const bad = [
      async () => Response.json({ error: "invalid_store_key" }, { status: 401 }),
      async () => Response.json({ error: "service_not_enabled" }, { status: 403 }),
      async () => Response.json({ access_token: "nope", token_type: "Bearer", expires_in: 300 }),
      async () => Response.json({ access_token: "h.p.s", token_type: "Bearer", expires_in: 30 }),
      async () => { throw new Error("network"); },
    ];
    for (const fetchImpl of bad) {
      resetStorePassCache();
      expect(await getStorePass(config, { fetchImpl: fetchImpl as never })).toBeNull();
    }
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("keeps the rate-limit and client-IP refusals local to the middleware", () => {
    expect(SANDBOX_RATE_LIMITED_MESSAGE).toContain("Each visitor is limited to 3 checkouts per 10 minutes.");
    expect(SANDBOX_CLIENT_IP_MESSAGE).toMatch(/try again/);
    expect(visitorIp(new Request("https://p.test/"))).toBeNull();
    expect(visitorIp(new Request("https://p.test/", { headers: { "cf-connecting-ip": "not an ip" } }))).toBeNull();
    expect(visitorIp(new Request("https://p.test/", { headers: { "cf-connecting-ip": "2001:db8::1" } }))).toBe("2001:db8::1");
    const middleware = readFileSync("src/middleware.ts", "utf8");
    expect(middleware).toContain("checkoutJsonError(429, SANDBOX_RATE_LIMITED_MESSAGE)");
    expect(middleware).toMatch(/kind === "start" && isPlayground && !visitorIp\(request\)\) \{\s*return checkoutJsonError\(400, SANDBOX_CLIENT_IP_MESSAGE\)/);
  });

  it("success page confirms only through Commerce's capability-scoped return controller", () => {
    const page = readFileSync("src/pages/checkout/success.astro", "utf8");
    expect(page).toContain("<GuestCheckoutReturn contactHref={contactHref} />");
    // No caller-selected Stripe session id is looked up under the shared playground credential.
    expect(page).not.toMatch(/session_id|lookupCheckoutReceipt|PAYMENTS_STORE_KEY|getStorePass/);
    expect(page).not.toMatch(/wakes\?|ackWake|wake-client/);
    expect(readFileSync("src/features/playground-checkout/index.ts", "utf8")).not.toContain("/v1/checkout/receipt");
  });
});

describe("playground flat-rate shipping", () => {
  it("is a flat USD Commerce shipping configuration (no Ship labels)", async () => {
    const source = readFileSync("src/features/playground/flat-rate-shipping.ts", "utf8");
    expect(source).toMatch(/PLAYGROUND_FLAT_RATE_SHIPPING = Object\.freeze\(\{\s*configurationId: "playground-flat-rate",\s*revision: 1,\s*mode: "flat" as const,\s*amount: Object\.freeze\(\{ currency: "USD" as const, minor: "500" \}\)/);
  });
});
