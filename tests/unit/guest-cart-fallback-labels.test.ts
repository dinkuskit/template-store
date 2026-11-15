import { describe, expect, it } from "vitest";
import { presentGuestCart, type GuestCartCatalogSnapshot } from "../../src/features/guest-cart/index.js";

const intent = { version: 1 as const, lines: [
  { id: "11111111-1111-4111-8111-111111111111", quantity: 2 },
  { id: "22222222-2222-4222-8222-222222222222", quantity: 3 },
] };
const missing = intent.lines.map(({ id }) => ({ id, found: false as const }));
const current = (index: number, name: string, sellable = true): Extract<GuestCartCatalogSnapshot, { found: true }> => ({
  id: intent.lines[index].id, found: true, name, sku: "PUBLIC-SKU",
  price: { listable: true, regularText: "$16.00", saleText: null, unitMinor: "1600" },
  availability: { listable: true, sellable, status: sellable ? "in-stock" : "out-of-stock" },
});

describe("cart fallback labels without product authority", () => {
  it.each([{}, { pending: true }, { snapshotFailed: true }, { snapshots: [] }])(
    "uses neutral positions while current details are unknown: %j", (state) => {
      const view = presentGuestCart({ intent, ...state });
      expect(view.lines.map(line => line.name)).toEqual(["Item 1", "Item 2"]);
      expect(view.lines.map(({ id, quantity }) => ({ id, quantity }))).toEqual(intent.lines);
      expect(view.lines.every(line => !line.sellable && !line.thumbnail)).toBe(true);
      expect(view.checkoutEnabled).toBe(false);
    },
  );

  it("numbers confirmed missing items without exposing catalog IDs as their names", () => {
    const before = structuredClone(intent);
    const view = presentGuestCart({ intent, snapshots: missing, checkoutAdmitted: true });
    expect(view.lines.map(line => line.name)).toEqual(["Unavailable item 1", "Unavailable item 2"]);
    expect(view.lines.every(line => line.reasonCode === "missing" && !line.lineTotalText)).toBe(true);
    expect(view.checkoutEnabled).toBe(false);
    expect(view.subtotalText).toBeNull();
    expect(intent).toEqual(before);
  });

  it("does not reveal an unlisted snapshot's title or fall back to its redacted ID", () => {
    const unavailable = { ...current(0, "Private draft title"), price: { listable: false, regularText: null, saleText: null },
      availability: { listable: false, sellable: false, status: "out-of-stock" as const } };
    for (const name of ["Private draft title", intent.lines[0].id]) {
      const view = presentGuestCart({ intent, snapshots: [{ ...unavailable, name }] });
      expect(view.lines[0].name).toBe("Unavailable item 1");
      expect(view.lines[0].sellable).toBe(false);
    }
  });

  it("keeps real public names even when a listed product is sold out", () => {
    const view = presentGuestCart({ intent, snapshots: [current(0, "Bandana", false), current(1, "Mug")] });
    expect(view.lines.map(line => line.name)).toEqual(["Bandana", "Mug"]);
    expect(view.lines[0].sellable).toBe(false);
    expect(view.lines[0].reasonCode).toBe("unavailable");
  });

  it("restores authoritative names and totals on refresh without changing saved identities or quantities", () => {
    expect(presentGuestCart({ intent, snapshots: missing }).lines[0].name).toBe("Unavailable item 1");
    const recovered = presentGuestCart({ intent, snapshots: [current(0, "Bandana"), current(1, "Mug")] });
    expect(recovered.lines.map(line => line.name)).toEqual(["Bandana", "Mug"]);
    expect(recovered.lines.map(({ id, quantity }) => ({ id, quantity }))).toEqual(intent.lines);
    expect(recovered.subtotalText).toBe("$80.00");
  });

  it("uses cart position, not a second item identity, when known and missing lines mix or are removed", () => {
    const mixed = presentGuestCart({ intent, snapshots: [current(0, "Bandana"), missing[1]] });
    expect(mixed.lines.map(line => line.name)).toEqual(["Bandana", "Unavailable item 2"]);
    const removed = presentGuestCart({ intent: { version: 1, lines: [intent.lines[1]] }, snapshots: [missing[1]] });
    expect(removed.lines[0]).toMatchObject({ id: intent.lines[1].id, quantity: 3, name: "Unavailable item 1" });
  });
});
