import { describe, expect, it } from "vitest";
import { cartLineFocusAfterRedraw } from "../../src/features/guest-cart/cart-redraw-focus.js";

describe("native cart redraw focus", () => {
  for (const control of ["data-guest-cart-qty", "data-guest-cart-update", "data-guest-cart-remove"] as const) {
    it(`keeps ${control} on a surviving row even if its order changes`, () => {
      expect(cartLineFocusAfterRedraw({ id: "b", index: 1, control }, ["b", "a"]))
        .toEqual({ id: "b", control });
    });
    it(`moves ${control} to the next row after removal`, () => {
      expect(cartLineFocusAfterRedraw({ id: "b", index: 1, control }, ["a", "c"]))
        .toEqual({ id: "c", control });
    });
  }
  it("uses the preceding row when the last row was removed", () => {
    expect(cartLineFocusAfterRedraw({ id: "c", index: 2, control: "data-guest-cart-remove" }, ["a", "b"]))
      .toEqual({ id: "b", control: "data-guest-cart-remove" });
  });
  it("leaves the empty-state destination to the DOM restorer", () => {
    expect(cartLineFocusAfterRedraw({ id: "a", index: 0, control: "data-guest-cart-remove" }, [])).toBeNull();
  });
});
