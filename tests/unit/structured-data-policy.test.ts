import { describe, expect, it } from "vitest";
import { buildProductJsonLd } from "@dinkuskit/commerce/features/structured-data";
import { jsonLdScript } from "../../src/features/store-shell/structured-data.js";

describe("#35 Commerce structured data contract", () => {
  it("keeps visible Commerce facts and the canonical URL in one Product block", () => {
    const jsonLd = buildProductJsonLd({
      product: {
        id: "hat",
        name: "Neutral Hat",
        sku: "HAT-1",
        price: { currency: "USD", minor: "1250" },
        availability: { status: "available-on-backorder", sellable: true, listable: true },
      },
      page: {
        url: "https://shop.example.test/products/hat",
        name: "Neutral Hat",
        description: "A neutral hat",
      },
    });
    expect(jsonLd).toMatchObject({
      "@type": "Product",
      name: "Neutral Hat",
      sku: "HAT-1",
      url: "https://shop.example.test/products/hat",
      offers: {
        price: "12.50",
        priceCurrency: "USD",
        availability: "https://schema.org/BackOrder",
      },
    });
  });

  it("omits shipping and returns when Commerce has no policy records", () => {
    const jsonLd = buildProductJsonLd({
      product: {
        id: "hat",
        name: "Neutral Hat",
        sku: "HAT-1",
        price: { currency: "USD", minor: "1250" },
        availability: { status: "in-stock", sellable: true, listable: true },
      },
      page: { url: "https://shop.example.test/products/hat" },
    });
    expect(jsonLd.offers).not.toHaveProperty("shippingDetails");
    expect(jsonLd.offers).not.toHaveProperty("hasMerchantReturnPolicy");
  });

  it("escapes a merchant description so it cannot close the JSON-LD script", () => {
    const hostile = "</script><script>alert(1)</script>";
    const jsonLd = buildProductJsonLd({
      product: {
        id: "hat",
        name: "Neutral Hat",
        sku: "HAT-1",
        price: { currency: "USD", minor: "1250" },
        availability: { status: "in-stock", sellable: true, listable: true },
      },
      page: {
        url: "https://shop.example.test/products/hat",
        description: hostile,
      },
    });
    const html = `<script type="application/ld+json">${jsonLdScript(jsonLd)}</script>`;
    expect(html).not.toContain("</script><script>");
    expect(html.match(/<script\b/gu)).toHaveLength(1);
    const embedded = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</script>"));
    expect(JSON.parse(embedded).description).toBe(hostile);
  });
});
