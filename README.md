# DinkusKit Store Starter

The neutral EmDash storefront starter paired with DinkusKit Commerce. Shipping
v1 uses authoritative Commerce prices and manual availability with Inventory off.
The current source pilot is not a released, installable v1 pair. See
[setup and exact pairing](docs/v1-setup.md) and [demo plan](docs/v1-demo-plan.md).

Org direction: [Vision](https://github.com/dinkuskit/.github/blob/main/VISION.md)
and [Roadmap](https://github.com/dinkuskit/.github/blob/main/ROADMAP.md).

## Merchant catalog

EmDash **Products** now drives the real Shop on `/`: add a name and SKU, save
Regular to list it, optionally save Sale, or clear prices to hide it publicly
while retaining it in admin. Product details live at `/shop/<Commerce ID>`.
See [operator steps and upgrade boundaries](docs/implementation/commerce-catalog.md).
The default storefront has Inventory off. Existing seeded merchandise and
Inventory proof run only in the explicit development integration profile,
not as merchant products. The authorized guest-cart extension adds browser identity/quantity intent and current Commerce presentation. Checkout and production readiness remain release gates.

## Separate integration demonstrations

Run `DINKUS_STOREFRONT_PROFILE=proof pnpm dev` to view the demonstrations.
The default profile keeps them off the home and excludes connected fixture
products from collection and product routes. This remains a native source pilot.

The explicit development integration profile adds EmDash-managed merchandise entries and
collection navigation for tees, hoodies, and hats, with collection and individual product pages. The hero and product grid are
neutral; preview cards say they are not purchasable. Two connected styles carry
real availability in compact summaries below the grid; card availability links jump to those
summaries, while detail links open product pages, and technical facts remain available in expandable details. Other
styles are editorial previews. The underlying
availability vertical remains deliberately smaller than checkout:

```text
EmDash composition -> native EmDash Blocks
                    -> Commerce catalog + managed SKU
                    -> Inventory registration + stock truth
                    -> storefront availability
                    -> Commerce unmanaged catalog + manual availability
                    -> storefront sellability without quantity
```

The browser verifier observes an opening managed quantity of eight, applies a
real Inventory adjustment to five, then restores eight. It also observes the
unmanaged product default to In stock, then Out of stock, Available on
backorder, and back to In stock, with no quantity. Edit the hero in EmDash Pages → home, and edit names, collection names,
descriptions, and illustration styles in Merchandise. Connected status is reserved
for the exact seeded Everyday Tee and Canvas Cap entry IDs; all other entries
are non-purchasable previews.
The two connected Commerce identities, Regular/Sale prices, and availability are
owned by Commerce/Inventory, not by page content. Connected catalog cards and
product pages show Commerce prices only when Regular exists. The unpriced Commerce
draft stays off the public home; editorial preview entries remain explicitly
non-purchasable and have no invented prices. For these separate demo identities, merchant admin editing is not connected.
Cart, checkout, payments, shipping, deployment, persisted Manage Stock toggle,
and production persistence are not claimed yet.

The seed also includes one EmDash section, Home opener (`home-opener`). It is a
copied composition of the existing page hero and fact rail. The public home page
stays the ordinary Pages `home` content and does not call `getSection()`. A shop
owner inserts the section with `/section`, then owns that copy.

## Upgrade an initialized local starter

The #34 URL contract deliberately breaks databases initialized with the old
`merchandise` collection. No template-store sites accept real orders, so there
is no live-store migration path to preserve. An old database fails closed: the
new `products` and `collections` routes have no records to publish, rather than
silently treating old records as canonical products or crashing.

For a local site, back up the database and use the easiest manual upgrade:
reseed or re-bootstrap the site from the current `seed/seed.json`, then review
the new Products and Collections in EmDash. Preserve any copy you need by
exporting it first and re-entering it into the new schema; do not run an
automatic `merchandise` → `products` migration and do not use `update` to
replace edited content.

```bash
sqlite3 .artifacts/dev/content.db ".backup .artifacts/dev/pre-canonical-products-backup.db"
pnpm exec emdash seed --database=.artifacts/dev/content.db --on-conflict=skip seed/seed.json
```

If the old database cannot be reseeded cleanly, re-bootstrap a disposable
local site instead. Use the actual SQLite path if `DINKUS_TEMPLATE_DB_URL`
differs from the local default. This is an intentional source-pilot breaking
upgrade, not a production deploy or a data migration for live stores.

The same limit applies to the Home opener section. A database initialized before
that section was added does not gain it when the seed file changes, and a fresh
install verifier does not answer the upgrade. It is not a new collection. Stop
the server, back up the database, then apply the seed with `skip` so existing
page edits stay and the missing section is created:

```bash
sqlite3 .artifacts/dev/content.db ".backup .artifacts/dev/pre-home-opener-backup.db"
pnpm exec emdash seed --database=.artifacts/dev/content.db --uploads-dir=.artifacts/dev/uploads --on-conflict=skip seed/seed.json
```

Restart and confirm Sections shows Home opener. Do not use `update`.

## Editorial query cards

A shop owner can add a versioned Query Card to Pages `layout` to list at most
24 published records from one collection. New published records appear on
reload; drafts stay off the page. It renders only title, text, image, and a safe
link. It adds no filters, pagination, price, stock, or cart controls. Existing
Dinkus Portable Text Query Cards continue rendering on unmigrated content. See
[the admin steps and proof](docs/implementation/upstream-blocks-transition.md).

## Development

Requires Node `22.23.2` or another compatible Node 22 release and pnpm 11.

```bash
pnpm install
pnpm verify
pnpm dev
```

The Dinkus packages are pre-release exact Git pins. `pnpm dev`, `pnpm build`,
and the verifiers prepare Commerce's exact source in an ignored checkout, then
resolve Commerce and Inventory through their package-root source entries because
neither has an installable release yet. See
[`docs/implementation/managed-product-availability.md`](docs/implementation/managed-product-availability.md)
and
[`docs/implementation/unmanaged-product-sellability.md`](docs/implementation/unmanaged-product-sellability.md).

EmDash distributes templates as Astro projects. The released starter command
will name an actual approved immutable TemplateStore artifact and its exact
Commerce pair; no floating repository scaffold is a release instruction. The
current source checkout is development-only. See [the pairing audit](docs/v1-pairing.md).

Part of [DinkusKit](https://github.com/dinkuskit). Under construction,
dogfooding in the open. MIT.
