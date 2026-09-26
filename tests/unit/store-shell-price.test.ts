import { describe, expect, it } from "vitest";

import { formatUsdMinor, presentStorefrontPrice } from "../../src/features/store-shell/index.js";

describe("store-shell public price", () => {
  it("formats integer minor units as USD and presents Regular plus Sale", () => {
    expect(formatUsdMinor("0")).toBe("$0.00");
    expect(formatUsdMinor("1200")).toBe("$12.00");
    expect(
      presentStorefrontPrice({
        catalogItemId: "priced",
        listable: true,
        regular: { currency: "USD", minor: "1200" },
        sale: { currency: "USD", minor: "1000" },
        customerPays: { currency: "USD", minor: "1000" },
      }),
    ).toEqual({
      listable: true,
      regularText: "$12.00",
      saleText: "$10.00",
    });
  });

  it("does not invent a public price when Regular is missing", () => {
    expect(
      presentStorefrontPrice({
        catalogItemId: "unpriced",
        listable: false,
      }),
    ).toEqual({
      listable: false,
      regularText: null,
      saleText: null,
    });
  });
});
