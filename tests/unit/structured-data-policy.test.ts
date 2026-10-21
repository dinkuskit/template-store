import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildProductJsonLd,
  buildProductPreviewJsonLd,
} from "@dinkuskit/commerce/features/structured-data";
import { allowsProductJsonLd, jsonLdScript } from "../../src/features/store-shell/structured-data.js";

describe("#35 Commerce structured data contract", () => {
  it("permits product metadata only on successful responses, including editorial previews", () => {
    expect(allowsProductJsonLd(200)).toBe(true);
    for (const status of [301, 302, 404, 410, 500, 503]) {
      expect(allowsProductJsonLd(status), `HTTP ${status}`).toBe(false);
    }
  });

  it("emits only page facts for an editorial preview", () => {
    expect(buildProductPreviewJsonLd({
      url: "https://shop.example.test/products/preview",
      name: "Editorial Preview",
      description: "A preview product",
      images: ["https://shop.example.test/merch/tee.svg"],
    })).toEqual({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Editorial Preview",
      url: "https://shop.example.test/products/preview",
      description: "A preview product",
      image: "https://shop.example.test/merch/tee.svg",
    });
  });

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

  it("seeds neutral PortableText policy bodies without fabricated rates, country codes, or day counts", () => {
    const seed = JSON.parse(readFileSync(new URL("../../seed/seed.json", import.meta.url), "utf8")) as {
      content: {
        pages: Array<{
          id: string;
          slug: string;
          data: {
            title: string;
            content?: Array<{
              _type: string;
              style?: string;
              children?: Array<{ _type: string; text?: string }>;
            }>;
          };
        }>;
      };
    };
    const shipping = seed.content.pages.find((entry) => entry.id === "shipping");
    const returns = seed.content.pages.find((entry) => entry.id === "returns");
    expect(shipping?.data.content?.length).toBeGreaterThanOrEqual(4);
    expect(returns?.data.content?.length).toBeGreaterThanOrEqual(4);
    const flattenText = (blocks: NonNullable<typeof shipping>["data"]["content"] = []) =>
      blocks.flatMap((block) => block.children ?? []).map((span) => span.text ?? "").join(" ");
    const shippingText = flattenText(shipping?.data.content);
    const returnsText = flattenText(returns?.data.content);
    expect(shippingText).toContain("Order processing & cut-off times");
    expect(shippingText).toContain("Carrier tracking & delivery");
    expect(shippingText).toContain("Edit this page in EmDash");
    expect(returnsText).toContain("Item condition & eligibility");
    expect(returnsText).toContain("How to initiate a return");
    expect(returnsText).toContain("Edit this page in EmDash");
    for (const text of [shippingText, returnsText]) {
      expect(text).not.toMatch(/\$\d|\b[A-Z]{2}\b|\d+ days/u);
      expect(text).not.toMatch(/next business day|Every dispatched package|unworn, unwashed|Final-sale items|original payment method/iu);
    }
  });

  it("exposes /shipping and /returns under Policies & Care in StoreFooter and pairs PortableText with configured policies", () => {
    const footer = readFileSync(new URL("../../src/features/store-shell/StoreFooter.astro", import.meta.url), "utf8");
    expect(footer).toContain('aria-label="Policies & Care"');
    expect(footer).toContain('href="/shipping"');
    expect(footer).toContain('href="/returns"');

    const shippingPage = readFileSync(new URL("../../src/pages/shipping.astro", import.meta.url), "utf8");
    expect(shippingPage).toContain("data-shipping-policy");
    expect(shippingPage).toContain("data-shipping-policy-unset");
    expect(shippingPage).toContain("data-shipping-policy-body");
    expect(shippingPage).toContain("<PortableText value={content}");
    expect(shippingPage).toContain("<StoreFooter profile={profile} />");

    const returnsPage = readFileSync(new URL("../../src/pages/returns.astro", import.meta.url), "utf8");
    expect(returnsPage).toContain("data-return-policy");
    expect(returnsPage).toContain("data-return-policy-unset");
    expect(returnsPage).toContain("data-return-policy-body");
    expect(returnsPage).toContain("<PortableText value={content}");
    expect(returnsPage).toContain("<StoreFooter profile={profile} />");
  });
});
