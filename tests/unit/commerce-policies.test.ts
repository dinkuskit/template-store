import { afterEach, describe, expect, it, vi } from "vitest";

const nativePolicies = vi.hoisted(() => new Map<string, unknown>());

vi.mock("emdash/runtime", () => ({
  getDb: vi.fn(async () => ({})),
}));

vi.mock("emdash", () => ({
  PluginStorageRepository: class PluginStorageRepository {
    constructor(_db: unknown, _pluginId: string, private collection: string) {}

    async get(): Promise<unknown> {
      if (nativePolicies.has(this.collection)) return nativePolicies.get(this.collection);
      if (this.collection !== "storeShippingPolicy") return null;
      return {
        recordKind: "store-shipping-policy",
        recordId: "active",
        revision: 2,
        configurationId: "native",
        mode: "flat",
        amount: { currency: "USD", minor: "500" },
        updatedAt: "2026-10-20T00:00:00.000Z",
      };
    }
  },
}));

import { readInstalledCommercePolicies } from "../../src/features/commerce-policies/index.js";

const shipping = {
  recordKind: "store-shipping-policy",
  recordId: "active",
  revision: 4,
  configurationId: "shipping-4",
  mode: "flat",
  amount: { currency: "USD", minor: "799" },
  shippingDestinationCountries: ["US"],
  updatedAt: "2026-10-20T00:00:00.000Z",
} as const;

const returns = {
  recordKind: "store-return-policy", recordId: "active", revision: 4,
  updatedAt: "2026-10-20T00:00:00.000Z",
} as const;

function readProjection(data: unknown) {
  return readInstalledCommercePolicies({
    request: new Request("https://shop.example.test/products/hat"),
    runtime: {
      getPluginRouteMeta: () => ({ public: true, methods: ["GET"] }),
      handlePublicPluginApiRoute: vi.fn(async () => ({ success: true, data })),
    },
  }, "registry-runtime");
}

describe("installed Commerce policy consumer", () => {
  afterEach(() => {
    delete process.env.DINKUS_CATALOG_PROFILE;
    nativePolicies.clear();
  });

  it("uses only the public policy route and preserves the versioned records", async () => {
    delete process.env.DINKUS_CATALOG_PROFILE;
    const dispatch = vi.fn(async () => ({
      success: true,
      data: { shipping, returns: { recordKind: "store-return-policy", recordId: "active", revision: 4, merchantReturnDays: 30, updatedAt: "2026-10-20T00:00:00.000Z" },
    }}));
    const result = await readInstalledCommercePolicies({
      request: new Request("https://shop.example.test/products/hat"),
      runtime: {
        getPluginRouteMeta: () => ({ public: true, methods: ["GET"] }),
        handlePublicPluginApiRoute: dispatch,
      },
    }, "registry-runtime");
    expect(result.shipping).toEqual(shipping);
    expect(result.returns?.revision).toBe(4);
    expect(dispatch).toHaveBeenCalledWith(
      "registry-runtime",
      "GET",
      "policies/public",
      expect.any(Request),
    );
  });

  it("fails closed for a missing or private public route", async () => {
    delete process.env.DINKUS_CATALOG_PROFILE;
    const dispatch = vi.fn();
    await expect(readInstalledCommercePolicies({
      request: new Request("https://shop.example.test/"),
      runtime: {
        getPluginRouteMeta: () => ({ public: false, methods: ["GET"] }),
        handlePublicPluginApiRoute: dispatch,
      },
    }, "registry-runtime")).rejects.toThrow();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("reads native policy storage when the public route is not mounted", async () => {
    process.env.DINKUS_CATALOG_PROFILE = "native-development";
    const dispatch = vi.fn(async () => ({ success: false, error: { code: "NOT_FOUND" } }));
    const result = await readInstalledCommercePolicies({
      request: new Request("https://shop.example.test/shipping"),
      runtime: { handlePublicPluginApiRoute: dispatch },
    }, "dinkus-commerce");
    expect(dispatch).toHaveBeenCalledOnce();
    expect(result.shipping?.revision).toBe(2);
    expect(result.returns).toBeNull();
  });

  it.each([
    { amount: undefined },
    { amount: { currency: "EUR", minor: "500" } },
    { amount: { currency: "USD", minor: "-1" } },
    { amount: { currency: "USD", minor: "9007199254740992" } },
    { mode: "free", amount: { currency: "USD", minor: "500" } },
    { configurationId: " " },
    { shippingDestinationCountries: ["USA"] },
    { shippingDestinationCountries: "US" },
    { handlingTimeDays: { min: 3, max: 2 } },
    { transitTimeDays: { min: 0, max: 3651 } },
    { handlingTimeDays: { min: 0.5, max: 2 } },
    { policyPageUrl: "javascript:alert(1)" },
  ])("rejects malformed shipping fields %j", async (patch) => {
    await expect(readProjection({ shipping: { ...shipping, ...patch }, returns: null }))
      .rejects.toThrow("Invalid installed public policy projection");
  });

  it.each([
    { returnPolicyCategory: "UnknownCategory" },
    { returnMethod: "Teleport" },
    { returnFees: "SometimesFree" },
    { merchantReturnDays: -1 },
    { merchantReturnDays: 3651 },
    { merchantReturnDays: "30" },
    { applicableCountry: ["us"] },
    { applicableCountry: "US" },
    { policyPageUrl: "/returns" },
  ])("rejects malformed return fields %j", async (patch) => {
    await expect(readProjection({ shipping: null, returns: { ...returns, ...patch } }))
      .rejects.toThrow("Invalid installed public policy projection");
  });

  it("preserves unconfigured policies and valid omitted optional fields", async () => {
    expect(await readProjection({ shipping: null, returns: null })).toEqual({ shipping: null, returns: null });
    const free = { ...shipping, mode: "free", amount: undefined, shippingDestinationCountries: undefined };
    expect(await readProjection({ shipping: free, returns })).toEqual({ shipping: free, returns });
    const finite = { ...returns, returnPolicyCategory: "MerchantReturnFiniteReturnWindow" };
    expect((await readProjection({ shipping: null, returns: finite })).returns).toEqual(finite);
  });

  it("preserves valid zero charges, boundaries, and optional policy facts", async () => {
    const fullShipping = {
      ...shipping, mode: "free", amount: { currency: "USD", minor: "0" },
      handlingTimeDays: { min: 0, max: 3650 }, transitTimeDays: { min: 0, max: 0 },
      policyPageUrl: "https://shop.example.test/shipping",
    };
    const fullReturns = {
      ...returns, applicableCountry: ["US"], returnPolicyCategory: "MerchantReturnFiniteReturnWindow",
      merchantReturnDays: 0, returnMethod: "ReturnByMail", returnFees: "FreeReturn",
      policyPageUrl: "https://shop.example.test/returns",
    };
    expect(await readProjection({ shipping: fullShipping, returns: fullReturns }))
      .toEqual({ shipping: fullShipping, returns: fullReturns });
  });

  it("does not bypass malformed public data through the native fallback", async () => {
    process.env.DINKUS_CATALOG_PROFILE = "native-development";
    await expect(readProjection({ shipping: { ...shipping, amount: undefined }, returns: null }))
      .rejects.toThrow("Invalid installed public policy projection");
  });

  it("validates the existing native fallback projection too", async () => {
    process.env.DINKUS_CATALOG_PROFILE = "native-development";
    nativePolicies.set("storeShippingPolicy", { ...shipping, amount: undefined });
    await expect(readInstalledCommercePolicies({
      request: new Request("https://shop.example.test/shipping"),
      runtime: { handlePublicPluginApiRoute: vi.fn(async () => ({ success: false, error: { code: "NOT_FOUND" } })) },
    }, "dinkus-commerce")).rejects.toThrow("Invalid installed public policy projection");
  });
});
