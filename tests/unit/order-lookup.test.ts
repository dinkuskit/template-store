import { describe, expect, it } from "vitest";

import { lookUpOrder, orderLookupView, ORDER_LOOKUP_TEXT } from "../../src/features/order-lookup/index.js";
import { COMMERCE_REGISTRY_RUNTIME_ID } from "../../src/features/guest-cart/checkout-protocol.js";

const STORE = "https://store.example.test";

/** Commerce's order lookup answer for order #1004, as orders/lookup projects it. */
const ORDER = {
  orderId: "order:ord_1004",
  receiptId: "rcpt_1004",
  number: 1004,
  status: "completed",
  paidAt: "2026-11-20T15:30:00.000Z",
  total: { currency: "USD", minor: "3700" },
  lines: [
    { catalogItemId: "item-tee-m", quantity: 2, name: "Trail Tee", unitPrice: { currency: "USD", minor: "1500" } },
  ],
  choices: [
    { catalogItemId: "item-tee-m", productId: "tee", selections: [
      { optionId: "o1", optionLabel: "Size", valueId: "v1", valueLabel: "M" },
      { optionId: "o2", optionLabel: "Colour", valueId: "v2", valueLabel: "Red" },
    ] },
  ],
  pricing: {
    merchandiseSubtotal: { currency: "USD", minor: "3000" },
    couponDiscount: { currency: "USD", minor: "0" },
    netMerchandise: { currency: "USD", minor: "3000" },
    shipping: { mode: "flat", charge: { currency: "USD", minor: "700" } },
    finalTotal: { currency: "USD", minor: "3700" },
  },
  delivery: { name: "Pat Lee", line1: "1 Main St", city: "Portland", region: "OR", postalCode: "97205", country: "US" },
  phone: null,
  completed: { at: "2026-11-21T10:00:00.000Z", carrier: "USPS", tracking: "9400 1000 0000 0000 0000 00" },
};

type Call = { pluginId: string; method: string; path: string; body: unknown; headers: Headers; url: string };

function page(answer: unknown, { form = "orderNumber=%231004&email=Pat%40Example.test", headers = {} as Record<string, string> } = {}) {
  const calls: Call[] = [];
  const locals = {
    emdash: {
      async handlePublicPluginApiRoute(pluginId: string, method: string, path: string, request: Request) {
        calls.push({ pluginId, method, path, body: await request.json(), headers: request.headers, url: request.url });
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  } as unknown as App.Locals;
  const request = new Request(`${STORE}/track-order`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: STORE, "sec-fetch-site": "same-origin", ...headers },
    body: form,
  });
  return { ctx: { locals, request, url: new URL(request.url) }, calls };
}

describe("order lookup page", () => {
  it("asks Commerce inside the server and shows the one order it found", async () => {
    const { ctx, calls } = page({ success: true, data: { ok: true, order: ORDER } });
    const outcome = await lookUpOrder(ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      pluginId: COMMERCE_REGISTRY_RUNTIME_ID,
      method: "POST",
      path: "orders/lookup",
      body: { orderNumber: "#1004", email: "Pat@Example.test" },
      url: `${STORE}/_emdash/api/plugins/${COMMERCE_REGISTRY_RUNTIME_ID}/orders/lookup`,
    });
    expect(calls[0]!.headers.get("sec-fetch-site")).toBe("same-origin");
    expect(calls[0]!.headers.get("origin")).toBe(STORE);
    expect(outcome).toEqual({
      ok: true,
      order: {
        number: "1004",
        status: "Completed",
        paidOn: "November 20, 2026",
        lines: [{ id: "item-tee-m", text: "Trail Tee × 2", options: "Size: M · Colour: Red", amount: "$30.00" }],
        totals: [
          { label: "Subtotal", amount: "$30.00" },
          { label: "Shipping", amount: "$7.00" },
          { label: "Total", amount: "$37.00" },
        ],
        recipient: "Pat Lee",
        address: "1 Main St, Portland OR 97205, US",
        carrier: "USPS",
        tracking: "9400 1000 0000 0000 0000 00",
      },
    });
  });

  it("shows Commerce's one not-found answer and keeps what the shopper typed", async () => {
    const { ctx } = page({ success: true, data: { ok: false, error: { code: "ORDER_NOT_FOUND", message: "ignored" } } });
    expect(await lookUpOrder(ctx)).toEqual({
      ok: false,
      code: "ORDER_NOT_FOUND",
      message: ORDER_LOOKUP_TEXT.ORDER_NOT_FOUND,
      form: { orderNumber: "#1004", email: "Pat@Example.test" },
    });
  });

  it("says when Commerce has limited the guesses", async () => {
    const { ctx } = page({ success: true, data: { ok: false, error: { code: "LOOKUP_LIMITED", message: "x" } } });
    expect(await lookUpOrder(ctx)).toMatchObject({ ok: false, code: "LOOKUP_LIMITED", message: "Too many tries. Try again in an hour." });
  });

  it("refuses a post from another site before asking Commerce", async () => {
    const { ctx, calls } = page({ success: true, data: { ok: true, order: ORDER } }, {
      headers: { origin: "https://evil.example.test", "sec-fetch-site": "cross-site" },
    });
    expect(await lookUpOrder(ctx)).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(calls).toHaveLength(0);
  });

  it("asks for both boxes before asking Commerce", async () => {
    const { ctx, calls } = page(null, { form: "orderNumber=1004&email=" });
    expect(await lookUpOrder(ctx)).toMatchObject({ ok: false, code: "INVALID_INPUT", form: { orderNumber: "1004", email: "" } });
    expect(calls).toHaveLength(0);
  });

  it("never parses an oversized post", async () => {
    const { ctx, calls } = page(null, { form: `orderNumber=1004&email=${"a".repeat(4096)}` });
    expect(await lookUpOrder(ctx)).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(calls).toHaveLength(0);
  });

  it("is unavailable when Commerce has no lookup route, fails, or answers something else", async () => {
    for (const answer of [
      { success: false, error: { code: "NOT_FOUND", message: "orders/lookup" } },
      new Error("boom"),
      { success: true, data: { ok: true, order: { ...ORDER, number: "1004" } } },
      { success: true, data: { ok: false, error: { code: "SOMETHING_NEW" } } },
    ]) {
      expect(await lookUpOrder(page(answer).ctx)).toMatchObject({ ok: false, code: "UNAVAILABLE", message: ORDER_LOOKUP_TEXT.UNAVAILABLE });
    }
  });

  it("shows a processing order without shipment details, and a discount when there is one", () => {
    const view = orderLookupView({
      ...ORDER,
      status: "processing",
      completed: null,
      pricing: { ...ORDER.pricing, couponDiscount: { currency: "USD", minor: "500" }, shipping: { mode: "free", charge: { currency: "USD", minor: "0" } } },
    });
    expect(view).toMatchObject({ status: "Processing", carrier: null, tracking: null });
    expect(view?.totals).toEqual([
      { label: "Subtotal", amount: "$30.00" },
      { label: "Discount", amount: "-$5.00" },
      { label: "Shipping", amount: "Free" },
      { label: "Total", amount: "$37.00" },
    ]);
  });
});
