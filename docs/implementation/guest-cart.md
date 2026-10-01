# Guest cart and Commerce handoff

The authorized issue #20 extension preserves the existing template visual
language and EmDash composition. The cart belongs to the shopper presentation
layer. Its browser cache contains only validated product identities and positive
integer quantities. It has no trusted price, stock, payment or order state.

Current Commerce catalog reads supply displayed names, prices and availability.
A catalog-read failure must be visible and recoverable while preserving intent.
An unavailable, missing or unpriced product remains non-purchasable. This pilot
uses exact Commerce source ab37cd7f362f1c37cb1d321192abbbc48a623833; it does not establish
registry-installed Commerce storage or route authority.

## Contract dependency

Commerce issue #32 owns the trusted tenant-scoped guest capability, immutable
checkout aggregate, Payments binding and durable status projection. Before its
public entry and exact artifact handoff, the template checkout control stays
disabled. The template must not guess endpoint shapes or build a second pricing
or order writer. Redirects, cancel navigation, timers, browser storage and query
parameters cannot confirm payment or a terminal unpaid session.

The next integration needs actual host identity/storage/route proof and:

- Submit only product identities and quantities; let Commerce reread authority.
- Keep guest capability and attempt identity across reload, network retry and
  delayed return; disable accidental repeat submission without replacing server
  retry safety. Preserve an active frozen purchase independently of later edits.
- Render Confirming payment until Commerce reports a durable paid order, then
  render only the guest-safe receipt. Bound status retries. Unknown, forged,
  failed and timed-out responses never confirm an order.
- Clear only the purchased cart after that authoritative confirmation and
  preserve unrelated newer intent.
- Verify real host integration, cross-cart/site denial, safe retry and a durable
  paid order. Synthetic-provider proof is labeled separately from actual Stripe
  test-mode proof. No live payment, credentials, deployment or release is
  authorized by the cart implementation.

The full issue remains open until those integration acceptance criteria and
exact compatible artifact pairing are met. Inventory is not needed for the
unmanaged v1 path. Shipping must follow its owner's actual contract; do not
invent rates. New checkout attempts use 1800..1860s; historical exact-1800 originals replay unchanged.

## Browser presentation boundaries

The public `guest-cart/index.ts` entry is browser-safe. The declared
`guest-cart/ui.ts` entry exports Astro presentation components for page/feature
composition without bringing server-rendered components into the browser
module. The snapshot route consumes those public entries and the established
Commerce catalog read entry. It projects only shopper presentation fields,
sets `Cache-Control: no-store`, validates response shapes and bounds retry
requests with a five-second timeout.

Cache limits are presentation safeguards: 40 distinct product lines, quantities
from 1 through 99, safe bounded identities and a bounded raw string before JSON
parsing. They do not define stock or fulfillment rules. If browser persistence
fails, the existing saved cache stays intact and visible notices explain that
unsaved intent is lost when leaving or reloading the page.
