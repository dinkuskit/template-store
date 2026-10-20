# Product data, policy, and feed boundary

Issue #35 consumes Commerce through its documented public builders and the
installed public catalog dispatcher. Product pages call
`buildProductJsonLd` from `@dinkuskit/commerce/features/structured-data`.
The template does not assemble a schema.org Product or Offer and does not
invent a SKU, GTIN, price, or availability.

A resolved public Commerce product, including the selected variant member's
price and availability, emits one Product block. The visible SKU, GTIN, price,
and availability are the same facts. The canonical link, Product `url`, and
Offer `url` use the page origin (`Astro.site`, otherwise the request URL) and
the published `/products/{entry id}` path. Editorial pages that do not resolve
to a public Commerce product stay without a Product block. The pinned builder
requires `product.sku` and cannot represent those pages without a fabricated
SKU, so this template does not claim a Product block on every published page.

`/shipping` and `/returns` render the same Commerce policy revision that
JSON-LD embeds. Native development has no mounted `policies/public` route, so
that profile reads `readPublicStorePoliciesFromStorage` from
`@dinkuskit/commerce/features/store-policies` after the public route is
unavailable. An installed or shipping profile does not open policy storage. An
invalid public payload still fails. With no policy records, both pages say the
policy is not configured and JSON-LD omits `shippingDetails` and
`hasMerchantReturnPolicy`. Seeds stay neutral.

JSON-LD embedded with `set:html` escapes `<` so a merchant description cannot
close the script tag.

The stable feed endpoints are:

- `/feeds/google-merchant.xml`
- `/feeds/meta-catalog.csv`

They use `buildGoogleMerchantFeed` and `buildMetaCatalogFeed` from
`@dinkuskit/commerce/features/feeds`. A trailing slash is not a second
document. Each row links the published product canonical. Identity is the
Commerce item id. A catalog item with no published CMS page is omitted. Price
is included only when the public item has top-level `unitMinor`.

`catalog/public` at `cbc636eab20ee7759107f3a10ddff776cebe7dd8` does not project
`feedChannels`. When the public payload includes a channel array, including an
explicit empty array, that array is the eligibility. When the field is absent
and `DINKUS_CATALOG_PROFILE=native-development`, the feed joins
`loadProductFeedEligibility` for the same record
`catalog-items/set-feed-eligibility` writes. Shipping and registry profiles do
not open that collection and do not invent an opt-in. A registry install
therefore cannot populate channel feeds until `catalog/public` projects
`feedChannels` or a public eligibility read exists. Feeds return 503 when the
public catalog route is unavailable.

Neither lane claims a Registry install, a deployment, a publication, or a
Google or Meta account connection.
