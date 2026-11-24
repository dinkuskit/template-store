# Checkout coupon box

GrillTrack `template-checkout-coupon-box-20261124`. The owner approved the plain-form box on 24 Nov 2026.

## What the shopper sees

The discount box sits in the checkout page's order summary. It takes codes only when the store has the Coupons plugin (`dinkus-coupons`) installed, its Commerce has the add-ons door, the cart has items, and no payment is waiting. Otherwise the old disabled box stays. The playground never takes codes.

- **Apply** sends the whole checkout form with `intent=apply`. The page redraws with what was typed kept, each code's result, a Discount row, and "Free" shipping when a code gives free shipping. Nothing starts.
- **Remove** next to an applied code sends `couponRemove=<code>` and redraws the same way. A different code typed in the input stays there without being checked.
- **Pay** checks the codes again. A refused code stops checkout and shows why. Otherwise checkout starts with the discount.

Pay goes ahead only when Coupons answered every code, every code applies, and the answer for Commerce came with them; anything less keeps checkout waiting. If the catalog or a product page can't be read, the codes aren't checked at all and the box says "Discount codes can't be checked right now".

If Pay stops before Coupons is asked (a contact field is refused, or checkout is closed), the codes are kept and what they take off is drawn again, holding nothing. If Coupons does not answer, each kept code is listed as "not checked yet" with its own Remove button, so the shopper can check out without it.

No script is needed. Applied codes ride along as hidden `coupon` fields, at most 6, each at most 64 characters, with repeats dropped whatever their case.

## How the store asks

EmDash plugins cannot call each other, so the store's own server code does the asking. Both calls are private plugin routes, made through `withEmDashRuntime` from `emdash/middleware` with nobody signed in (the courier does the same).

1. `POST checkout/answer` on Coupons with the cart key's public half, the visitor's connection, the email when one was typed, the codes, and the cart's lines. The lines come in Commerce's line order (cart lines sorted by catalog item id). Each line has its unit price in cents, the product it belongs to, whether it is on sale (Commerce's public catalog flags a Sale price with `onSale: true`, Commerce `commerce-sale-flag-20261124`; the store never works it out from prices), and its product page's categories.
2. On Pay the same call carries `hold: true`, so each code that applies holds a use for this cart.
3. Coupons' `answer` goes to Commerce's private `checkout/addons/start` door (Commerce `commerce-addons-door-20261124`). Commerce checks the items, prices and quantities once more against the saved cart and does the totals.

Only a cart key that Commerce has just accepted names a cart to Coupons. A refused or revoked key never asks, holds or releases anything. When Pay goes ahead with no code, the store calls Coupons' `checkout/release` so the cart's held uses go back. Holds also lapse on their own after an hour.

Coupons counts a use when the store's courier brings Commerce's `order.paid` news, about once a minute. The courier asks for Commerce as `dinkus-commerce`, and finds it under its Registry id through EmDash's `registry_slug`, so the store pins `@dinkuskit/courier` at a commit with that lookup (dinkuskit/courier#4).

The store refuses Coupons' answer unless it comes `from: "dinkus-coupons"`, names every line in the order sent with the price and quantity sent, and every amount is whole cents. A refused or missing answer shows "Discount codes can't be checked right now" and keeps checkout waiting.

## Running it locally

```sh
DINKUS_PAIRED_COMMERCE_DIR=../commerce DINKUS_PAIRED_COUPONS_DIR=../coupons bash scripts/dev-fresh.sh
```

`DINKUS_PAIRED_COUPONS_DIR` mounts the Coupons build from a local checkout as a sandboxed plugin, the same way the paired Commerce mount works.
