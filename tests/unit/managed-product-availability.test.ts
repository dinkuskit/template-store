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
      blocks: "82a31183cc06ae0fc5b4829f5a8875753ecde10a",
      commerce: "530348c07769a010b0fa4ef24604292a4254eda0",
      inventory: "d735b180b3f4ed911667586f5131ff1727e46546",
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
