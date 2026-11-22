# Product data, policy, and feed boundary

Issue #35 consumes Commerce through its documented public builders and the
installed public catalog dispatcher. Commerce-linked product pages call
`buildProductJsonLd`; valid editorial/unlinked pages call
`buildProductPreviewJsonLd` from `@dinkuskit/commerce/features/structured-data`.
Preview output contains exactly one Product with only the canonical URL and
visible page facts. The template never assembles an Offer or invents a SKU,
GTIN, price, or availability.

A resolved public Commerce product emits one Product block. Simple products
keep their public SKU, GTIN, MPN, price and availability. Selected variants use
only their own optional public member SKU with their price and availability;
parent/default-member identifiers are never substituted. The visible SKU line
still identifies the parent/default product (PR #146's deferred display policy),
not the selected member. Member GTIN/MPN are not projected and are omitted.

Commerce 0.8.0 has no public member SKU. On those older payloads, or if the
optional member SKU is malformed, variant selections retain only preview
Product page facts, without SKU or Offer. Price, availability, picker and cart
behavior are unchanged. Commerce PR #260 proposes the authoritative member
field; this consumer accepts it without changing the exact 0.8.0 pin or claiming
a new signed Registry release. Neither CMS labels nor parent identity can fill
the missing fact. The canonical link, Product `url`, and
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
document. The host supplies the published family canonical and, for each
projected selectable member, an optional `content.variantUrls` landing URL using
the product page's `?variant=<id>` selection. Request query parameters are never
copied; simple products retain only their canonical. Commerce owns row identity,
prices, availability and eligibility. A catalog item with no published CMS page
is omitted.

Commerce PR #282 proposes consuming these member landings when flattening
Google/Meta rows. The current pin's serializers ignore this additive host
metadata, so supplying it alone does not enable member rows or change the
Registry pin. Qualify the consumer release separately; no external channel
connection or complete Google/Meta admission is implied.

The exact Commerce `0.3.0` source pin is
`288199275f61aec084c0e1e72b370ec74ea35369`. Its `catalog/public` and
`catalog/public/item` projections carry `feedChannels`; the existing parser
passes a non-empty projection to the feed builders and excludes missing or
empty eligibility; no profile opens Commerce storage.
That eligibility decides the Google Merchant and Meta feeds only. The agent
catalog feed (`/feeds/agent-catalog.json`), `/llms.txt`, `/llms-full.txt` and
`/agents.md` list every listable, priced product with a published page while
the owner's catalog switch is on, with or without a feed channel
(GrillTrack `template-agent-feed-lists-all-20261122`).
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
