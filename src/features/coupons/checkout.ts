import { visitorIp } from "../playground-checkout/index.js";
import { cartKeyId, readCartKey, trustedStoreOrigin, type ServerCartContext } from "../guest-cart/server-cart.js";
import type { ServerCartPage } from "../guest-cart/server-view.js";
import { askCoupons, couponsInstalled, releaseCoupons, type AddonAnswer, type CouponResult } from "./index.js";
import { couponLines } from "./lines.js";

/** What the coupon box shows: whether it takes codes, each code's result, and what the codes take off. */
export type CouponBox = Readonly<{
  on: boolean;
  results: readonly CouponResult[];
  /** The codes the form keeps: the ones that applied. */
  codes: readonly string[];
  discountMinor: string | null;
  freeShipping: boolean;
  /** A problem with the box itself, such as Coupons not answering. */
  message: string | null;
}>;

export const COUPONS_OFF: CouponBox = { on: false, results: [], codes: [], discountMinor: null, freeShipping: false, message: null };
const UNAVAILABLE = "Discount codes can't be checked right now. Try again, or remove the code to check out without it.";

export async function couponBoxOn(isPlayground: boolean): Promise<CouponBox> {
  return !isPlayground && await couponsInstalled() ? { ...COUPONS_OFF, on: true } : COUPONS_OFF;
}

/**
 * Asks Coupons about the codes for this cart. With `hold`, as checkout starts, each code that applies holds a use
 * for this cart and the answer goes to Commerce; `ok` is false when a code was refused or Coupons did not answer,
 * so checkout waits for the shopper.
 */
export async function checkCoupons(
  ctx: ServerCartContext,
  page: ServerCartPage,
  codes: readonly string[],
  email: string | undefined,
  hold: boolean,
): Promise<Readonly<{ box: CouponBox; answer: AddonAnswer | null; ok: boolean }>> {
  const origin = trustedStoreOrigin(ctx);
  const cart = cartKeyId(readCartKey(ctx.cookies));
  if (!cart) return { box: { ...COUPONS_OFF, on: true }, answer: null, ok: true };
  if (!codes.length) {
    if (hold) await releaseCoupons(origin, cart);
    return { box: { ...COUPONS_OFF, on: true }, answer: null, ok: true };
  }
  const lines = await couponLines(page, { runtime: ctx.locals.emdash as never, request: ctx.request });
  const asked = lines ? await askCoupons(origin, {
    cart,
    ...(visitorIp(ctx.request) ? { connection: visitorIp(ctx.request)! } : {}),
    ...(email ? { email } : {}),
    codes,
    lines,
    hold,
  }) : null;
  if (!asked) return { box: { ...COUPONS_OFF, on: true, codes, message: UNAVAILABLE }, answer: null, ok: false };
  const applied = asked.codes.filter((result) => result.ok);
  const discount = applied.reduce((sum, result) => sum + BigInt(result.ok ? result.off : "0"), 0n);
  return {
    box: {
      on: true,
      results: asked.codes,
      codes: applied.map((result) => result.code),
      discountMinor: applied.length ? discount.toString() : null,
      freeShipping: applied.some((result) => result.ok && result.freeShipping),
      message: null,
    },
    answer: asked.answer,
    ok: applied.length === asked.codes.length,
  };
}
