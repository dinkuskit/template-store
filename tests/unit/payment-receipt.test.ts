import { describe, expect, it } from "vitest";

import { loadPaymentReceipt, parsePaymentReceipt, type PaymentReceiptFetcher } from "../../src/features/payment-receipt/index.ts";

const environment = {
  PAYMENTS_BASE_URL: "https://payments.example.test/",
  PAYMENTS_STORE_KEY: "store-secret",
};

const paid = {
  orderNumber: 1001,
  test: true,
  status: "paid",
  items: [{ name: "Everyday Tee", variant: "M", quantity: 1, unitCents: 2400, totalCents: 2400 }],
  subtotalCents: 2400,
  shippingCents: 500,
  taxCents: 0,
  totalCents: 2900,
  currency: "USD",
  shipTo: {
    name: "Test Shopper",
    line1: "1 Example Way",
    city: "Testville",
    state: "CA",
    postalCode: "00000",
    country: "US",
  },
  email: "shopper@example.test",
} as const;

function mockFetcher(response: Response | Error): PaymentReceiptFetcher {
  return {
    fetch: async (input, init) => {
      if (response instanceof Error) throw response;
      expect(input).toBe("https://payments.example.test/v1/checkout/receipt?session_id=cs_test_123");
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer store-secret");
      return response;
    },
  };
}

describe("loadPaymentReceipt", () => {
  it("loads a paid receipt using the server-side store key", async () => {
    const result = await loadPaymentReceipt("cs_test_123", {
      environment,
      fetcher: mockFetcher(Response.json(paid)),
    });
    expect(result).toEqual({ kind: "paid", receipt: paid });
  });

  it("returns pending without rendering a receipt", async () => {
    const result = await loadPaymentReceipt("cs_test_123", {
      environment,
      fetcher: mockFetcher(Response.json({ status: "pending" })),
    });
    expect(result).toEqual({ kind: "pending" });
  });

  it("fails closed for missing, failed, and unavailable lookups", async () => {
    await expect(loadPaymentReceipt(null, { environment, fetcher: mockFetcher(Response.json(paid)) }))
      .resolves.toEqual({ kind: "not-found" });
    await expect(loadPaymentReceipt("cs_test_123", {
      environment,
      fetcher: mockFetcher(new Response("missing", { status: 404 })),
    })).resolves.toEqual({ kind: "not-found" });
    await expect(loadPaymentReceipt("cs_test_123", {
      environment,
      fetcher: mockFetcher(Response.json({ status: "failed" })),
    })).resolves.toEqual({ kind: "not-found" });
    await expect(loadPaymentReceipt("cs_test_123", {
      environment,
      fetcher: mockFetcher(new Error("Payments unavailable")),
    })).resolves.toEqual({ kind: "not-found" });
  });
});

it("rejects malformed receipt data and does not invent ownership", () => {
  expect(parsePaymentReceipt({ ...paid, totalCents: "2900" })).toBeNull();
  expect(parsePaymentReceipt({ ...paid, shipTo: undefined })).toBeNull();
});
