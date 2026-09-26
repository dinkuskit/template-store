# DinkusKit Store Starter

The public integration and dogfood storefront for EmDash, DinkusKit Blocks,
Commerce, and Inventory.

Org direction: [Vision](https://github.com/dinkuskit/.github/blob/main/VISION.md)
and [Roadmap](https://github.com/dinkuskit/.github/blob/main/ROADMAP.md).

## Merchant catalog

EmDash **Products** now drives the real Shop on `/`: add a name and SKU, save
Regular to list it, optionally save Sale, or clear prices to hide it publicly
while retaining it in admin. Product details live at `/shop/<Commerce ID>`.
See [operator steps and upgrade boundaries](docs/implementation/commerce-catalog.md).
Commerce and Inventory are crucial side-by-side launch components. Existing
seeded merchandise and Inventory proofs are separate integration demonstrations,
not merchant products. No checkout or production-readiness claim is made.

## Separate integration demonstrations

The classic catalog first slice adds EmDash-managed merchandise entries and
collection navigation for tees, hoodies, and hats, with collection and individual product pages. The hero and product grid are
neutral; preview cards say they are not purchasable. Two connected styles carry
real availability in compact summaries below the grid; card availability links jump to those
summaries, while detail links open product pages, and technical facts remain available in expandable details. Other
styles are editorial previews. The underlying
availability vertical remains deliberately smaller than checkout:

```text
EmDash composition -> Dinkus Blocks
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

A database initialized before the Merchandise collection was added does **not**
automatically receive that collection when the source or seed file changes. Stop
the dev server, back up the existing SQLite database, then apply the new seed
with conflict handling set to `skip`:

```bash
sqlite3 .artifacts/dev/content.db ".backup .artifacts/dev/pre-merchandise-backup.db"
pnpm exec emdash seed --database=.artifacts/dev/content.db --on-conflict=skip seed/seed.json
```

Use the actual SQLite path if `DINKUS_TEMPLATE_DB_URL` differs from the local
default. `skip` preserves existing Pages, including edits, while adding the
missing Merchandise collection and starter entries; do not use `update` to
replace edited content. Restart the server and check Pages → home and
Merchandise in the EmDash admin before using the catalog. This is a local
starter migration, not a production deploy or a data migration for live stores.

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

The intended eventual starter command remains:

```bash
npm create astro -- --template dinkuskit/template-store
```

Part of [DinkusKit](https://github.com/dinkuskit). Under construction,
dogfooding in the open. MIT.
