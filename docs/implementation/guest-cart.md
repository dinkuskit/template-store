# Guest cart and Commerce handoff

## Enhanced server-cart changes

While a quantity update or removal is saving, the cart section is marked busy, its quantity, Update, and Remove controls are disabled, and later change submissions are ignored rather than queued. The response replaces the currently attached cart section before controls are usable again. If the enhancement fails, the captured form submits through the plain route instead. This lock does not serialize Add or WebMCP operations, change Commerce's cart authority, or alter script-off forms. An agent change still updates the badge during the lock. Any cart redraw deferred by the lock is made once the shopper save settles, fetching fresh cart HTML from the server.

The authorized issue #20 extension preserves the existing template visual
language and EmDash composition. The cart belongs to the shopper presentation
layer. Its browser cache contains only validated product identities and positive
integer quantities. It has no trusted price, stock, payment or order state.

Current Commerce catalog reads supply displayed names, prices and availability.
A catalog-read failure must be visible and recoverable while preserving intent.
An unavailable, missing or unpriced product remains non-purchasable. This pilot
uses the review-qualified Commerce49 source 45ced324bfb2c39c0a1fe200e5d8ceda7c5581ef; it does not establish
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

Unknown cart details use a neutral position label such as Item 1; confirmed
missing or unlisted snapshots use Unavailable item 1. These are cart positions,
not product names or new identities. Do not show a catalog ID as the heading or
control name, cache an unpublished title, or change the saved identity/quantity.
Quantity and Remove controls include the current row label in their accessible
names, including after a refresh. A successful refresh restores the current
public Commerce name. The rendered cart/checkout regression is
`tests/e2e/guest-cart-fallback-labels.spec.ts` (desktop and phone; browser-local
snapshots, not real outage or payment proof).

The public `guest-cart/index.ts` entry is browser-safe. The declared
`guest-cart/ui.ts` entry exports Astro presentation components for page/feature
composition without bringing server-rendered components into the browser
module. The snapshot route consumes those public entries and the established
Commerce catalog read entry. It projects only shopper presentation fields,
sets `Cache-Control: no-store`, validates response shapes and bounds retry
requests with a five-second timeout.

Cache limits are presentation safeguards: 40 distinct product lines, quantities
from 1 through 99, safe bounded identities and a bounded raw string before JSON
parsing. They do not define stock or fulfillment rules. An invalid quantity
change restores the current cart quantity and explains that the cart has not
changed, so a visible rejected edit cannot disagree with the reviewed totals.
This uses the in-memory cart when a previous save failed, not an older persisted
quantity. If browser persistence fails, the existing saved cache stays intact
and visible notices explain that unsaved intent is lost when leaving or
reloading the page.

The cart page has one cart form, as Shopify's Dawn and Horizon themes do (GrillTrack `template-cart-checkout-saves-quantities-20261123`). Every line's quantity and Update button and the enabled Check out button belong to it and post to `/cart/update` as `updates[<line id>]=<quantity>`. The store saves every changed quantity in one cart write (0 removes a line, a blank or broken quantity refuses the whole form), then Update returns to `/cart` and Check out opens `/checkout`; a refused change stays on `/cart` with its message. Remove stays its own small `/cart/change` form. With script, Update is sent with fetch under the save lock above, and Check out pressed during a save waits for it, then goes as the plain form post. Agents keep `/cart/update.js`, which replaces the whole cart at a version.
