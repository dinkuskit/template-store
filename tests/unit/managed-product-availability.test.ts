import { describe, expect, it } from "vitest";

import {
  createManagedProductAvailabilityRuntime,
} from "../../src/features/managed-product-availability/index.js";

describe("managed product availability", () => {
  it("composes Commerce identity with Inventory stock and restores the proof balance", async () => {
    const runtime = createManagedProductAvailabilityRuntime();

    const initial = await runtime.read();
    expect(initial.product).toMatchObject({
      name: "Dinkus Field Kit",
      sku: "DINKUS-DEMO-001",
      state: "draft",
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
      blocks: "f197c8108de244c47d651ec16cb1f4d25b15736f",
      commerce: "b9e432b1869bae09e394f5d631aa97b6949bf2fd",
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
