# Product data, policy, and feed boundary

Issue #35 consumes Commerce through its documented public builders and the
installed public catalog dispatcher. Commerce-linked product pages call
`buildProductJsonLd`; valid editorial/unlinked pages call
`buildProductPreviewJsonLd` from `@dinkuskit/commerce/features/structured-data`.
Preview output contains exactly one Product with only the canonical URL and
visible page facts. The template never assembles an Offer or invents a SKU,
GTIN, price, or availability.

A resolved public Commerce product, including the selected variant member's
price and availability, emits one Product block. The visible SKU, GTIN, price,
and availability are the same facts. The canonical link, Product `url`, and
Offer `url` use the page origin (`Astro.site`, otherwise the request URL) and
the published `/products/{entry id}` path. 404, removed, and unavailable
(503) routes emit no Product block. The preview builder keeps valid published
editorial pages truthful without requiring a fabricated Commerce identifier.

`/shipping` and `/returns` render the same Commerce policy revision that
JSON-LD embeds. When a policy record is configured, `/shipping` and `/returns`
pair the authoritative Commerce `<dl data-shipping-policy>` /
`<dl data-return-policy>` summary box with the merchant-authored EmDash CMS
`entry.data.content` (`PortableText`) policy body (`[data-policy-body]`).
Both policy pages are exposed in the global Store Footer (`StoreFooter.astro`)
under **Policies & Care** (`aria-label="Policies & Care"`). Native development
has no mounted `policies/public` route, so that profile reads
`readPublicStorePoliciesFromStorage` from
`@dinkuskit/commerce/features/store-policies` after the public route is
unavailable. An installed or shipping profile does not open policy storage. An
invalid public payload still fails. With no policy records, both pages fail
closed—rendering only `[data-shipping-policy-unset]` /
`[data-return-policy-unset]` without `[data-policy-body]` or fabricated dollar
amounts, country codes, or day counts—and JSON-LD omits `shippingDetails` and
`hasMerchantReturnPolicy`. Seeds stay neutral.

The policy consumer validates amount/mode consistency, configured country
lists, day bounds, URLs, and known return enums before returning either record.
It reuses Commerce's exported money validation. Null policies and omitted
optional fields remain valid; malformed fields follow the existing failure
path instead of reaching policy text or JSON-LD. Native-development reads pass
through the same validation.

Return categories display as `Limited return window`, `Returns not accepted`,
or `Unlimited return window`. The original Commerce enum remains in the
`data-return-category` attribute for policy and JSON-LD verification.

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

The exact Commerce `0.3.0` source pin is
`288199275f61aec084c0e1e72b370ec74ea35369`. Its `catalog/public` and
`catalog/public/item` projections carry `feedChannels`; the existing parser
passes a non-empty projection to the feed builders and excludes missing or
empty eligibility. Native-development may still use its explicitly isolated
storage fallback. Shipping and registry profiles do not open that collection.
Primary and gallery media ids resolve through the same approved media lookup
as storefront images. Only resolved public image URLs enter the Commerce feed
builders; payload-supplied URLs and unreadable or unsafe media are omitted.
Relative approved URLs use the canonical site origin, while approved absolute
media URLs retain their origin.

Feeds return 503 when the public catalog route is unavailable. A healthy
catalog with no eligible published product links returns a valid empty 200
feed. The verifier accepts that empty XML/CSV document independently of
whether it discovers Commerce-linked or editorial-only pages, and rejects
malformed empty documents and wrong content types. A slash twin is never a
second feed document.

This is exact source/local proof only. It does not claim a Registry
installation, deployment, publication, or Google/Meta channel-account
connection.
