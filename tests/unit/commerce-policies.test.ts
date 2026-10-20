import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("emdash/runtime", () => ({
  getDb: vi.fn(async () => ({})),
}));

vi.mock("emdash", () => ({
  PluginStorageRepository: class PluginStorageRepository {
    constructor(_db: unknown, _pluginId: string, private collection: string) {}

    async get(): Promise<unknown> {
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

describe("installed Commerce policy consumer", () => {
  afterEach(() => {
    delete process.env.DINKUS_CATALOG_PROFILE;
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
});
