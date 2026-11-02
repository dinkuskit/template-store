import { describe, expect, it, vi } from "vitest";
import {
  readInstalledCommerceCatalog,
  readInstalledCommerceProduct,
  readInstalledCommerceProducts,
} from "../../src/features/commerce-catalog/installed.js";
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
    expect(products[0]!.price).toEqual({ listable: true, regularText: "$1.25", saleText: null, unitMinor: "125" });
    expect(products[0]!.image).toBeNull();
    expect(products[0]!.gallery).toEqual([]);
    expect(ctx.runtime.handlePublicPluginApiRoute).toHaveBeenCalledTimes(3);
    for (const [id, method, route, request] of ctx.runtime.handlePublicPluginApiRoute.mock.calls as unknown as [string, string, string, Request][]) {
      expect([id, method, route]).toEqual([COMMERCE_REGISTRY_RUNTIME_ID, "GET", "catalog/public"]);
      expect([...request.headers]).toEqual([]);
      expect([...new URL(request.url).searchParams.keys()].every(key => key === "cursor")).toBe(true);
    }
  });

  it("does not fall back to a native plugin in the shipping profile", async () => {
    const ctx = context([{ products: [item()] }]);
    ctx.runtime.getPluginRouteMeta.mockImplementation((id?: string) =>
      id === "dinkus-commerce" ? { public: true, methods: ["GET"] } : null as never);
    await expect(readInstalledCommerceCatalog(ctx)).rejects.toThrow();
    expect(ctx.runtime.handlePublicPluginApiRoute).not.toHaveBeenCalled();
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

  const simpleDigital = () => ({ ...item("guide"), variants: {
    schema: "dinkuskit.commerce.product-variants/v1", productId: "guide", options: [],
    members: [{ catalogItemId: "guide", selections: [], fulfillment: "digital",
      price: item().price, availability: item().availability }],
  } });

  it("preserves the sole zero-option member's fulfillment on list, detail and cart lookups", async () => {
    const [listed] = await readInstalledCommerceCatalog(context([{ products: [simpleDigital()] }]));
    const detail = await readInstalledCommerceProduct("guide", context([simpleDigital()]));
    const cart = (await readInstalledCommerceProducts(["guide"], context([simpleDigital()]))).get("guide");
    for (const product of [listed, detail, cart]) {
      expect(product).toMatchObject({ id: "guide", name: "Neutral product", sku: "NEUTRAL", fulfillment: "digital",
        price: { unitMinor: "125" }, availability: { sellable: true } });
      expect(product?.variants ?? []).toEqual([]);
    }
  });

  it.each([
    undefined,
    { ...simpleDigital().variants, schema: "unknown" },
    { ...simpleDigital().variants, productId: "another" },
    { ...simpleDigital().variants, options: [{}] },
    { ...simpleDigital().variants, members: [] },
    { ...simpleDigital().variants, members: [...simpleDigital().variants.members, ...simpleDigital().variants.members] },
    { ...simpleDigital().variants, members: [{ catalogItemId: "another", selections: [], fulfillment: "digital" }] },
    { ...simpleDigital().variants, members: [{ catalogItemId: "guide", selections: [{}], fulfillment: "digital" }] },
    { ...simpleDigital().variants, members: [{ catalogItemId: "guide", selections: [], fulfillment: "unknown" }] },
  ])("requires an unambiguous matching default member before omitting delivery", async (variants) => {
    const product = await readInstalledCommerceProduct("guide", context([{ ...item("guide"), variants }]));
    expect(product?.fulfillment).toBe("physical");
  });

  const hoodie = (members: { id: string; minor: string }[]) => ({
    id: "hoodie", name: "Demo hoodie", sku: "DEMO-HOODIE",
    availability: { status: "in-stock", sellable: false, listable: true },
    variants: { schema: "dinkuskit.commerce.product-variants/v1", productId: "hoodie", options: [],
      members: members.map(m => ({ catalogItemId: m.id, selections: [], price: { currency: "USD", minor: m.minor },
        availability: { status: "in-stock", sellable: true, listable: true }, fulfillment: "physical" })) },
  });

  const sized = {
    ...hoodie([]),
    variants: { schema: "dinkuskit.commerce.product-variants/v1", productId: "hoodie",
      options: [{ optionId: "size", label: "Size", values: [{ valueId: "s", label: "Small" }, { valueId: "l", label: "Large" }] }],
      members: [
        { catalogItemId: "hoodie-s", selections: [{ optionId: "size", optionLabel: "Size", valueId: "s", valueLabel: "Small" }],
          price: { currency: "USD", minor: "4000" }, availability: { status: "in-stock", sellable: true, listable: true }, fulfillment: "physical" },
        { catalogItemId: "hoodie-l", selections: [{ optionId: "size", optionLabel: "Size", valueId: "l", valueLabel: "Large" }],
          price: { currency: "USD", minor: "4500" }, availability: { status: "out-of-stock", sellable: false, listable: true }, fulfillment: "physical" },
      ] },
  };

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
      { id: "hoodie-s", selections: [["Size", "Small"]], unitMinor: "5600", priceText: "$56.00", availability: { status: "in-stock", sellable: true }, fulfillment: "physical" },
      { id: "hoodie-m", selections: [["Size", "Medium"]], unitMinor: "6000", priceText: "$60.00", availability: { status: "out-of-stock", sellable: false }, fulfillment: "physical" },
    ]);
  });

  it("keeps public GTIN and an explicit feed channel list, including an empty opt-out", async () => {
    const products = await readInstalledCommerceCatalog(context([{ products: [
      { ...item("hat"), gtin: "4006381333931", mpn: "HAT-MPN", brand: "Neutral", feedChannels: ["meta-catalog", "google-merchant"] },
      { ...item("cap"), feedChannels: [] },
      item("mug"),
    ] }]));
    expect(products[0]).toMatchObject({
      gtin: "4006381333931",
      mpn: "HAT-MPN",
      brand: "Neutral",
      feedChannels: ["google-merchant", "meta-catalog"],
    });
    expect(products[1]!.feedChannels).toEqual([]);
    expect(products[2]).not.toHaveProperty("feedChannels");
  });

  it.each([
    [{ ...item("bad"), price: { currency: "USD", minor: "1.25" } }, "invalid price"],
    [{ ...item("bad"), availability: { status: "in-stock", sellable: true, listable: false } }, "invalid availability"],
    [{ ...item("bad"), price: undefined }, "missing price"],
    [{ ...item("bad"), feedChannels: ["not-a-channel"] }, "invalid feed channels"],
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

  it("looks up only the requested items for a cart, one public item call each", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = context([item("hat"), null, { ...item("bad"), price: undefined }, sized]);
    const products = await readInstalledCommerceProducts(["hat", "gone", "bad", "hoodie-s"], ctx);
    expect(ctx.runtime.handlePublicPluginApiRoute).toHaveBeenCalledTimes(4);
    const calls = ctx.runtime.handlePublicPluginApiRoute.mock.calls as unknown as [string, string, string, Request][];
    expect(calls.map(([, , route]) => route)).toEqual(Array(4).fill("catalog/public/item"));
    expect(calls.map(([, , , request]) => new URL(request.url).searchParams.get("itemId"))).toEqual(["hat", "gone", "bad", "hoodie-s"]);
    expect(products.get("hat")?.price.regularText).toBe("$1.25");
    expect(products.get("gone")).toBeNull();
    expect(products.get("bad")).toBeNull();
    // Commerce answers a member id with its whole product; the cart reads the member it asked for.
    expect(products.get("hoodie-s")).toMatchObject({
      id: "hoodie-s", name: "Demo hoodie \u2014 Small", sku: "",
      price: { listable: true, regularText: "$40.00", saleText: null, unitMinor: "4000" },
      availability: { status: "in-stock", sellable: true, listable: true },
    });
    expect(products.get("hoodie-s")).not.toHaveProperty("variants");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("never prices a cart line from the product or a sibling member", async () => {
    // hoodie is the product's own id; Commerce lists only hoodie-s and hoodie-l (sold out).
    const products = await readInstalledCommerceProducts(["hoodie", "hoodie-l", "hoodie-m"], context([sized, sized, sized]));
    expect(products.get("hoodie")).toBeNull();
    expect(products.get("hoodie-l")).toMatchObject({ price: { unitMinor: "4500" }, availability: { status: "out-of-stock", sellable: false } });
    expect(products.get("hoodie-m")).toBeNull();
  });

  it("fails a cart lookup when Commerce cannot answer, so the cart keeps its lines", async () => {
    const failed = context([]);
    failed.runtime.handlePublicPluginApiRoute.mockResolvedValue({ success: false, data: undefined });
    await expect(readInstalledCommerceProducts(["hat"], failed)).rejects.toThrow();
  });
});
