import { describe, expect, it } from "vitest";
import {
  createTrustedTestCheckoutHostAssembly,
  REGISTRY_HOST_INJECTION_LIMITATION,
  runScheduledWakeReconciliation,
  runWakeReconciliation,
  type TrustedTestCheckoutHostConfig,
} from "../../src/features/test-checkout-host/index.js";
import {
  createCheckoutPaymentAssociationPort,
  createCheckoutStore,
  startCheckout,
  type CheckoutPaymentAssociation,
  type CheckoutRecord,
  type PaymentRequest,
} from "@dinkuskit/commerce/features/checkout";

const TEST_PAYMENTS_ORIGIN = "https://payments.example.test";
const TEST_COMMERCE_ORIGIN = "https://shop.example.test";
const TEST_BINDING_REF = "stripe-test-binding";
const TEST_SITE_ID = "test-site-001";
const TEST_STRIPE_ACCOUNT = "acct_test_123";

const VALID_TRUSTED_CONFIG: TrustedTestCheckoutHostConfig = {
  paymentsOrigin: TEST_PAYMENTS_ORIGIN,
  commerceOrigin: TEST_COMMERCE_ORIGIN,
  siteId: TEST_SITE_ID,
  bindingRef: TEST_BINDING_REF,
  providerId: "stripe",
  stripeAccountId: TEST_STRIPE_ACCOUNT,
  credentialResolver: async () => "jwt-token-123",
  fetch: (async () => new Response("[]", { status: 200 })) as typeof fetch,
  limit: 25,
};

type CheckoutExecutionCandidate = Parameters<typeof startCheckout>[0];

function createMemoryCheckoutStore() {
  const data = new Map<string, { revision: string; value: CheckoutRecord }>();
  return createCheckoutStore({
    async getVersioned(id: string) {
      const row = data.get(id);
      return row ? { revision: row.revision, value: structuredClone(row.value) } : null;
    },
    async compareAndSet(id: string, expectedRevision: string | null, value: CheckoutRecord) {
      const current = data.get(id);
      const currentRevision = current?.revision ?? null;
      if (currentRevision !== expectedRevision) return { applied: false };
      const nextRevision = String(Number(expectedRevision ?? "0") + 1);
      data.set(id, { revision: nextRevision, value: structuredClone(value) });
      return { applied: true, revision: nextRevision };
    },
  });
}

function createMemoryAssociationPort() {
  const records = new Map<string, { revision: string; value: CheckoutPaymentAssociation }>();
  return createCheckoutPaymentAssociationPort({
    async get(attemptId: string) {
      const row = records.get(attemptId);
      return row ? structuredClone(row.value) : null;
    },
    async compareAndSet(
      id: string,
      expectedRevision: string | null,
      update: CheckoutPaymentAssociation,
    ) {
      const current = records.get(id);
      const currentRevision = current?.revision ?? null;
      if (currentRevision !== expectedRevision) return { applied: false };
      const nextRevision = String(Number(expectedRevision ?? "0") + 1);
      records.set(id, { revision: nextRevision, value: structuredClone(update) });
      return { applied: true, revision: nextRevision };
    },
  });
}

function createCollection<T extends Record<string, unknown>>(items: T[]) {
  const map = new Map<string, T>(
    items.map((i) => [String(i.recordId ?? i.itemId ?? i.catalogItemId), i]),
  );
  return {
    async get(id: string) {
      const item = map.get(id);
      return item ? structuredClone(item) : null;
    },
    async query() {
      return {
        items: [...map].map(([id, data]) => ({ id, data: structuredClone(data) })),
        hasMore: false,
      };
    },
  };
}

function createFixtureExecution(paymentLookupOutcome: "paid" | "open" | "unknown" = "paid") {
  const store = createMemoryCheckoutStore();
  const associations = createMemoryAssociationPort();

  const items = [
    {
      recordKind: "catalog-item",
      itemId: "one",
      name: "Product One",
      stockManagement: { mode: "unmanaged" },
    },
  ];

  const prices = [
    {
      recordKind: "catalog-price",
      recordId: "one",
      catalogItemId: "one",
      regular: { currency: "USD", minor: "1000" },
    },
  ];

  const catalog = {
    catalog: createCollection(items),
    prices: createCollection(prices),
    backorderPolicies: {
      ...createCollection([]),
      async put() {},
    },
    settings: createCollection([]),
    manualAvailability: {
      ...createCollection([]),
      async put() {},
    },
    configurations: createCollection([]),
  };

  let lookupOutcome = paymentLookupOutcome;

  const paymentPort = {
    async ensureSession(req: { attemptId: string; total: { currency: "USD"; minor: string } }) {
      return {
        outcome: "open" as const,
        attemptId: req.attemptId,
        total: req.total,
        session: {
          sessionId: "sess_123",
          redirectUrl: "https://checkout.stripe.com/pay",
          createdAt: 1000,
          expiresAt: 2800,
        },
      };
    },
    async lookup(req: { attemptId: string; total: { currency: "USD"; minor: string } }) {
      if (lookupOutcome === "unknown") {
        return { outcome: "unknown" as const };
      }
      return {
        outcome: lookupOutcome,
        attemptId: req.attemptId,
        total: req.total,
        session: {
          sessionId: "sess_123",
          redirectUrl: "https://checkout.stripe.com/pay",
          createdAt: 1000,
          expiresAt: 2800,
        },
        ...(lookupOutcome === "paid" ? { paymentId: "pi_test_123" } : {}),
      };
    },
  };

  const rawExecution = {
    store,
    catalog,
    availability: {
      resolveProvider: async () => ({
        async readSkuStock() {
          return { sellable: true };
        },
      }),
    },
    resolveInventory: async () => null,
    paymentAssociations: associations,
    paymentBindingRef: TEST_BINDING_REF,
    resolvePayments: async (ref: string) => {
      if (ref !== TEST_BINDING_REF) return null;
      return paymentPort;
    },
    now: () => 1727800000,
    createAttemptId: () => "att_canonical_123",
  };

  const execution = rawExecution as unknown as CheckoutExecutionCandidate;

  const cartInput = [
    {
      catalogItemId: "one",
      quantity: 1,
    },
  ];

  return {
    execution,
    associations,
    cartInput,
    setLookupOutcome(outcome: "paid" | "open" | "unknown") {
      lookupOutcome = outcome;
    },
  };
}

describe("Trusted Host Assembly (Finding 4)", () => {
  it("assembles checkout host and wake client sharing full trusted configuration", () => {
    const assembly = createTrustedTestCheckoutHostAssembly(VALID_TRUSTED_CONFIG);

    expect(assembly).toBeDefined();
    expect(assembly.config.paymentsOrigin).toBe(TEST_PAYMENTS_ORIGIN);
    expect(assembly.config.commerceOrigin).toBe(TEST_COMMERCE_ORIGIN);
    expect(assembly.config.siteId).toBe(TEST_SITE_ID);
    expect(assembly.config.bindingRef).toBe(TEST_BINDING_REF);
    expect(assembly.config.providerId).toBe("stripe");
    expect(assembly.config.stripeAccountId).toBe(TEST_STRIPE_ACCOUNT);

    expect(typeof assembly.checkoutHost.paymentBindingRef).toBe("string");
    expect(typeof assembly.checkoutHost.resolvePayments).toBe("function");
    expect(typeof assembly.wakePort.list).toBe("function");
    expect(typeof assembly.wakePort.acknowledge).toBe("function");
  });

  it("scheduled driver reports not_configured when configuration is absent", async () => {
    const result = await runScheduledWakeReconciliation();
    expect(result).toEqual({
      executed: false,
      reason: "not_configured",
      processedCount: 0,
      results: [],
    });
  });

  it("scheduled driver reports integration_limit_unsupported when execution bridge is absent", async () => {
    const result = await runScheduledWakeReconciliation({
      config: VALID_TRUSTED_CONFIG,
    });
    expect(result.executed).toBe(false);
    expect(result.reason).toBe("integration_limit_unsupported");
    expect(REGISTRY_HOST_INJECTION_LIMITATION).toBe(
      "INSTALLED_CHECKOUT_HOST_CONTEXT_NOT_ADMITTED",
    );
  });
});

describe("Canonical In-Memory CAS Wake Reconciliation", () => {
  it("stores the paid order in the in-memory CAS fixture before acknowledging", async () => {
    const { execution, associations, cartInput } = createFixtureExecution("paid");

    // 1. Start checkout to create attempt & association
    const started = await startCheckout(execution, "cart-test-1", cartInput);
    expect(started.phase).toBe("paying");
    expect(started.attemptId).toBe("att_canonical_123");

    // 2. Prepare wake
    const wake = {
      eventId: "evt_test_1",
      attemptId: started.attemptId,
      bindingRef: TEST_BINDING_REF,
      deliveryGeneration: 1,
      wokeAt: 1727800000000,
    };

    const acknowledgedWakes: string[] = [];
    const wakePort = {
      async list() {
        return [wake];
      },
      async acknowledge(w: typeof wake) {
        acknowledgedWakes.push(`${w.eventId}:${w.deliveryGeneration}`);
        return true;
      },
    };

    // 3. Run reconciliation via driver
    const results = await runWakeReconciliation(
      execution,
      associations,
      wakePort,
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("acknowledged");
    expect(acknowledgedWakes).toEqual(["evt_test_1:1"]);

    // 4. Verify the in-memory order (not disk/process restart durability)
    const stored = await execution.store.read("cart-test-1");
    const storedAttempt = stored?.record.attempts.find(
      (a: { attemptId: string }) => a.attemptId === started.attemptId,
    );
    expect(storedAttempt?.phase).toBe("paid");
    expect(storedAttempt?.order?.orderId).toBe(`order:${started.attemptId}`);
    expect(storedAttempt?.order?.attemptId).toBe(started.attemptId);
  });

  it("handles duplicate wakes in one in-memory batch without cloning orders", async () => {
    const { execution, associations, cartInput } = createFixtureExecution("paid");
    const started = await startCheckout(execution, "cart-test-duplicate", cartInput);

    const wake = {
      eventId: "evt_dup_1",
      attemptId: started.attemptId,
      bindingRef: TEST_BINDING_REF,
      deliveryGeneration: 1,
      wokeAt: 1727800000000,
    };

    let ackCount = 0;
    const wakePort = {
      async list() {
        return [wake, wake]; // duplicate wakes in same batch
      },
      async acknowledge() {
        ackCount++;
        return true;
      },
    };

    const results = await runWakeReconciliation(
      execution,
      associations,
      wakePort,
    );

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("acknowledged");
    expect(results[1].status).toBe("acknowledged");
    expect(ackCount).toBe(2);

    // Stored order is still the single deterministic order (no cloned orders)
    const stored = await execution.store.read("cart-test-duplicate");
    expect(stored?.record.attempts).toHaveLength(1);
    expect(stored?.record.attempts[0].phase).toBe("paid");
  });

  it("retains wake without acknowledgement when attempt association is missing", async () => {
    const { execution, associations } = createFixtureExecution("paid");

    const unassociatedWake = {
      eventId: "evt_unknown_1",
      attemptId: "att_nonexistent",
      bindingRef: TEST_BINDING_REF,
      deliveryGeneration: 1,
      wokeAt: 1727800000000,
    };

    let ackCalled = false;
    const wakePort = {
      async list() {
        return [unassociatedWake];
      },
      async acknowledge() {
        ackCalled = true;
        return true;
      },
    };

    const results = await runWakeReconciliation(
      execution,
      associations,
      wakePort,
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("retained");
    expect(results[0].status === "retained" && results[0].reason).toBe("missing");
    expect(ackCalled).toBe(false);
  });

  it("retains wake without acknowledgement when payment outcome is open or unknown", async () => {
    const { execution, associations, cartInput } = createFixtureExecution("open");

    const started = await startCheckout(execution, "cart-test-open", cartInput);

    const wake = {
      eventId: "evt_open_1",
      attemptId: started.attemptId,
      bindingRef: TEST_BINDING_REF,
      deliveryGeneration: 1,
      wokeAt: 1727800000000,
    };

    let ackCalled = false;
    const wakePort = {
      async list() {
        return [wake];
      },
      async acknowledge() {
        ackCalled = true;
        return true;
      },
    };

    // Lookup returns "open" -> not terminal paid
    const results = await runWakeReconciliation(
      execution,
      associations,
      wakePort,
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("retained");
    expect(results[0].status === "retained" && results[0].reason).toBe("unknown");
    expect(ackCalled).toBe(false);
  });

  it("retains wake without acknowledgement on bindingRef mismatch", async () => {
    const { execution, associations, cartInput } = createFixtureExecution("paid");
    const started = await startCheckout(execution, "cart-test-mismatch", cartInput);

    const mismatchedWake = {
      eventId: "evt_mismatch_1",
      attemptId: started.attemptId,
      bindingRef: "other-foreign-binding",
      deliveryGeneration: 1,
      wokeAt: 1727800000000,
    };

    let ackCalled = false;
    const wakePort = {
      async list() {
        return [mismatchedWake];
      },
      async acknowledge() {
        ackCalled = true;
        return true;
      },
    };

    const results = await runWakeReconciliation(
      execution,
      associations,
      wakePort,
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("retained");
    expect(results[0].status === "retained" && results[0].reason).toBe("mismatch");
    expect(ackCalled).toBe(false);
  });

  it("retains wake without acknowledgement on invalid or stale deliveryGeneration", async () => {
    const { execution, associations, cartInput } = createFixtureExecution("paid");
    const started = await startCheckout(execution, "cart-test-stale", cartInput);

    const staleWake = {
      eventId: "evt_stale_1",
      attemptId: started.attemptId,
      bindingRef: TEST_BINDING_REF,
      deliveryGeneration: 0, // invalid generation < 1
      wokeAt: 1727800000000,
    };

    let ackCalled = false;
    const wakePort = {
      async list() {
        return [staleWake as unknown as (typeof staleWake & { deliveryGeneration: number })];
      },
      async acknowledge() {
        ackCalled = true;
        return true;
      },
    };

    const results = await runWakeReconciliation(
      execution,
      associations,
      wakePort,
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("retained");
    expect(results[0].status === "retained" && results[0].reason).toBe("unknown");
    expect(ackCalled).toBe(false);
  });

  it("retains wake when acknowledgement transport fails", async () => {
    const { execution, associations, cartInput } = createFixtureExecution("paid");
    const started = await startCheckout(execution, "cart-test-ack-fail", cartInput);

    const wake = {
      eventId: "evt_ack_fail_1",
      attemptId: started.attemptId,
      bindingRef: TEST_BINDING_REF,
      deliveryGeneration: 1,
      wokeAt: 1727800000000,
    };

    const wakePort = {
      async list() {
        return [wake];
      },
      async acknowledge() {
        // Transport failure during ACK
        return false;
      },
    };

    const results = await runWakeReconciliation(
      execution,
      associations,
      wakePort,
    );

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("retained");
    expect(results[0].status === "retained" && results[0].reason).toBe("unavailable");
  });
});

describe("Scheduled shared trusted HTTP host", () => {
  function fixture(duration = 1800) {
    const { execution, associations, cartInput } = createFixtureExecution();
    const requests: { path: string; body?: PaymentRequest }[] = [];
    let outcome: "paid" | "unknown" = "paid";
    let original: PaymentRequest | undefined;
    const wake = {
      eventId: "evt_scheduled1", attemptId: "att_canonical_123",
      bindingRef: TEST_BINDING_REF, deliveryGeneration: 1, wokeAt: 1727800000000,
    };
    const config: TrustedTestCheckoutHostConfig = {
      ...VALID_TRUSTED_CONFIG,
      async fetch(input, init) {
        const url = new URL(input);
        expect(url.origin).toBe(TEST_PAYMENTS_ORIGIN);
        expect(new Headers(init.headers).get("x-dinkus-site")).toBe(TEST_SITE_ID);
        expect(new Headers(init.headers).get("authorization")).toBe("Bearer jwt-token-123");
        expect(init.redirect).toBe("error");
        expect(init.cache).toBe("no-store");
        const body = init.body ? JSON.parse(String(init.body)) : undefined;
        requests.push({ path: url.pathname, body });
        if (url.pathname === "/v1/checkout-binding" || url.pathname === "/v1/existing-binding") {
          expect(url.searchParams.get("bindingRef")).toBe(TEST_BINDING_REF);
          return Response.json({ bindingRef: TEST_BINDING_REF, providerId: "stripe",
            stripeAccountId: TEST_STRIPE_ACCOUNT, mode: "test", ready: true });
        }
        if (url.pathname === "/v1/checkout/wakes") return Response.json([wake]);
        if (url.pathname === "/v1/checkout/wakes/ack") {
          expect(body).toEqual(wake);
          const stored = await execution.store.read("scheduled-cart");
          expect(stored?.record.attempts[0].phase).toBe("paid");
          expect(stored?.record.attempts[0].order?.attemptId).toBe(wake.attemptId);
          return Response.json({ acknowledged: true });
        }
        if (url.pathname === "/v1/checkout/session") original = structuredClone(body);
        else if (url.pathname === "/v1/checkout/lookup") {
          expect(body).toEqual(original);
          if (outcome === "unknown") return Response.json({ outcome });
        } else throw new Error("Unexpected fixture endpoint");
        return Response.json({
          outcome: url.pathname === "/v1/checkout/session" ? "open" : "paid",
          attemptId: body.attemptId, total: body.total,
          session: { sessionId: "sess_scheduled_1", redirectUrl: "https://checkout.stripe.com/test",
            createdAt: 1727800000, expiresAt: 1727800000 + duration },
          ...(url.pathname === "/v1/checkout/lookup" ? { paymentId: "pi_scheduled_test" } : {}),
        });
      },
    };
    const assembly = createTrustedTestCheckoutHostAssembly(config);
    const admitted = { ...execution, paymentBindingRef: assembly.checkoutHost.paymentBindingRef,
      resolvePayments: assembly.checkoutHost.resolvePayments };
    return { execution, admitted, associations, cartInput, config, requests,
      setUnknown() { outcome = "unknown"; } };
  }

  it.each([1800, 1860])("uses canonical host lookup, writes before ACK, and preserves a %is session", async (duration) => {
    const f = fixture(duration);
    const started = await startCheckout(f.admitted, "scheduled-cart", f.cartInput);
    expect(started.phase).toBe("paying");
    expect(started.payment).toMatchObject({ paymentWindow: { minSeconds: 1800, maxSeconds: 1860 } });
    // The scheduler must replace this unrelated resolver with its trusted host.
    const execution = { ...f.execution, resolvePayments: async () => { throw new Error("Untrusted resolver used"); } };
    for (let i = 0; i < 2; i++) {
      const result = await runScheduledWakeReconciliation({ config: f.config, execution, associations: f.associations });
      expect(result.executed).toBe(true);
      expect(result.results[0].status).toBe("acknowledged");
    }
    const stored = await execution.store.read("scheduled-cart");
    expect(stored?.record.attempts).toHaveLength(1);
    expect(stored?.record.attempts[0].payment).toEqual(started.payment);
    expect(stored?.record.attempts[0].session).toEqual(started.session);
    expect(stored?.record.attempts[0].order?.orderId).toBe(`order:${started.attemptId}`);
    expect(f.requests.filter(r => r.path === "/v1/checkout/session")).toHaveLength(1);
    expect(f.requests.filter(r => r.path === "/v1/checkout/lookup")).toHaveLength(1);
  });

  it("retains unknown outcomes with the original attempt and no ACK", async () => {
    const f = fixture();
    const started = await startCheckout(f.admitted, "scheduled-cart", f.cartInput);
    f.setUnknown();
    const result = await runScheduledWakeReconciliation({ config: f.config, execution: f.execution, associations: f.associations });
    expect(result.results[0]).toMatchObject({ status: "retained", reason: "unknown" });
    expect(f.requests.some(r => r.path.endsWith("/ack"))).toBe(false);
    expect((await f.execution.store.read("scheduled-cart"))?.record.attempts[0]).toEqual(started);
  });

  it("rejects a mismatched admitted binding without outbound transport", async () => {
    const f = fixture();
    const result = await runScheduledWakeReconciliation({ config: f.config,
      execution: { ...f.execution, paymentBindingRef: "foreign-binding" }, associations: f.associations });
    expect(result).toMatchObject({ executed: false, reason: "error" });
    expect(f.requests).toHaveLength(0);
  });

  it("does not ACK a paid lookup when the canonical CAS write fails", async () => {
    const f = fixture();
    await startCheckout(f.admitted, "scheduled-cart", f.cartInput);
    const execution = { ...f.execution, store: { ...f.execution.store,
      compareAndSet: async () => { throw new Error("Fixture write failure"); } } };
    const result = await runScheduledWakeReconciliation({ config: f.config, execution, associations: f.associations });
    expect(result.results[0]).toMatchObject({ status: "retained", reason: "unavailable" });
    expect(f.requests.some(r => r.path.endsWith("/ack"))).toBe(false);
  });
});
