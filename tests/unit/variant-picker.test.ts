import { describe, expect, it } from "vitest";
import { NO_OFFER_JSON_LD_KEY, variantPickerView, type VariantPickerMember } from "../../src/features/store-shell/variant-picker.js";

const member = (id: string, color: string, size: string, price: string, sellable: boolean): VariantPickerMember => ({
  id,
  values: { Color: color, Size: size },
  price,
  availability: sellable ? "in-stock" : "out-of-stock",
  status: sellable ? "In stock" : "Out of stock",
  sellable,
});

// Sparse on purpose: Blue/Medium and Red/Small do not exist.
const members = [
  member("blue-small", "Blue", "Small", "$56.00", true),
  member("red-medium", "Red", "Medium", "$60.00", true),
  member("red-large", "Red", "Large", "$60.00", false),
];

describe("product page variant pickers", () => {
  it("matches the picked values to one member and offers it", () => {
    const view = variantPickerView(members, { Color: "Red", Size: "Medium" });
    expect(view.member?.id).toBe("red-medium");
    expect(view).toMatchObject({ price: "$60.00", status: "In stock", sellable: true, buttonLabel: "Add to cart" });
  });

  it("turns Add to cart into Sold out for a member that cannot be bought", () => {
    const view = variantPickerView(members, { Color: "Red", Size: "Large" });
    expect(view.member?.id).toBe("red-large");
    expect(view).toMatchObject({ price: "$60.00", status: "Out of stock", sellable: false, buttonLabel: "Sold out" });
  });

  it("clears the price and offer for a combination that does not exist", () => {
    const view = variantPickerView(members, { Color: "Blue", Size: "Medium" });
    expect(view.member).toBeNull();
    expect(view).toMatchObject({ price: null, status: "Unavailable", availability: "", sellable: false, buttonLabel: "Unavailable" });
    expect(NO_OFFER_JSON_LD_KEY).not.toBe("");
  });

  it("strikes through values that have no sellable member beside the other picks", () => {
    const view = variantPickerView(members, { Color: "Blue", Size: "Small" });
    expect(view.soldOut.Size).toEqual({ Small: false, Medium: true, Large: true });
    expect(view.soldOut.Color).toEqual({ Blue: false, Red: true });
    expect(variantPickerView(members, { Color: "Red", Size: "Medium" }).soldOut.Size)
      .toEqual({ Small: true, Medium: false, Large: true });
  });
});
