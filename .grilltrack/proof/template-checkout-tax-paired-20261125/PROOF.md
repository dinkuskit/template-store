# Checkout sales tax: a real checkout, end to end

Checkout asks Tax, and Tax's answer goes to Commerce beside the coupon's (dinkuskit/tax ledger `shared-addons-door`). Taken on 25 Nov 2026 on a local store (`astro dev`, EmDash 1.6.0) built from this branch, with these mounted as sandboxed plugins:

- Commerce from dinkuskit/commerce main `1c5f93f` (the Orders note, #321);
- Tax from dinkuskit/tax#2 (`115be3c`);
- Coupons from dinkuskit/coupons main `100b788`.

Every request went through EmDash's own route dispatch. Payments was the repository's stand-in (`tests/paired/helpers/dinkuskit-stand-in.mjs`), with two changes in the proof's own copy:

- Every checkout session it was handed went through Payments' real `validatePaymentRequest` and `createPricedChargeLines`, bundled from dinkuskit/payments main `9d7479c` (the code the live Payments Worker runs). So each "Payments" line below is what Payments itself accepted and the Stripe lines it built.
- A session the proof marks paid looks up as paid.

Tax's tables came from the same stand-in at `tables.dinkuskit.com`, built from Tax's own Tennessee fixtures (rate file and Nashville boundaries, as of 24 Nov 2026).

The owner's setup:

- Alabama switched on with a typed 9.25%, Tax shipping ticked.
- Tennessee switched on with official rates, downloaded through the Sales tax page.
- A 25% coupon, SPRING25.
- Flat $5.00 shipping.
- The store sells and ships to the US.

The full trace is in [trace.txt](trace.txt). The screenshots live in dinkuskit/dinkus-pr-assets, at [`template-store/pr-276-a50339b/`](https://github.com/dinkuskit/dinkus-pr-assets/tree/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b), whose README gives each file's size and SHA-256.

| Check | What happened | Screenshot |
| --- | --- | --- |
| **A.** Alabama, typed rate, with a coupon: two $15 mugs, SPRING25 | Discount −$7.50. Tax answered 9.25%, kept with the code `rate-typed-by-owner`. Commerce priced $22.50 + $5.00 shipping + $2.54 tax = $30.04. Payments accepted it and built the Stripe lines "Camp mug × 2 $22.50, Shipping $5.00, Sales tax $2.54". So the tax was worked out on the discounted price. | [a-1-checkout-al-coupon.jpg](https://github.com/dinkuskit/dinkus-pr-assets/blob/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b/a-1-checkout-al-coupon.jpg), [a-2-sent-to-stripe.jpg](https://github.com/dinkuskit/dinkus-pr-assets/blob/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b/a-2-sent-to-stripe.jpg) |
| **B.** Tennessee, official rates, address in the table: $80 boots to 1 Public Square, Nashville 37201 | Tax matched the street: 9.75% (the Nashville district in the fixture table), with no note. Payments got Sales tax $8.29 of $93.29. | [b-1-checkout-tn-street.jpg](https://github.com/dinkuskit/dinkus-pr-assets/blob/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b/b-1-checkout-tn-street.jpg) |
| **C.** Tennessee, a street the table does not hold: 999999 Nowhere Rd, 37201 | Tax fell back to the ZIP: 9.75%, with the code `by-ZIP,-check-address`. The proof marked the session paid. The shopper came back to the thank-you page, and reading the cart made Commerce's order #1001 ($8.29 tax, $93.29). The order keeps `addons: [{from: "dinkus-tax", ref, codes: ["by-ZIP,-check-address"]}]`. Commerce > Orders shows **"Sales tax · by ZIP, check address $8.29"** at desktop and phone width. | [c-2-thank-you.jpg](https://github.com/dinkuskit/dinkus-pr-assets/blob/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b/c-2-thank-you.jpg), [c-3-orders-list-1440.jpg](https://github.com/dinkuskit/dinkus-pr-assets/blob/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b/c-3-orders-list-1440.jpg), [c-4-order-1001-tax-note-1440.jpg](https://github.com/dinkuskit/dinkus-pr-assets/blob/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b/c-4-order-1001-tax-note-1440.jpg), [c-4-order-1001-tax-note-390.jpg](https://github.com/dinkuskit/dinkus-pr-assets/blob/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b/c-4-order-1001-tax-note-390.jpg) |
| **D.** Digital only: a $10 PDF, no delivery address, billing in Alabama | Tax was asked for the billing address: 9.25%, Sales tax $0.93, total $10.93. There was no shipping line. | [d-1-checkout-digital-billing.jpg](https://github.com/dinkuskit/dinkus-pr-assets/blob/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b/d-1-checkout-digital-billing.jpg) |
| **E.** Illinois, not switched on: a $15 mug to Chicago | Tax answered nothing and kept nothing (5 answers before and after). Checkout went on untaxed: Payments got $20.00 with no tax. | [e-1-checkout-il.jpg](https://github.com/dinkuskit/dinkus-pr-assets/blob/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b/e-1-checkout-il.jpg) |
| **F.** Callers from outside the store's own code | Anonymous calls to Tax's `checkout/answer` and Commerce's `checkout/addons/start` got `401 UNAUTHORIZED`. A signed-in Administrator got `STORE_ONLY` from both. | |
| **F2.** Tax fields forged into the checkout form: hidden `tax`, `rate`, `shipRate`, `answer` and `addons` fields set to a zero rate | They were ignored. The checkout asked Tax itself, and Payments got Sales tax $1.85 on a $15 mug with $5 shipping (9.25%). | |
| **F3.** The shopper's cart key with a wrong secret, then Pay | 422 and an empty cart. Tax answers, Payments calls, sessions and checkout attempts were unchanged (6, 29, 6, 6 before and after). | [f-cart-key-refused.jpg](https://github.com/dinkuskit/dinkus-pr-assets/blob/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b/f-cart-key-refused.jpg) |
| **F4.** A cart key revoked after it was handed out (Commerce's record deleted), then Pay | The same: 422, an empty cart and nothing changed. | [f-cart-key-refused.jpg](https://github.com/dinkuskit/dinkus-pr-assets/blob/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b/f-cart-key-refused.jpg) (the same page) |
| **G.** A stale quantity: the checkout tab shows 1 mug, a second tab adds 2 more, then the first tab pays | Pay charged the cart as it is now. Tax was asked for 3 mugs, and Payments got "Camp mug × 3 $45.00, Shipping $5.00, Sales tax $4.62". The stale page's 1 was never charged or taxed. | |
| **H.** Tax cannot answer: Tennessee is on, but the store no longer holds a table in use for it | "Sales tax can't be worked out right now. Try again in a moment." No checkout attempt, Payments call or tax answer was made. | [h-tax-unavailable.jpg](https://github.com/dinkuskit/dinkus-pr-assets/blob/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b/h-tax-unavailable.jpg) |
| **I.** Confirmed absence: the store restarted without Tax | Checkout went on untaxed to the Tennessee address: Payments got $85.00, with no tax line and no add-on. | |
| **I2.** Tax installed but cannot be asked: an active Registry install of `dinkus-tax` in the store's database, not loaded | The same "can't be worked out" message, and nothing started. | [h-tax-unavailable.jpg](https://github.com/dinkuskit/dinkus-pr-assets/blob/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b/h-tax-unavailable.jpg) (the same page) |
| **J.** Upgrade, on a phone (iPhone 13): a cart saved while the store had no Tax plugin; the store restarts with Tax; the same browser comes back | The saved cart (same id) loaded. Pay to 1 Public Square, Nashville was taxed at 9.75%: Payments got "Camp mug × 2 $30.00, Shipping $5.00, Sales tax $3.42" ($38.42). | [j-phone-checkout-tn.jpg](https://github.com/dinkuskit/dinkus-pr-assets/blob/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b/j-phone-checkout-tn.jpg) |

A mismatched address is not reachable from this form. The checkout always asks Tax for the address it then hands Commerce. The door's own refusal of an answer for another address is covered by Commerce's test "a tax answer for another address, or with a missing or malformed rate, freezes nothing" (`tests/features/checkout/checkout-pricing.test.mjs`).

## Stored data

This PR stores nothing new. The cart, its key and the order stay in Commerce, and the tax answer stays in Tax. A store without Tax keeps checking out untaxed exactly as before (I). A cart saved before Tax was installed loads and pays taxed afterwards (J).

## What the first try at H found

The proof first deleted Tennessee's table records straight from the plugin's storage. Tax still answered, because it keeps a table's district list in memory and a table never changes once stored. With no ZIP piece, the address read as an unknown ZIP. It then got the state's highest rate, flagged by ZIP, which is the owner's rule for an unknown ZIP. That is correct, not a failure, so H was taken again by removing the table in use instead. Both runs are in the trace.

## Small thing seen on the way

The thank-you page calls the row "Tax" while Payments, Stripe and Orders say "Sales tax" ([c-2-thank-you.jpg](https://github.com/dinkuskit/dinkus-pr-assets/blob/6c6c38bfdfbb73d8fcbd276f1fcf95234dc50544/template-store/pr-276-a50339b/c-2-thank-you.jpg)). That label is older than this PR, so it is left alone here.
