import { describe, expect, it, vi } from "vitest";

let answer: unknown = null;
vi.mock("../../src/features/coupons/index.js", async (original) => ({
  ...(await original<typeof import("../../src/features/coupons/index.js")>()),
  askCoupons: vi.fn(async () => answer),
  releaseCoupons: vi.fn(async () => {}),
}));
vi.mock("../../src/features/coupons/lines.js", () => ({ couponLines: vi.fn(async () => [{ item: "mug", product: "mug", price: "1800", quantity: 1, sale: false, categories: [] }]) }));

const { checkCoupons } = await import("../../src/features/coupons/checkout.js");

const ctx = {
  locals: {}, request: new Request("https://store.example/checkout", { method: "POST" }), url: new URL("https://store.example/checkout"),
  cookies: { get: (name: string) => (name === "dk_cart" ? { value: "cap-mine." + "s".repeat(64) } : undefined) },
} as never;
const page = { result: { ok: true, cart: { lines: [{ catalogItemId: "mug", quantity: 1 }] } } } as never;
const spring = { code: "SPRING25", ok: true, off: "450", freeShipping: false };
const priced = { from: "dinkus-coupons", ref: "h_1.c_2", codes: ["SPRING25"], lines: [{ item: "mug", price: "1800", qty: 1, off: "450" }] };

describe("Pay starts with codes only when Coupons answered every one", () => {
  it("starts when every code applies and the answer for Commerce came with them", async () => {
    answer = { codes: [spring], answer: priced };
    expect(await checkCoupons(ctx, page, ["SPRING25"], "sam@example.test", true)).toMatchObject({ ok: true, answer: priced });
  });

  it("waits when Coupons answered no result for a code, so checkout never starts at full price", async () => {
    answer = { codes: [], answer: null };
    expect((await checkCoupons(ctx, page, ["SPRING25"], "sam@example.test", true)).ok).toBe(false);
  });

  it("waits when a code applies but no answer for Commerce came with it", async () => {
    answer = { codes: [spring], answer: null };
    expect((await checkCoupons(ctx, page, ["SPRING25"], "sam@example.test", true)).ok).toBe(false);
  });

  it("waits when one of two codes has no result", async () => {
    answer = { codes: [spring], answer: priced };
    expect((await checkCoupons(ctx, page, ["SPRING25", "FREESHIP"], "sam@example.test", true)).ok).toBe(false);
  });
});
