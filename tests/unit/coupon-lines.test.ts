import { describe, expect, it, vi } from "vitest";

const state = { catalogFails: false, pagesFail: false, entryFails: false };
vi.mock("../../src/features/commerce-catalog/index.js", () => ({
  readCommerceCatalog: vi.fn(async () => {
    if (state.catalogFails) throw new Error("catalog down");
    return [{ id: "prod-mug", page: "page-mug", variants: [{ id: "mug" }] }];
  }),
}));
vi.mock("emdash", () => ({
  getEmDashCollection: vi.fn(async () => {
    if (state.pagesFail) throw new Error("pages down");
    return { entries: [{ id: "entry-mug", data: { id: "page-mug" } }] };
  }),
  getEmDashEntry: vi.fn(async () => {
    if (state.entryFails) throw new Error("entry down");
    return { entry: { references: { categories: { entries: [{ id: "kitchen" }] } } } };
  }),
}));

const { couponLines } = await import("../../src/features/coupons/lines.js");

const page = {
  result: { ok: true, cart: { lines: [{ catalogItemId: "mug", quantity: 2 }] } },
  snapshots: [{ id: "mug", found: true, price: { unitMinor: "1800", saleText: null } }],
} as never;

describe("coupon lines", () => {
  it("name each line's product, quantity and categories", async () => {
    Object.assign(state, { catalogFails: false, pagesFail: false, entryFails: false });
    expect(await couponLines(page, {} as never)).toEqual([{ item: "mug", product: "prod-mug", price: "1800", quantity: 2, sale: false, categories: ["kitchen"] }]);
  });

  it("are not made when the catalog, the product pages or a product page can't be read", async () => {
    for (const failing of ["catalogFails", "pagesFail", "entryFails"] as const) {
      Object.assign(state, { catalogFails: false, pagesFail: false, entryFails: false, [failing]: true });
      expect(await couponLines(page, {} as never)).toBeNull();
    }
  });
});
