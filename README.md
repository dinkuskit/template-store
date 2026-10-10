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
while retaining it in admin. Canonical product details require a published
EmDash Product at `/products/<slug>`; Commerce-only items have no detail URL.
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
new `products` and `categories` routes have no records to publish, rather than
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

### Disposable playground

The public playground is a separate Worker application and does not use the
demo Worker or its D1 database:

```bash
pnpm prepare:sources
pnpm exec astro dev --config astro.playground.config.mjs
pnpm exec astro build --config astro.playground.config.mjs
pnpm exec wrangler dev --config dist/server/wrangler.json
```

Visit `/playground`. EmDash creates an anonymous admin session backed by a
private Durable Object SQLite database, applies this repository's
`seed/seed.json`, and expires the database after about one hour. Checkout
continues to render the existing unavailable state; the playground has no
payment or coupon bindings. Every response is noindex.

Before a public preview is enabled, infra-keeper must add a Cloudflare Rate
Limit bindings named `PLAYGROUND_CREATION_LIMITER` and
`PLAYGROUND_GLOBAL_LIMITER` to `wrangler.playground.jsonc` (per-IP and global
caps for `/_playground/init`). The project-owned hook in
`src/playground-middleware.ts` consumes both and returns a friendly 429.

GitHub Actions builds with `astro.playground.config.mjs`. On a PR it uploads
the preview Worker with `wrangler versions upload --preview-alias pr-N`; on
`main` it deploys the same separate Worker to `playground.dinkuskit.com`. Each
deployment message records the template-store SHA and the pinned Commerce
commit. The preview check is intentionally the custom-domain URL
`https://pr-N.playground.dinkuskit.com`, never a `workers.dev` URL.

The only CI secret is `CLOUDFLARE_PLAYGROUND_API_TOKEN`. Ryan should create a
Cloudflare API token with exactly `Account > Workers Scripts > Edit`, limited
to account `cddb32366789cab1bdf4c25584dc1920`; it needs no Zone DNS, account
read, payment, coupon, or secret permissions. Cloudflare-side approval is
still required for the `playground.dinkuskit.com` custom domain, its
`pr-*.playground.dinkuskit.com` preview hostnames/wildcard DNS, and the two
rate-limit namespaces. This change intentionally performs no deploy or
resource creation.

CI always builds the playground, but the upload, preview check and `main`
deploy steps run only when the repository variable
`PLAYGROUND_DEPLOY_ENABLED` is `true`. Set it after the one-time Cloudflare
setup above is approved. Wrangler deploys the build's generated
`dist/server/wrangler.json` (from `wrangler.playground.jsonc`, whose `main`
stays `src/playground-worker.ts` so the Astro build can resolve it).

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
