import { describe, expect, it, vi } from "vitest";
import {
  COMMERCE_NATIVE_PLUGIN_ID,
  readInstalledCommerceCatalog,
  readInstalledCommerceProduct,
} from "../../src/features/commerce-catalog/installed.js";

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
    expect(products[0]!.image).toBeNull();
    expect(products[0]!.gallery).toEqual([]);
    expect(ctx.runtime.handlePublicPluginApiRoute).toHaveBeenCalledTimes(3);
    for (const [id, method, route, request] of ctx.runtime.handlePublicPluginApiRoute.mock.calls as unknown as [string, string, string, Request][]) {
      expect([id, method, route]).toEqual([COMMERCE_NATIVE_PLUGIN_ID, "GET", "catalog/public"]);
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

  it("keeps Commerce media ids and alt text without taking a payload URL", async () => {
    const ctx = context([{
      products: [{
        ...item("hat"),
        image: {
          id: "media_hat",
          alt: "  Navy hat on a table  ",
          width: 1200,
          height: 800,
          placeholder: false,
          src: "https://evil.example/hat.png",
          filename: "IMG_0001.png",
        },
        gallery: [
          { id: "media_hat", alt: "Navy hat on a table", width: 1200, height: 800, placeholder: false },
          { id: "https://evil.example/other.png", alt: "nope", width: 10, height: 10, placeholder: false },
          { id: "media_side", alt: "", width: null, height: null, placeholder: false },
        ],
      }],
    }]);
    const [product] = await readInstalledCommerceCatalog(ctx);
    expect(product).toMatchObject({
      id: "hat",
      price: { listable: true, regularText: "$1.25", saleText: null },
      availability: { status: "in-stock", sellable: true, listable: true },
      image: { id: "media_hat", alt: "Navy hat on a table", width: 1200, height: 800, placeholder: false },
    });
    expect(product!.image).not.toHaveProperty("src");
    expect(product!.gallery).toEqual([
      { id: "media_hat", alt: "Navy hat on a table", width: 1200, height: 800, placeholder: false },
      { id: "media_side", alt: "Neutral product", width: null, height: null, placeholder: false },
    ]);
  });

  it("distinguishes a missing item from a temporary lookup failure", async () => {
    const missing = context([null]);
    await expect(readInstalledCommerceProduct("missing", missing)).resolves.toBeNull();
    const failed = context([]);
    failed.runtime.handlePublicPluginApiRoute.mockResolvedValue({ success: false, data: undefined });
    await expect(readInstalledCommerceProduct("item", failed)).rejects.toThrow();
  });

  it("keeps the priced product when the image payload is unsafe", async () => {
    const ctx = context([{ products: [{ ...item("hat"), image: { id: "javascript:alert(1)", alt: "x", width: 1, height: 1, placeholder: false } }] }]);
    const [product] = await readInstalledCommerceCatalog(ctx);
    expect(product).toMatchObject({
      id: "hat",
      price: { regularText: "$1.25" },
      availability: { status: "in-stock", sellable: true },
      image: null,
    });
  });
});
