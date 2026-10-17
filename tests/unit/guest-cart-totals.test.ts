import { describe, expect, it } from "vitest";

import {
  addGuestCartLine,
  emptyGuestCartIntent,
  parseGuestCartSnapshotResponse,
  presentGuestCart,
  type GuestCartCatalogSnapshot,
} from "../../src/features/guest-cart/index.js";

function snapshot(id: string, unitMinor?: string, listable = true): GuestCartCatalogSnapshot {
  return {
    id,
    found: true,
    name: `Item ${id}`,
    sku: id.toUpperCase(),
    fulfillment: "physical",
    price: { listable, regularText: listable ? "$0.00" : null, saleText: null, ...(unitMinor ? { unitMinor } : {}) },
    availability: { status: "in-stock", sellable: true, listable: true },
  };
}

describe("guest cart totals", () => {
  it("shows each line total and a subtotal that follow quantity", () => {
    let intent = addGuestCartLine(emptyGuestCartIntent(), "hat", 1).intent;
    intent = addGuestCartLine(intent, "mug", 3).intent;
    const view = presentGuestCart({ intent, snapshots: [snapshot("hat", "2400"), snapshot("mug", "1250")] });
    expect(view.lines.map((line) => line.lineTotalText)).toEqual(["$24.00", "$37.50"]);
    expect(view.subtotalText).toBe("$61.50");
  });

  it("claims no subtotal when any line's amount is unknown", () => {
    let intent = addGuestCartLine(emptyGuestCartIntent(), "hat", 2).intent;
    intent = addGuestCartLine(intent, "mug", 1).intent;
    const unpriced = presentGuestCart({ intent, snapshots: [snapshot("hat", "2400"), snapshot("mug", undefined, false)] });
    expect(unpriced.lines.map((line) => line.lineTotalText)).toEqual(["$48.00", null]);
    expect(unpriced.subtotalText).toBeNull();
    expect(presentGuestCart({ intent, snapshotFailed: true }).subtotalText).toBeNull();
    expect(presentGuestCart({ intent: emptyGuestCartIntent(), snapshots: [] }).subtotalText).toBeNull();
  });

  it("accepts only whole minor amounts from the snapshot route", () => {
    const parsed = parseGuestCartSnapshotResponse({
      products: [
        { ...snapshot("hat"), price: { listable: true, regularText: "$24.00", saleText: null, unitMinor: "2400" } },
        { ...snapshot("mug"), price: { listable: true, regularText: "$1.00", saleText: null, unitMinor: "-5" } },
        { ...snapshot("cap"), price: { listable: true, regularText: "$1.00", saleText: null, unitMinor: 100 } },
      ],
    });
    expect(parsed?.map((item) => item.found && item.price.unitMinor)).toEqual(["2400", undefined, undefined]);
  });
});
