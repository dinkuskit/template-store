# Check out saves typed quantities

Decision: `template-cart-checkout-saves-quantities-20261123` (locked 23 Nov 2026).

| Requirement | Source | Case | Evidence |
| --- | --- | --- | --- |
| Check out saves a typed quantity before checkout, script or not | Shopify Dawn `sections/main-cart-footer.liquid` (Check out is `type=submit form=cart name=checkout`); Shopify Horizon `snippets/cart-summary.liquid` (`form=cart-form name=checkout`) | Connected store, real enabled Check out: typed 3 then Check out shows `Quantity 3`, `$27.00` on /checkout and in /cart.js; script off, typed 4 shows `Quantity 4`, `$36.00` | `tests/paired/cart-checkout-saves-quantities.spec.ts`, desktop and phone, 2 passed |
| Check out pressed while a save is running waits, then goes | Horizon `assets/component-cart-items.js` `holdCheckoutForQuantitySave` | Update held on `/cart/update`; Check out clicked; still on /cart after 500 ms; released, /checkout shows `Quantity 2` | same spec |
| A save the store refuses while Check out waits keeps the shopper on the cart | Review finding on c5a6d49 | Update held, Check out clicked, the save answered `/cart?cart_error=UNAVAILABLE`: the cart shows the alert, stays on /cart, /cart.js keeps 2. On c5a6d49 the same case went on to /checkout | paired spec step 2b; failed on c5a6d49, passes now |
| An agent's change made while Check out waits is not written back | Review finding on c5a6d49; WebMCP redraw from 64352db | Shopper's save of 3 held, agent sets 5 through `Dinkus.actions.updateCart`, Check out clicked, released: /checkout shows `Quantity 5`. On c5a6d49 it showed `Quantity 3` | paired spec step 2c; failed on c5a6d49, passes now |
| Update saves every typed quantity, not only its own line | Dawn: one cart form holds every `updates[]` | Two lines, typed 2 and 4, Update on one line: subtotal `$144.00`, count cookie 6; script on and off | `tests/e2e/guest-cart.spec.ts` "one cart form saves every typed quantity", desktop and phone |
| A refused or broken form opens nothing | `readUpdatesForm` refuses blank, non-digit, over 99 | `updates[id]=` with `checkout=1`: `/cart?cart_error=INVALID_CART`, cart unchanged; open payment: `CHECKOUT_FROZEN`; cross-site post refused | e2e spec above; `tests/unit/server-cart.test.ts` |
| Unchanged quantities write nothing | | Same quantity posted: no Commerce cart write | `tests/unit/server-cart.test.ts` |
| Existing lock, focus and WebMCP behaviour unchanged | template-store#243, #246 | Held-save lock, keyboard Update focus, Remove focus, WebMCP redraw | `tests/e2e/guest-cart.spec.ts`, 18 passed with the shipping profile spec |

Run on 23 Nov 2026 against the pinned Commerce v0.9.0-beta.5 Registry build (6077448). The paired proof
loads `tests/paired/helpers/dinkuskit-stand-in.mjs` and a throwaway `EMDASH_ENCRYPTION_KEY`; it never
reaches Stripe, DinkusKit.com or Payments.
