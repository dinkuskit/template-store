# Checkout coupon box

GrillTrack `template-checkout-coupon-box-20261124`. The owner approved the plain-form box on 24 Nov 2026.

## What the shopper sees

The discount box sits in the checkout page's order summary. It takes codes only when the store has the Coupons plugin (`dinkus-coupons`) installed, the cart has items, and no payment is waiting. Otherwise the old disabled box stays. The playground never takes codes.

- **Apply** sends the whole checkout form with `intent=apply`. The page redraws with what was typed kept, each code's result, a Discount row, and "Free" shipping when a code gives free shipping. Nothing starts.
- **Remove** next to an applied code sends `couponRemove=<code>` and redraws the same way.
- **Pay** checks the codes again. A refused code stops checkout and shows why. Otherwise checkout starts with the discount.

No script is needed. Applied codes ride along as hidden `coupon` fields, at most 6, each at most 64 characters, with repeats dropped whatever their case.

## How the store asks

EmDash plugins cannot call each other, so the store's own server code does the asking. Both calls are private plugin routes, made through `withEmDashRuntime` from `emdash/middleware` with nobody signed in (the courier does the same).

1. `POST checkout/answer` on Coupons with the cart key's public half, the visitor's connection, the email when one was typed, the codes, and the cart's lines. The lines come in Commerce's line order (cart lines sorted by catalog item id). Each line has its unit price in cents, the product it belongs to, whether it is on sale, and its product page's categories.
2. On Pay the same call carries `hold: true`, so each code that applies holds a use for this cart.
3. Coupons' `answer` goes to Commerce's private `checkout/addons/start` door (Commerce `commerce-addons-door-20261124`). Commerce checks the items and prices once more and does the totals.

When Pay goes ahead with no code, the store calls Coupons' `checkout/release` so the cart's held uses go back. Holds also lapse on their own after an hour.

The store refuses Coupons' answer unless it comes `from: "dinkus-coupons"`, names every line in the order sent with the price sent, and every amount is whole cents. A refused or missing answer shows "Discount codes can't be checked right now" and keeps checkout waiting.

## Running it locally

```sh
DINKUS_PAIRED_COMMERCE_DIR=../commerce DINKUS_PAIRED_COUPONS_DIR=../coupons bash scripts/dev-fresh.sh
```

`DINKUS_PAIRED_COUPONS_DIR` mounts the Coupons build from a local checkout as a sandboxed plugin, the same way the paired Commerce mount works.
