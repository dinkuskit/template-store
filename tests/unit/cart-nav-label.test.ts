import { describe, expect, it } from "vitest";
import { cartNavLabel, readCartCount } from "../../src/features/guest-cart/cart-script.js";

// The header's cart link carries aria-label, which a screen reader reads instead of the badge,
// so the label has to carry the count the badge shows.
describe("header cart link label", () => {
  it("says the item count the badge shows", () => {
    expect(cartNavLabel(0)).toBe("Cart");
    expect(cartNavLabel(1)).toBe("Cart, 1 item");
    expect(cartNavLabel(3)).toBe("Cart, 3 items");
  });

  it("reads the count from the readable cart cookie", () => {
    expect(readCartCount("dk_cart_count=2")).toBe(2);
    expect(readCartCount("a=1; dk_cart_count=12; b=2")).toBe(12);
    expect(readCartCount("")).toBe(0);
  });
});
