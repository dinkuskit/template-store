import { describe, expect, it } from "vitest";
import { confirmedOrderView } from "../../src/features/guest-cart/order-view.js";

const usd = (minor: string) => ({ currency: "USD", minor });
const paid = (couponDiscount: string, total: string) => ({
  state: "paid",
  attemptId: "a1",
  total: usd(total),
  pricing: { merchandiseSubtotal: usd("1800"), couponDiscount: usd(couponDiscount), shipping: { mode: "free", charge: usd("0") } },
  order: { orderId: "order:a1", total: usd(total), lines: [{ id: "mug", name: "Mug", quantity: 1, unitPrice: usd("1800") }] },
}) as never;

describe("the thank-you page's totals", () => {
  it("shows what discount codes took off, down to a $0 order", () => {
    expect(confirmedOrderView(paid("1800", "0"))!.totals).toEqual([
      { label: "Subtotal", amount: "$18.00" },
      { label: "Discount", amount: "-$18.00" },
      { label: "Shipping", amount: "Free" },
      { label: "Total", amount: "$0.00" },
    ]);
  });

  it("shows no Discount row when nothing was taken off", () => {
    expect(confirmedOrderView(paid("0", "1800"))!.totals.map((row) => row.label)).toEqual(["Subtotal", "Shipping", "Total"]);
  });
});
