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
| Whole unit suite and types | `vitest run tests/unit` passed; `astro check` 0 errors | |

## Private routes through EmDash's own HTTP dispatch

On the same store, a shopper holding a real `dk_cart` cookie and calling the private routes directly got `401 UNAUTHORIZED` from Commerce's `checkout/addons/start` and from Coupons' `checkout/answer`, `checkout/release`, `courier/inbox` and `tools/save`. A signed-in Administrator got `STORE_ONLY` from `checkout/addons/start` and `checkout/answer`, and `COURIER_ONLY` from `courier/inbox`. Afterwards SPRING25 showed 0 used and 0 held, and the shopper's checkout had no payment held. The page's own Apply then priced the cart (−$4.50). The full trace is in dinkuskit/commerce#306 and dinkuskit/coupons#31.

Not proven here: a paid checkout through the add-ons door. The local store takes no payments. Commerce's workerd tests in commerce#306 prove the door's priced start, and a beta store run is the next check.
