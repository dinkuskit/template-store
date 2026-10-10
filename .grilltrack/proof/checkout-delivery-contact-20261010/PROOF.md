# Checkout delivery contact proof (PR #52)

Branch `cursor/checkout-delivery-address-7f98`, follow-up commit on top of
`c4ac5d4` addressing ClawSweeper's P1 "Ignore hidden delivery fields for
digital carts".

## What changed

`readCheckoutContact` now receives the cart's current `needsDelivery` value.
When the cart is digital-only it returns `{ email }` and never reads the
hidden delivery inputs, so an address typed while the cart needed delivery
can neither reach Commerce nor block checkout after the cart becomes
digital-only.

## Evidence (local, Node 22.23.2, shipping-chromium-desktop)

New browser test `checkout start sends delivery only while the cart needs it,
even after fields go stale` records the real checkout-start request body that
the browser sends to Commerce's `/start` route (offline harness):

- Physical cart, address filled: body `contact` is
  `{ email, delivery: { name, line1, city, postalCode, country: "US" } }`.
- Same address filled, then Commerce's next catalog answer marks the item
  digital (Retry catalog update): the delivery section hides, its inputs still
  hold the old address, and the start body `contact` is exactly `{ email }`.
- Bodies are written to
  `runs/checkout-contact-proof/shipping-chromium-desktop/checkout-start-contact-bodies.json`
  with a screenshot `digital-after-physical-stale-fields.png`.

Reproduced first: with the previous `guest-cart-client.ts` the same test fails
(`Received + "delivery": Object {...}`); with the fix it passes.

Commerce refusals are still surfaced: the existing test
`checkout contact proof covers physical validation, Commerce refusal, filled
address, and digital omission` passes (shows "Delivery address is required").

Other local checks: `astro check` 0 errors; `vitest` 173 passed, 1 failed
(`seed-demo-repeat`, which fails identically on main in this sandbox because
fonts.google.com is unreachable); CI on the pushed head runs the full
`pnpm verify`.

## Authority boundary

The Commerce source pin (`8655f0c`, Commerce main containing #88 and #90) proves
development integration only. It is not installed Commerce artifact identity
or digest, and nothing here claims paired installed-Commerce readiness.
