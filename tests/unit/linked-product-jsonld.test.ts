import { describe, expect, it } from "vitest";
import { linkedProductJsonLd } from "../../src/features/store-shell/linked-product-jsonld.js";
import { readInstalledCommerceCatalog, readInstalledCommerceProduct } from "../../src/features/commerce-catalog/installed.js";
import type { PublicCommerceProduct, PublicCommerceVariant } from "../../src/features/commerce-catalog/types.js";

const page = { url: "https://shop.example.test/products/tee", name: "Tee", description: "Published description" };
const product: PublicCommerceProduct = {
  id: "tee-m", name: "Tee", sku: "TEE-M", gtin: "012345678905", mpn: "TEE-M-PART", brand: "Example",
  price: { listable: true, regularText: "$34.00", saleText: null, unitMinor: "3400" },
  availability: { status: "in-stock", listable: true, sellable: true }, image: null, gallery: [],
};
const member = (id: string, sku: string | undefined, soldOut = false): PublicCommerceVariant => ({
  id, ...(sku !== undefined ? { sku } : {}), selections: [["Size", id]], unitMinor: soldOut ? "3600" : "3400", priceText: "$34.00",
  availability: { status: soldOut ? "out-of-stock" : "in-stock", sellable: !soldOut },
});

describe("selected member structured data", () => {
  it.each([["tee-m", "TEE-M", false], ["tee-l", "TEE-L", false], ["tee-xl", "TEE-XL", true]] as const)(
    "uses only %s's authoritative SKU, price and availability", (id, sku, soldOut) => {
      const result = linkedProductJsonLd(product, page, member(id, sku, soldOut));
      expect(result).toMatchObject({ "@type": "Product", sku, url: page.url,
        offers: { price: soldOut ? "36.00" : "34.00", priceCurrency: "USD", url: page.url,
          availability: `https://schema.org/${soldOut ? "OutOfStock" : "InStock"}` } });
      expect(result).not.toHaveProperty("gtin");
      expect(result).not.toHaveProperty("mpn");
    },
  );

  it("keeps simple-product metadata unchanged", () => {
    expect(linkedProductJsonLd(product, page)).toMatchObject({ sku: "TEE-M", gtin: "012345678905", mpn: "TEE-M-PART", brand: { name: "Example" },
      offers: { price: "34.00", availability: "https://schema.org/InStock" } });
  });

  it("older projections retain only page facts, including when member id equals the default", () => {
    for (const id of ["tee-m", "tee-l", "tee-xl"]) {
      const result = linkedProductJsonLd(product, page, member(id, undefined, id === "tee-xl"));
      expect(result).toEqual({ "@context": "https://schema.org", "@type": "Product", url: page.url, name: page.name, description: page.description });
    }
  });

  it.each([undefined, null, "", "   ", 42, {}, "x".repeat(1025)])("invalid/missing public SKU %j preserves purchasing facts but never invents an Offer", async (sku) => {
    const payload = { ...product, price: { currency: "USD", minor: "3400" }, variants: { members: [{ catalogItemId: "tee-xl", sku,
      selections: [{ optionLabel: "Size", valueLabel: "XL" }], price: { currency: "USD", minor: "3600" },
      availability: { listable: true, status: "out-of-stock", sellable: false } }] } };
    const parsed = await readInstalledCommerceProduct("tee-m", { request: new Request(page.url), runtime: {
      handlePublicPluginApiRoute: async () => ({ success: true, data: payload }),
    } });
    const variant = parsed!.variants![0]!;
    expect(variant).not.toHaveProperty("sku");
    expect(variant).toMatchObject({ id: "tee-xl", unitMinor: "3600", availability: { status: "out-of-stock", sellable: false } });
    expect(linkedProductJsonLd(parsed!, page, variant)).not.toHaveProperty("offers");
  });

  it("passes each public member's exact SKU through list/detail parsing", async () => {
    const payload = { ...product, price: { currency: "USD", minor: "3400" }, variants: { members: ["M", "L", "XL"].map(size => ({
      catalogItemId: `tee-${size.toLowerCase()}`, sku: `TEE-${size}`, selections: [{ optionLabel: "Size", valueLabel: size }],
      price: { currency: "USD", minor: "3400" }, availability: { listable: true, status: size === "XL" ? "out-of-stock" : "in-stock", sellable: size !== "XL" },
    })) } };
    const context = { request: new Request(page.url), runtime: {
      handlePublicPluginApiRoute: async () => ({ success: true, data: payload }),
    } };
    const parsed = await readInstalledCommerceProduct("tee-m", context);
    const [listed] = await readInstalledCommerceCatalog({ ...context, runtime: {
      handlePublicPluginApiRoute: async () => ({ success: true, data: { products: [payload] } }),
    } });
    expect(listed!.variants).toEqual(parsed!.variants);
    expect(parsed!.variants!.map(variant => [variant.id, variant.sku])).toEqual([["tee-m", "TEE-M"], ["tee-l", "TEE-L"], ["tee-xl", "TEE-XL"]]);
    expect(linkedProductJsonLd(parsed!, page, parsed!.variants![2]!)).toMatchObject({ sku: "TEE-XL", offers: { availability: "https://schema.org/OutOfStock" } });
  });
});
