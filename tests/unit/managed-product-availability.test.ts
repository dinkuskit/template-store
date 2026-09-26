import { describe, expect, it } from "vitest";

import {
  createManagedProductAvailabilityRuntime,
} from "../../src/features/managed-product-availability/index.js";

describe("managed product availability", () => {
  it("composes Commerce identity with Inventory stock and restores the proof balance", async () => {
    const runtime = createManagedProductAvailabilityRuntime();

    const initial = await runtime.read();
    expect(initial.product).toMatchObject({
      name: "Everyday Tee",
      sku: "DINKUS-DEMO-001",
      state: "draft",
    });
    expect(initial.price).toEqual({
      listable: true,
      regularText: "$12.00",
      saleText: null,
    });
    expect(initial.inventory).toMatchObject({
      inventorySkuId: "dinkus-inventory-sku-demo",
      onHand: "8",
      reserved: "0",
      available: "8",
      unit: "each",
      version: "1",
    });

    const changed = await runtime.adjust({
      commandId: "unit-proof-change",
      delta: "-3",
      reason: "proof-change",
    });
    expect(changed.inventory).toMatchObject({
      onHand: "5",
      available: "5",
      version: "2",
    });

    const replay = await runtime.adjust({
      commandId: "unit-proof-change",
      delta: "-3",
      reason: "proof-change",
    });
    expect(replay.inventory).toMatchObject({
      available: "5",
      version: "2",
    });

    const restored = await runtime.adjust({
      commandId: "unit-proof-restore",
      delta: "3",
      reason: "proof-restore",
    });
    expect(restored.inventory).toMatchObject({
      onHand: "8",
      available: "8",
      version: "3",
    });
    expect(restored.provenance).toEqual({
      blocks: "d3a73eea94c8d9a7d4b6609cc5e2f71134520ae5",
      commerce: "3f20fe96d5b3104c4b599e669d18f54fd8ab2587",
      inventory: "4f1bdfc85964fc41fe466336784af62261384679",
    });
  });

  it("fails closed when one command identity is reused for another adjustment", async () => {
    const runtime = createManagedProductAvailabilityRuntime();
    await runtime.adjust({
      commandId: "unit-conflict",
      delta: "-3",
      reason: "proof-change",
    });

    await expect(
      runtime.adjust({
        commandId: "unit-conflict",
        delta: "3",
        reason: "proof-restore",
      }),
    ).rejects.toMatchObject({
      code: "PROOF_INPUT_INVALID",
    });
  });
});
