import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
vi.mock("../../src/features/coupons/index.js", async (original) => ({
  ...(await original<typeof import("../../src/features/coupons/index.js")>()),
  askCoupons: vi.fn(async () => { calls.push("ask"); return null; }),
  releaseCoupons: vi.fn(async () => { calls.push("release"); }),
}));
vi.mock("../../src/features/coupons/lines.js", () => ({ couponLines: vi.fn(async () => [{ item: "mug", product: "mug", price: "1800", quantity: 1, sale: false, categories: [] }]) }));

const { checkCoupons } = await import("../../src/features/coupons/checkout.js");

const ctx = (key: string) => ({
  locals: {}, request: new Request("https://store.example/checkout", { method: "POST" }), url: new URL("https://store.example/checkout"),
  cookies: { get: (name: string) => (name === "dk_cart" ? { value: key } : undefined) },
}) as never;
const page = (ok: boolean) => ({ result: ok ? { ok: true, cart: { lines: [{ catalogItemId: "mug", quantity: 1 }] } } : { ok: false, error: "NO_CART" } }) as never;

describe("the coupon box only asks for a cart Commerce accepted", () => {
  beforeEach(() => { calls.length = 0; });

  it("never holds or releases uses for a key Commerce refused, and Pay with a code then waits", async () => {
    const key = "cap-victim." + "s".repeat(64);
    expect(await checkCoupons(ctx(key), page(false), [], undefined, true)).toMatchObject({ ok: true, answer: null });
    expect(await checkCoupons(ctx(key), page(false), ["SAVE10"], "sam@example.test", true)).toMatchObject({ ok: false, answer: null });
    expect(calls).toEqual([]);
  });

  it("asks and releases for the cart behind an accepted key", async () => {
    const key = "cap-mine." + "s".repeat(64);
    await checkCoupons(ctx(key), page(true), [], undefined, true);
    await checkCoupons(ctx(key), page(true), ["SAVE10"], undefined, false);
    expect(calls).toEqual(["release", "ask"]);
  });
});
