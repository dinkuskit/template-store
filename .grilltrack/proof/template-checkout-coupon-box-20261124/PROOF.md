# Checkout coupon box proof

Decision `template-checkout-coupon-box-20261124`. Taken on 24 Nov 2026 on a local store from `scripts/dev-fresh.sh`, with the Coupons plugin built from dinkuskit/coupons#31 and Commerce built from dinkuskit/commerce#306, both mounted as sandboxed plugins.

| Check | Result | Screenshot |
| --- | --- | --- |
| The owner's Coupons page lists codes with their state and uses | BOOTS10, FREESHIP and SPRING25 ("0 of 100") listed, with the courier line and the time zone form | `coupons-page.jpg` |
| An $18 mug with SPRING25 (25% off) and FREESHIP applied | Both codes listed with Remove; Discount row −$4.50; Shipping "Free" | `checkout-box.jpg` |
| An unknown code | "NOPE: This code isn't valid." shown as an alert; nothing starts | `checkout-refused.jpg` |
| Coupon form reading and answer checks | `tests/unit/coupon-box.test.ts`, 5 passed | |
| Whole unit suite and types | `vitest run tests/unit` 573 passed; `astro check` 0 errors | |

Not proven here: a paid checkout through the add-ons door. The local store takes no payments. Commerce's workerd tests in commerce#306 prove the door's priced start, and a beta store run is the next check.
