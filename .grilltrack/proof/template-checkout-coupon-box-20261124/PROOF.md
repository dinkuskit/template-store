# Checkout coupon box proof

Decision `template-checkout-coupon-box-20261124`. Taken on 24 Nov 2026 on a local store from `scripts/dev-fresh.sh`, with the Coupons plugin built from dinkuskit/coupons#31 and Commerce built from dinkuskit/commerce#306, both mounted as sandboxed plugins.

| Check | Result | Screenshot |
| --- | --- | --- |
| The owner's Coupons page lists codes with their state and uses | BOOTS10, FREESHIP and SPRING25 ("0 of 100") listed, with the courier line and the time zone form | `coupons-page.jpg` |
| An $18 mug with SPRING25 (25% off) and FREESHIP applied | Both codes listed with Remove; Discount row −$4.50; Shipping "Free" | `checkout-box.jpg` |
| An unknown code | "NOPE: This code isn't valid." shown as an alert; nothing starts | `checkout-refused.jpg` |
| Phone (iPhone 13): SPRING25 and FREESHIP applied | Both codes with Remove on one line each | `mobile-box.jpg` |
| Phone: Pay with an email the form refuses | "Enter a valid email address to continue."; both codes are kept as hidden fields and still listed, and the Discount row still shows −$4.50, so the next Pay carries them | `mobile-refused-email.jpg`, `mobile-refused-box.jpg` |
| Coupon form reading and answer checks | `tests/unit/coupon-box.test.ts`, 5 passed | |
| A refused or revoked cart key never holds or releases uses | `tests/unit/coupon-box-cart.test.ts`, 2 passed | |
| Pay waits unless every code has a result, applies, and comes with the answer for Commerce | `tests/unit/coupon-box-ready.test.ts`, 4 passed (3 fail without the fix) | |
| No code is checked when the catalog or a product page can't be read | `tests/unit/coupon-lines.test.ts`, 2 passed (1 fails without the fix) | |
| Whole unit suite and types | `vitest run tests/unit` passed; `astro check` 0 errors | |

## Private routes through EmDash's own HTTP dispatch

On the same store, a shopper holding a real `dk_cart` cookie and calling the private routes directly got `401 UNAUTHORIZED` from Commerce's `checkout/addons/start` and from Coupons' `checkout/answer`, `checkout/release`, `courier/inbox` and `tools/save`. A signed-in Administrator got `STORE_ONLY` from `checkout/addons/start` and `checkout/answer`, and `COURIER_ONLY` from `courier/inbox`. Afterwards SPRING25 showed 0 used and 0 held, and the shopper's checkout had no payment held. The page's own Apply then priced the cart (−$4.50). The full trace is in dinkuskit/commerce#306 and dinkuskit/coupons#31.

## A paid checkout, counted by the courier

On a fresh local store with Payments stood in by `tests/paired/helpers/dinkuskit-stand-in.mjs` (plus a "paid" answer in the proof's own copy), a shopper applied SPRING25 to the $18 mug and pressed Pay. Coupons held one use under ref `h_b9e5….c_48ed…`, and Commerce's checkout kept the same ref, priced at $18.00 − $4.50 + $5.00 shipping = $18.50. Payments then reported the session paid, and Commerce's own 5-minute check made order #1001 with that ref in its `order.paid` news. The courier's first run handed it to Coupons: the hold went, one use was saved and the bookmark moved to the order. A second run, and the same batch delivered again from the old and the current bookmark, saved nothing. Anonymous and Administrator calls to the courier doors got `401 UNAUTHORIZED` and `COURIER_ONLY`, before and after, and changed nothing. The full trace and screenshots are in dinkuskit/coupons#31 (`proof/paid-checkout-20261124/`).

That run found the store's pinned courier could not find Commerce, because a Registry store names it by an opaque id. The courier pin moves to dinkuskit/courier#4, which looks Commerce up by its `registry_slug`. A Node dev store has no Cloudflare timer, so the proof ran the same `courierTick()` from a throwaway dev route, naming Commerce with the courier's `senders` option because a locally mounted plugin has no `registry_slug`.

## A forged cart key, and a $0 order

On the same kind of store ([edge-trace.txt](edge-trace.txt)):

- **A cart key Commerce refuses.** A shopper applied SPRING25. Their page's form, hidden coupon field included, was then posted with their cart id and a wrong secret. The store answered 422 and drew an empty cart (`edge-forged-key.jpg`). Coupons' holds, the shopper's checkout attempts and the Payments calls were 0, 0 and 0 before, and 0, 0 and 0 after. The real shopper's Pay right after still went to Stripe with one hold.
- **A $0 order.** FREE100 (100% off) and FREESHIP on the $18 mug with $5 shipping showed −$18.00 and free shipping (`edge-zero-applied.jpg`). Pay held both codes, and Commerce made the order paid at $0.00 without calling Payments (2 Payments calls before, 2 after). The shopper went to the order confirmation page.
- **What that found:** the confirmation page had no Discount row, so it read Subtotal $18.00, Total $0.00. It now shows "Discount -$18.00", as `/track-order` already does (`edge-zero-order.jpg`, `tests/unit/order-view-discount.test.ts`).

## A key revoked after it was accepted

On a fresh store ([revoke-trace.txt](revoke-trace.txt)), a shopper pressed Pay with SPRING25. Their key was accepted, one use was held, and the checkout attempt stayed open at the Stripe step (2 Payments calls). Commerce has no revoke button: a key stops working when Commerce no longer holds its record, and then answers `CAPABILITY_DENIED`. So the proof deleted that record from the store's database.

The same browser then posted the checkout form three times:
- Pay with SPRING25;
- Pay with no code, which would release the cart's holds if the key were accepted;
- Apply SPRING25.

Each answered 422 with an empty cart, and the box took no codes. Afterwards the hold was the same row with the same end time, the attempt was the same, and Payments calls were still 2.

## The box waits for Commerce's door

The box takes codes only when the store's Commerce declares the private `checkout/addons/start` route, not just when Coupons is installed. So installing Coupons on a Commerce release without the door leaves the old disabled box (`tests/unit/coupon-box-commerce-door.test.ts`). The revocation run above used Commerce from #306, and its box took codes as before.

## A quantity changed in another tab

Coupons' answer now names each line's quantity, the store refuses an answer whose quantity differs from the line it sent, and Commerce refuses one that does not match the saved cart (dinkuskit/commerce#306). On a fresh store with all three ([qty-trace.txt](qty-trace.txt)), a shopper applied SPRING25 to one $18 mug (−$4.50, `qty-1-applied.jpg`), changed the mug to 2 on the cart page in another tab, and pressed Pay on the first tab, which still showed −$4.50. Pay asked Coupons again with the saved cart, held one use, and Commerce priced 2 × $18.00 − $9.00 + $5.00 shipping = $32.00 before sending the shopper to Stripe (`qty-2-sent-to-stripe.jpg`). The old −$4.50 never reached checkout.

Not proven here: a real Stripe payment. A beta store run is the next check.
