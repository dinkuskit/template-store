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

`/shipping` and `/returns` are the store's policies: EmDash pages the merchant
writes, which always show their own `PortableText` body (`[data-policy-body]`),
or `[data-shipping-policy-unset]` / `[data-return-policy-unset]` when the page
has no text (GrillTrack `policy-pages-content-20261031`, superseding this
decision's policy part; Commerce `policy-pages-are-content-20261031` retires
its policy records). There is no Commerce facts box and no policy read. Both
pages are exposed in the global Store Footer (`StoreFooter.astro`) under
**Policies & Care** (`aria-label="Policies & Care"`). Product JSON-LD carries no
`shippingDetails` or `hasMerchantReturnPolicy`: structured shipping and return
terms are deferred, and shipping markup will derive from Commerce's checkout
settings and shipping destinations when it comes. A published returns page with
text names itself as the store-wide return policy by link only: one
`OnlineStore` block whose `hasMerchantReturnPolicy` is a `MerchantReturnPolicy`
with `merchantReturnLink` set to the page's canonical URL
(`storeReturnPolicyJsonLd`); Google reads a store-wide return policy from that
link alone, and a merchant's Search Console or Merchant Center settings take
precedence over markup. Seeds stay neutral: no rates, country codes or day
counts.

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
empty eligibility; no profile opens Commerce storage.
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
