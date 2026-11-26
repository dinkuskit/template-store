# Sales tax at checkout

This follows the dinkuskit/tax ledger entries `shared-addons-door` and
`tax-picks-rate-commerce-does-math`, which the owner approved on 24 Nov 2026.

## What the shopper sees

Sales tax is worked out when the shopper presses **Pay**. It is based on the
delivery address, or on the billing address when nothing ships.

- **On the hosted payment page.** Stripe Checkout shows "Sales tax" as its own
  line, and Authorize.net gets the tax amount.
- **After paying.** The thank-you page and `/track-order` show a Tax row (from
  Commerce's order pricing).
- **On the checkout page.** The summary still says "Calculated at checkout",
  as it did before.

An order to a state the owner has not switched on in Tax pays no sales tax, and
neither does any order when the Tax plugin is not installed.

## How the store asks

EmDash plugins cannot call each other, so the store's own server code does the
asking. It calls a private route with nobody signed in, the same way it asks
Coupons (`src/features/tax/index.ts`).

1. Pay first calls `POST checkout/answer` on Tax (`dinkus-tax`), before any
   coupon holds a use, so a checkout Tax stops ties up no coupon. It sends
   `{ address, lines }`:
   - `address` is the delivery address, or billing when nothing ships;
   - `lines` are the cart's lines in Commerce's line order (sorted by catalog
     item id), as `{ item, price, qty }` with the unit price in cents.
2. Tax answers with the rates for that address, or `{ answer: null }` when the
   address's state is not switched on. Then Coupons checks the codes and holds
   their uses.
3. The answer goes to Commerce's private `checkout/addons/start` door, beside
   Coupons' answer. Commerce takes the discounts off first and then works out
   the tax, so the store never sends Tax what a coupon took off. Commerce
   refuses a tax answer whose `to` is not the checkout's own address.

The store refuses Tax's answer unless all of these hold:

- it comes `from: "dinkus-tax"`;
- it names every line in the order sent, with the price and quantity sent;
- it takes nothing off a line;
- every rate is 0 to 999999 millionths;
- its codes, when it sends any, are at most 6, each 1 to 64 printable
  characters with no spaces, as the add-ons door takes them.

Tax sends one code when the Orders page should note how the rate was found:
`by-ZIP,-check-address` (matched only to the ZIP) or `rate-typed-by-owner`.
The order keeps it, and Commerce's Orders page shows it on the Sales tax row.

## When Tax does not answer

If Tax is installed but does not answer, or answers out of shape, checkout
waits. It also waits when Tax is installed but cannot be asked, or when the
store cannot tell whether it is installed. The shopper sees "Sales tax can't
be worked out right now. Try again in a moment." It waits when:

- Tax is loaded without its private `checkout/answer` route;
- an active Registry install of Tax is not loaded, or there are two, or one
  sits beside a Tax loaded by its own id (a local store);
- the store's plugin list cannot be read;
- Tax's reply only reads as "no answer" once turned into JSON (such as `NaN`).
  Only Tax's own `null` means untaxed.

Checkout starts untaxed only when the store is sure Tax is not installed, or
when Tax answers that the order's state is not switched on. Nothing starts
without the tax the order may owe.

## Running it locally

```sh
DINKUS_PAIRED_COMMERCE_DIR=../commerce DINKUS_PAIRED_TAX_DIR=../tax bash scripts/dev-fresh.sh
```

`DINKUS_PAIRED_TAX_DIR` mounts the Tax build from a local checkout as a
sandboxed plugin, as the paired Coupons mount does. It needs a Commerce build
with tax on the add-ons door (dinkuskit/commerce#309). A taxed checkout also
needs a Payments Worker that knows sales tax (dinkuskit/payments#129).
