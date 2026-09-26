import { describe, expect, it } from "vitest";

import {
  UNMANAGED_PRODUCT_ITEM_ID,
  UNMANAGED_PRODUCT_SKU,
  UNPRICED_PRODUCT_ITEM_ID,
  UNPRICED_PRODUCT_SKU,
  createUnmanagedProductSellabilityRuntime,
} from "../../src/features/unmanaged-product-sellability/index.js";

describe("unmanaged product sellability", () => {
  it("defaults to in-stock without a quantity and restores every manual status", async () => {
    const runtime = createUnmanagedProductSellabilityRuntime();

    const initial = await runtime.read();
    expect(initial.product).toMatchObject({
      itemId: UNMANAGED_PRODUCT_ITEM_ID,
      name: "Canvas Cap",
      sku: UNMANAGED_PRODUCT_SKU,
      state: "draft",
      stockMode: "unmanaged",
    });
    expect(initial.storefront).toEqual({
      schema: "dinkuskit.commerce.storefront-availability-result/v1",
      catalogItemId: UNMANAGED_PRODUCT_ITEM_ID,
      status: "in-stock",
      sellable: true,
      listable: true,
    });
    expect(initial.price).toEqual({
      listable: true,
      regularText: "$12.00",
      saleText: "$10.00",
    });
    expect(initial.storefront).not.toHaveProperty("displayQuantity");

    const outOfStock = await runtime.setAvailability({
      catalogItemId: UNMANAGED_PRODUCT_ITEM_ID,
      status: "out-of-stock",
    });
    expect(outOfStock.storefront).toMatchObject({
      status: "out-of-stock",
      sellable: false,
    });
    expect(outOfStock.storefront).not.toHaveProperty("displayQuantity");

    const replay = await runtime.setAvailability({
      catalogItemId: UNMANAGED_PRODUCT_ITEM_ID,
      status: "out-of-stock",
    });
    expect(replay.storefront.status).toBe("out-of-stock");

    const backorder = await runtime.setAvailability({
      catalogItemId: UNMANAGED_PRODUCT_ITEM_ID,
      status: "available-on-backorder",
    });
    expect(backorder.storefront).toMatchObject({
      status: "available-on-backorder",
      sellable: true,
    });
    expect(backorder.storefront).not.toHaveProperty("displayQuantity");

    const restored = await runtime.setAvailability({
      catalogItemId: UNMANAGED_PRODUCT_ITEM_ID,
      status: "in-stock",
    });
    expect(restored.storefront).toMatchObject({
      status: "in-stock",
      sellable: true,
    });
    expect(restored.provenance).toEqual({
      blocks: "f197c8108de244c47d651ec16cb1f4d25b15736f",
      commerce: "3f20fe96d5b3104c4b599e669d18f54fd8ab2587",
      inventory: "4f1bdfc85964fc41fe466336784af62261384679",
    });
  });

  it("keeps an unpriced draft off the public home", async () => {
    const runtime = createUnmanagedProductSellabilityRuntime();
    const draft = await runtime.readUnpricedDraft();
    expect(draft.product).toMatchObject({
      itemId: UNPRICED_PRODUCT_ITEM_ID,
      sku: UNPRICED_PRODUCT_SKU,
      stockMode: "unmanaged",
    });
    expect(draft.storefront).toMatchObject({
      catalogItemId: UNPRICED_PRODUCT_ITEM_ID,
      listable: false,
      sellable: false,
    });
    expect(draft.price.listable).toBe(false);
  });

  it("fails closed when the proof targets another catalog item or status", async () => {
    const runtime = createUnmanagedProductSellabilityRuntime();
    await runtime.read();

    await expect(
      runtime.setAvailability({
        catalogItemId: "dinkus-template-product",
        status: "out-of-stock",
      }),
    ).rejects.toMatchObject({
      code: "PROOF_INPUT_INVALID",
    });
    await expect(
      runtime.setAvailability({
        catalogItemId: UNMANAGED_PRODUCT_ITEM_ID,
        status: "low-stock" as "in-stock",
      }),
    ).rejects.toMatchObject({
      code: "PROOF_INPUT_INVALID",
    });
  });
});
