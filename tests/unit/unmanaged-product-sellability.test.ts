import { describe, expect, it } from "vitest";

import {
  UNMANAGED_PRODUCT_ITEM_ID,
  UNMANAGED_PRODUCT_SKU,
  createUnmanagedProductSellabilityRuntime,
} from "../../src/features/unmanaged-product-sellability/index.js";

describe("unmanaged product sellability", () => {
  it("defaults to in-stock without a quantity and restores every manual status", async () => {
    const runtime = createUnmanagedProductSellabilityRuntime();

    const initial = await runtime.read();
    expect(initial.product).toMatchObject({
      itemId: UNMANAGED_PRODUCT_ITEM_ID,
      name: "Dinkus Field Notes",
      sku: UNMANAGED_PRODUCT_SKU,
      state: "draft",
      stockMode: "unmanaged",
    });
    expect(initial.storefront).toEqual({
      schema: "dinkuskit.commerce.storefront-availability-result/v1",
      catalogItemId: UNMANAGED_PRODUCT_ITEM_ID,
      status: "in-stock",
      sellable: true,
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
      blocks: "82a31183cc06ae0fc5b4829f5a8875753ecde10a",
      commerce: "8ca3e5dd14264df6db21bf4bee778158b0357bd2",
      inventory: "d735b180b3f4ed911667586f5131ff1727e46546",
    });
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
