# Billing address at checkout: paired proof

Storefront half of Commerce `commerce-billing-address-001` (dinkuskit/commerce#213,
merged as `501057e88cdfe8737ab9c056cd90910eaa7ffbd3`). Environment: Node 24.22.0,
EmDash 1.2.0. The template's Commerce source pin is that exact commit.

## Exact pair, fresh store

| Check | Result |
| --- | --- |
| `pnpm verify:playground-authority` (real Commerce built from the pinned `501057e`, a fresh in-memory store, the playground admission this PR changes) | `PASS_PLAYGROUND_NATIVE_AUTHORITY`: a guest checkout started with the contact the store now sends (`email`, `delivery`, `billing`) succeeds and settles a paid order; a different visitor, a reset session, a missing or expired binding and isolate loss are refused before Payments; 0 unauthorized Payments calls |
| Shipping browser specs, desktop and phone (`guest-checkout-feasibility`, `checkout-readiness-recovery`, `shipping-storefront-profile`) | 44 passed, 2 skipped: the ticked box sends a copy of delivery; unticked and digital baskets send the billing fields; an empty delivery still reaches Commerce's "Delivery address is required" |
| Unit tests | 566 of 567; the one miss (`seed-demo-repeat`) needs the `sqlite3` CLI, absent in this container |

## Existing store and checkouts already pending

- The retained checkout in the browser (`dinkus.guest-checkout.v1`) keeps
  `email` and `delivery` only to show them on the thank-you page. No start
  request is built from it: every start reads the contact from the form, so
  a shopper who resumes after the upgrade sends billing. The specs "retained
  lost first-start response remains recoverable after cart reload" and the
  `checkout-readiness-recovery` set pass with this head.
- A checkout started before the upgrade is replayed by Commerce before any new
  contact is read, so it neither needs nor gets a billing address (Commerce
  `tests/features/checkout/checkout-contact-integration.test.mjs`, "active
  historical original replays without new contact or a current requirements
  read"; commerce#213 review, head `b22e27f`). Its paid order shows Bill to
  "Not recorded".
- No storage format changes: neither the template's browser storage nor its
  CMS content gains a field.

## Rollout limit

A Commerce older than `501057e` refuses the `billing` key, and `501057e` or
newer refuses a checkout without it, so this template and that Commerce ship to
a store together: the beta store gets both on one refresh with Commerce
`0.7.0-beta.3`, on the owner's go. No real store runs either side yet (owner,
2026-10-29).

Not run here: `pnpm verify:playground-http`. In this container its local Astro
playground did not answer the init request ("fetch failed"), before any
checkout step.
