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
    [{ products: {} }],
    [{ products: "nope" }],
    [null],
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

  const hoodie = (members: { id: string; minor: string }[]) => ({
    id: "hoodie", name: "Demo hoodie", sku: "DEMO-HOODIE",
    availability: { status: "in-stock", sellable: false, listable: true },
    variants: { schema: "dinkuskit.commerce.product-variants/v1", productId: "hoodie", options: [],
      members: members.map(m => ({ catalogItemId: m.id, selections: [], price: { currency: "USD", minor: m.minor },
        availability: { status: "in-stock", sellable: true, listable: true }, fulfillment: "physical" })) },
  });

  it("renders all items when a variant product has no top-level price, using a from-price", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const products = await readInstalledCommerceCatalog(context([{ products: [
      item("hat"), hoodie([{ id: "hoodie-l", minor: "4500" }, { id: "hoodie-s", minor: "4000" }]), item("mug"),
    ] }]));
    expect(products.map(p => p.id)).toEqual(["hat", "hoodie", "mug"]);
    expect(products[1]!.price).toEqual({ listable: true, regularText: "from $40.00", saleText: null });
    expect(products[1]!.availability.sellable).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("shows a plain price when all variant prices match, on the product lookup path too", async () => {
    const product = await readInstalledCommerceProduct("hoodie", context([hoodie([{ id: "a", minor: "4000" }, { id: "b", minor: "4000" }])]));
    expect(product?.price.regularText).toBe("$40.00");
  });

  it("projects size members with their own Commerce price and availability for the picker", async () => {
    const value = hoodie([{ id: "hoodie-s", minor: "5600" }, { id: "hoodie-m", minor: "6000" }]);
    value.variants.members[0]!.selections = [{ optionId: "size", optionLabel: "Size", valueId: "small", valueLabel: "Small" }] as never;
    value.variants.members[1]!.selections = [{ optionId: "size", optionLabel: "Size", valueId: "medium", valueLabel: "Medium" }] as never;
    value.variants.members[1]!.availability = { status: "out-of-stock", sellable: false, listable: true };
    const product = await readInstalledCommerceProduct("hoodie", context([value]));
    expect(product?.price.regularText).toBe("from $56.00");
    expect(product?.variants).toEqual([
      { id: "hoodie-s", selections: [["Size", "Small"]], priceText: "$56.00", availability: { status: "in-stock", sellable: true } },
      { id: "hoodie-m", selections: [["Size", "Medium"]], priceText: "$60.00", availability: { status: "out-of-stock", sellable: false } },
    ]);
  });

  it.each([
    [{ ...item("bad"), price: { currency: "USD", minor: "1.25" } }, "invalid price"],
    [{ ...item("bad"), availability: { status: "in-stock", sellable: true, listable: false } }, "invalid availability"],
    [{ ...item("bad"), price: undefined }, "missing price"],
  ])("skips one malformed item, renders the others, and warns without PII", async (bad, reason) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const products = await readInstalledCommerceCatalog(context([{ products: [item("first"), bad, item("last")] }]));
    expect(products.map(p => p.id)).toEqual(["first", "last"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![1]).toEqual({ id: "bad", reason });
    warn.mockRestore();
  });

  it("still fails a single-product lookup when the item is malformed", async () => {
    await expect(readInstalledCommerceProduct("item", context([{ ...item(), price: undefined }]))).rejects.toThrow();
  });
});
