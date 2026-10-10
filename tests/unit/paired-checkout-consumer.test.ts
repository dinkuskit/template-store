import { describe, expect, it, vi } from "vitest";
import type { PluginContext } from "emdash";
import { SANDBOX_GUEST_CHECKOUT_STORAGE } from "@dinkuskit/commerce/features/checkout";
import {
  CHECKOUT_PRICING_SCHEMA, REVIEWED_COMMERCE_SOURCE, REVIEWED_PAYMENTS_SOURCE,
  createPairedCheckoutConsumer, type PairedCheckoutServerConfig,
} from "../../src/features/paired-checkout/index.js";

function fixture() {
  const transport = vi.fn(async () => Response.json({
    bindingRef: "binding-test", providerId: "stripe", stripeAccountId: "acct_fixture",
    mode: "test", ready: true,
  }));
  const credentialResolver = vi.fn(async () => "synthetic-unit-token");
  const config: PairedCheckoutServerConfig = {
    commerceSource: REVIEWED_COMMERCE_SOURCE, paymentsSource: REVIEWED_PAYMENTS_SOURCE,
    pricingSchema: CHECKOUT_PRICING_SCHEMA, commerceOrigin: "https://store.example.invalid",
    paymentsOrigin: "https://payments.example.invalid", siteId: "synthetic-site",
    bindingRef: "binding-test", providerId: "stripe", stripeAccountId: "acct_fixture",
    fetch: transport, credentialResolver,
    resolveShippingConfiguration: async () => ({ configurationId: "shipping-fixture", revision: 1, mode: "free" }),
  };
  // Explicit uninstalled context fixture; this is not runtime/Registry proof.
  const values = new Map<string, { revision: string; value: unknown }>();
  const writes = vi.fn(async (id: string, revision: string | null, value: unknown) => {
    if ((values.get(id)?.revision ?? null) !== revision) return { applied: false };
    values.set(id, { revision: String(Number(revision ?? 0) + 1), value });
    return { applied: true };
  });
  const collection = { get: async (id: string) => values.get(id)?.value ?? null,
    getVersioned: async (id: string) => values.get(id) ?? null,
    compareAndSet: writes, query: async () => ({ items: [], hasMore: false }) };
  const ctx = { plugin: { id: "dinkus-commerce", version: "0.0.0" },
    site: { url: config.commerceOrigin },
    settings: { getVersioned: async () => ({
      revision: "settings-1",
      value: {
        recordKind: "merchant-store-settings",
        storeCountry: "US",
        sellingCountries: ["US"],
        shippingCountries: ["US"],
        requirePhoneNumber: false,
      },
    }) },
    storage: Object.fromEntries(Object.values(SANDBOX_GUEST_CHECKOUT_STORAGE).map(name => [name, collection])),
  } as unknown as PluginContext;
  const route = { input: {}, request: { url: config.commerceOrigin + "/api/plugins/commerce/guest-prepare",
    headers: { origin: config.commerceOrigin, "sec-fetch-site": "same-origin" } } };
  return { config, transport, credentialResolver, ctx, route, writes };
}

describe("matched TEST checkout assembly", () => {
  it("rejects missing/mismatched declarations before credentials, transport or storage", () => {
    const f = fixture();
    for (const changed of [ { pricingSchema: undefined }, { pricingSchema: "v2" },
      { commerceSource: "foreign" }, { paymentsSource: "foreign" },
      { resolveShippingConfiguration: undefined } ]) {
      expect(() => createPairedCheckoutConsumer({ ...f.config, ...changed } as PairedCheckoutServerConfig)).toThrow();
    }
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.credentialResolver).not.toHaveBeenCalled();
    expect(f.writes).not.toHaveBeenCalled();
  });

  it("shares the explicit schema across trusted config, pricing context and resolved port", async () => {
    const f = fixture(); const consumer = createPairedCheckoutConsumer(f.config);
    f.config.bindingRef = "changed-later";
    f.config.fetch = async () => { throw new Error("mutated transport must not execute"); };
    const port = await consumer.services.host.resolvePayments!("binding-test");
    expect(consumer.config.bindingRef).toBe("binding-test");
    expect(consumer.config.pricingSchema).toBe(CHECKOUT_PRICING_SCHEMA);
    expect(consumer.services.host.pricing?.paymentPricingSchema).toBe(CHECKOUT_PRICING_SCHEMA);
    expect(port?.pricingSchema).toBe(CHECKOUT_PRICING_SCHEMA);
    expect(await consumer.services.host.resolvePayments!("foreign")).toBeNull();
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("requires canonical owner storage and site origin before prepare can write", async () => {
    const f = fixture(); const consumer = createPairedCheckoutConsumer(f.config);
    const wrongOwner = { ...f.ctx, plugin: { id: "foreign", version: "0.0.0" } } as PluginContext;
    expect(await consumer.prepare(f.route, wrongOwner)).toMatchObject({ ok: false });
    expect(await consumer.prepare({ ...f.route, request: { ...f.route.request,
      headers: { origin: "https://foreign.example.invalid" } } }, f.ctx)).toMatchObject({ ok: false });
    expect(await consumer.prepare(f.route, { ...f.ctx, site: { ...f.ctx.site,
      url: "https://foreign.example.invalid" } })).toMatchObject({ ok: false });
    expect(f.writes).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
    expect(await consumer.prepare(f.route, f.ctx)).toMatchObject({ ok: true });
    expect(f.writes).toHaveBeenCalledTimes(1);
    expect(f.credentialResolver).not.toHaveBeenCalled();
  });

  it("does not turn unrelated cron events into a second wake consumer", async () => {
    const f = fixture(); const consumer = createPairedCheckoutConsumer(f.config);
    await consumer.cron({ name: "unrelated", scheduledAt: new Date().toISOString() }, f.ctx);
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.writes).not.toHaveBeenCalled();
  });
});
