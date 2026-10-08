import { describe, expect, it, vi } from "vitest";
import { readInstalledCommerceCatalog } from "../../src/features/commerce-catalog/installed.js";
import { COMMERCE_REGISTRY_RUNTIME_ID } from "../../src/features/guest-cart/checkout-protocol.js";

const item = (id = "item") => ({ id, name: "Neutral product", sku: "NEUTRAL", price: { currency: "USD", minor: "125" },
  availability: { status: "in-stock", sellable: true, listable: true } });

function context(pages: unknown[]) {
  const dispatch = vi.fn(async () => ({ success: true, data: pages.shift() }));
  return { request: new Request("https://shop.example.test/?couponCode=FORGED", { headers: { cookie: "private=value", "x-commerce-guest-capability": "private" } }),
    runtime: { getPluginRouteMeta: vi.fn(() => ({ public: true, methods: ["GET"] })), handlePublicPluginApiRoute: dispatch } };
}

describe("installed Commerce public catalog consumer", () => {
  it("follows empty filtered pages and uses only the installed public runtime context", async () => {
    const ctx = context([{ products: [], cursor: "opaque/one" }, { products: [item("second")], cursor: "opaque/two" }, { products: [item("third")] }]);
    const products = await readInstalledCommerceCatalog(ctx);
    expect(products.map(product => product.id)).toEqual(["second", "third"]);
    expect(products[0]!.price).toEqual({ listable: true, regularText: "$1.25", saleText: null });
    expect(ctx.runtime.handlePublicPluginApiRoute).toHaveBeenCalledTimes(3);
    for (const [id, method, route, request] of ctx.runtime.handlePublicPluginApiRoute.mock.calls as unknown as [string, string, string, Request][]) {
      expect([id, method, route]).toEqual([COMMERCE_REGISTRY_RUNTIME_ID, "GET", "catalog/public"]);
      expect([...request.headers]).toEqual([]);
      expect([...new URL(request.url).searchParams.keys()].every(key => key === "cursor")).toBe(true);
    }
  });

  it("fails closed for absent or private installed route without dispatch", async () => {
    const ctx = context([]);
    ctx.runtime.getPluginRouteMeta.mockReturnValue({ public: false, methods: ["GET"] });
    await expect(readInstalledCommerceCatalog(ctx)).rejects.toThrow();
    expect(ctx.runtime.handlePublicPluginApiRoute).not.toHaveBeenCalled();
    await expect(readInstalledCommerceCatalog({ ...ctx, runtime: null })).rejects.toThrow();
  });

  it.each([
    [{ products: [], cursor: "repeat" }, { products: [], cursor: "repeat" }],
    [{ products: [item()], cursor: "next" }, { products: [item()] }],
    [{ products: [item()], cursor: "" }],
    [{ products: [{ ...item(), price: { currency: "USD", minor: "1.25" } }] }],
    [{ products: [{ ...item(), availability: { status: "in-stock", sellable: true, listable: false } }] }],
  ])("rejects malformed or cyclic projections without returning partial products", async (...pages) => {
    await expect(readInstalledCommerceCatalog(context(pages))).rejects.toThrow();
  });
});
