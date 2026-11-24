import { describe, expect, it } from "vitest";

import { parseCouponAnswer, readCouponForm, type CouponLine } from "../../src/features/coupons/index.js";

const form = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};

const lines: CouponLine[] = [
  { item: "boots", product: "boots", price: "8000", quantity: 1, sale: false, categories: [] },
  { item: "mug", product: "mug", price: "1500", quantity: 2, sale: false, categories: ["kitchen"] },
];

describe("the coupon box form", () => {
  it("keeps applied codes, adds a typed one, and drops repeats whatever their case", () => {
    expect(readCouponForm(form([["coupon", "SAVE10"], ["couponCode", " save10 "], ["intent", "apply"]]))).toEqual({ codes: ["SAVE10"], applying: true });
    expect(readCouponForm(form([["coupon", "SAVE10"], ["couponCode", "SHIP"]]))).toEqual({ codes: ["SAVE10", "SHIP"], applying: false });
  });

  it("removes a code and counts Remove as applying, so checkout does not start", () => {
    expect(readCouponForm(form([["coupon", "SAVE10"], ["coupon", "SHIP"], ["couponRemove", "save10"]]))).toEqual({ codes: ["SHIP"], applying: true });
  });

  it("takes at most 6 codes of at most 64 characters", () => {
    const many = Array.from({ length: 8 }, (_, n) => ["coupon", `C${n}`] as [string, string]);
    expect(readCouponForm(form([...many, ["couponCode", "x".repeat(65)]])).codes).toEqual(["C0", "C1", "C2", "C3", "C4", "C5"]);
  });
});

describe("Coupons' answer", () => {
  const answer = {
    codes: [{ code: "SAVE10", ok: true, off: "1100", freeShipping: false }, { code: "NOPE", ok: false, reason: "not_found", message: "This code isn't valid." }],
    answer: { from: "dinkus-coupons", ref: "h_1.c_2", codes: ["SAVE10"], lines: [{ item: "boots", price: "8000", off: "800" }, { item: "mug", price: "1500", off: "300" }] },
  };

  it("passes an answer that names every line with the price sent", () => {
    expect(parseCouponAnswer(answer, lines)).toEqual(answer);
    expect(parseCouponAnswer({ codes: [], answer: null }, lines)).toEqual({ codes: [], answer: null });
  });

  it("refuses an answer for other lines, other prices, or from another plugin", () => {
    expect(parseCouponAnswer({ ...answer, answer: { ...answer.answer, lines: answer.answer.lines.slice(0, 1) } }, lines)).toBeNull();
    expect(parseCouponAnswer({ ...answer, answer: { ...answer.answer, lines: [{ item: "boots", price: "7000", off: "800" }, answer.answer.lines[1]] } }, lines)).toBeNull();
    expect(parseCouponAnswer({ ...answer, answer: { ...answer.answer, from: "other" } }, lines)).toBeNull();
    expect(parseCouponAnswer({ codes: [{ code: "X", ok: true, off: "-5", freeShipping: false }], answer: null }, lines)).toBeNull();
  });
});
