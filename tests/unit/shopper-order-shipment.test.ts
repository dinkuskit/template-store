import { describe, expect, it } from "vitest";
import type { ShopperOrderItem } from "../../src/features/shopper-account/index.js";
import { renderOrderItemMarkup } from "../../src/features/shopper-account/shopper-account-client.js";

const order: ShopperOrderItem = {
  orderId: "synthetic-history-order",
  receiptId: "synthetic-history-receipt",
  number: 1001,
  status: "completed",
  paidAt: "2026-11-02T00:00:00.000Z",
  total: { currency: "USD", minor: "1200" },
  lines: [{ catalogItemId: "notebook", name: "Notebook", quantity: 2,
    unitPrice: { currency: "USD", minor: "600" } }],
  delivery: null,
  phone: null,
};

// The HTTP client also encounters older or malformed optional completion data.
function render(completed: unknown, status = "completed") {
  return renderOrderItemMarkup({ ...order, status, completed } as ShopperOrderItem);
}

describe("shopper order shipment presentation", () => {
  it("shows Commerce's carrier and tracking as text on a completed order", () => {
    const markup = render({ at: "2026-11-02T01:00:00.000Z", carrier: "USPS", tracking: "SYNTHETIC-TRACKING" });
    expect(markup).toContain("data-account-order-shipment");
    expect(markup).toContain("Carrier: USPS");
    expect(markup).toContain("Tracking number: SYNTHETIC-TRACKING");
    expect(markup).toContain('data-account-order-status="completed"');
    expect(markup).not.toContain("Delivered");
    expect(markup).not.toContain("href=");
  });

  it.each([
    [{ carrier: " USPS " }, "Carrier: USPS", "data-account-order-tracking"],
    [{ tracking: " SYNTHETIC-ONLY " }, "Tracking number: SYNTHETIC-ONLY", "data-account-order-carrier"],
  ])("allows either optional shipment field independently (%j)", (completion, text, absent) => {
    const markup = render({ at: "2026-11-02T01:00:00.000Z", ...completion });
    expect(markup).toContain(text);
    expect(markup).not.toContain(absent);
  });

  it("escapes merchant-entered shipment text rather than creating HTML or links", () => {
    const markup = render({ at: "2026-11-02T01:00:00.000Z", carrier: 'USPS & <test>', tracking: '<img src=x onerror="alert(1)">' });
    expect(markup).toContain("Carrier: USPS &amp; &lt;test&gt;");
    expect(markup).toContain("Tracking number: &lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(markup).not.toContain("<img src=x");
    expect(markup).not.toContain("href=");
  });

  it.each([undefined, null, {}, { carrier: " ", tracking: "" }, { carrier: null, tracking: 42 }, "invalid", []])(
    "keeps absent, blank or malformed optional completion fields quiet (%j)", (completion) => {
      const markup = render(completion);
      expect(markup).not.toContain("data-account-order-shipment");
      expect(markup).toContain('data-account-order-status="completed"');
    },
  );

  it("does not show stale completion fields after an order returns to Processing", () => {
    const markup = render({ at: "2026-11-02T01:00:00.000Z", carrier: "USPS", tracking: "STALE-TRACKING" }, "processing");
    expect(markup).not.toContain("data-account-order-shipment");
    expect(markup).not.toContain("USPS");
    expect(markup).not.toContain("STALE-TRACKING");
    expect(markup).toContain('data-account-order-status="processing"');
  });
});
