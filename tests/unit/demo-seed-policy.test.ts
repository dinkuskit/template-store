import { describe, expect, it } from "vitest";

import { DEMO_PRODUCTS, DEMO_SKUS, isDemoSku } from "../../scripts/demo-seed-policy.js";

describe("demo catalog data", () => {
  it("keeps the demo write set to the shipped hosted SKUs", () => {
    expect(DEMO_PRODUCTS.map((product) => product.sku)).toEqual([
      "DEMO-HOSTED-SHIRT",
      "DEMO-HOSTED-CAP",
      "DEMO-HOSTED-MUG",
      "DEMO-HOSTED-HOODIE-S",
      "DEMO-HOSTED-TOTE",
      "DEMO-HOSTED-THROW",
      "DEMO-HOSTED-TRAY",
      "DEMO-HOSTED-SOCKS",
      "DEMO-HOSTED-BOTTLE",
    ]);
    expect(DEMO_SKUS.has("DEMO-HOSTED-HOODIE-M")).toBe(true);
    expect(DEMO_SKUS.has("DEMO-HOSTED-HOODIE-L")).toBe(true);
    expect(DEMO_SKUS.has("DEMO-HOSTED-HOODIE-HG-L")).toBe(true);
    expect(
      DEMO_PRODUCTS.find((product) => product.sku === "DEMO-HOSTED-HOODIE-S")?.variant?.options
        .map((option) => option.optionId),
    ).toEqual(["color", "size"]);
    expect(DEMO_PRODUCTS.find((product) => product.sku === "DEMO-HOSTED-SOCKS")?.availability).toBe(
      "out-of-stock",
    );
    expect(DEMO_SKUS.has("SENTINEL-KEEP")).toBe(false);
    expect(DEMO_PRODUCTS.find((product) => product.sku === "DEMO-HOSTED-CAP")?.saleMinor).toBe(
      "2400",
    );
    expect(DEMO_PRODUCTS.find((product) => product.sku === "DEMO-HOSTED-SHIRT")?.saleMinor).toBe(
      null,
    );
  });

  it("knows its own SKUs, sizes and colors included, and no one else's", () => {
    expect(isDemoSku("demo-hosted-shirt")).toBe(true);
    expect(isDemoSku("DEMO-HOSTED-HOODIE-HG-L")).toBe(true);
    expect(isDemoSku("MERCHANT-HAT")).toBe(false);
  });
});
