# Merchant catalog consumption

## Shipping default

Shop on `/` consumes installed Commerce
`catalog/public` through EmDash public-only SSR dispatch
(`handlePublicPluginApiRoute`). The shipping Commerce Registry identity is
`r_gshdrqaldna3r7sn`, derived from publisher
`did:plc:ekk4pjmkh3k3ql2kfoex3qt4` and slug `dinkus-commerce` (the beta
package's is `r_fjzjvld3ssb4j63o`). The native `dinkus-commerce` identity is
the retired native copy's; only the playground still runs it, and shipping
never falls back to it. The request is a fresh public GET: no incoming cookies,
credentials, query parameters, or shopper capability. Every opaque cursor is
followed, including empty filtered pages. Display price is Commerce's projected
customer price; this template does not reconstruct a Regular/Sale pair.
`image` and `gallery[]` are kept when Commerce sends
`{ id, alt, width, height, placeholder }`. The card and product page map
`image.id` through EmDash `handleMediaGet` and `getPublicMediaUrl`, then
build `srcset` at 300/600/1200 through `/_image`. The public boundary admits
GET and HEAD `/_image` only when `href` is that same host's
`/_emdash/api/media/file/<key>`, `w` is at most 2048, and `f` is `webp`.
Other image targets stay 404. They never render a URL,
filename, or storage key from the catalog payload. An absent, unsafe, or
unresolvable image renders the text placeholder "No image". Gallery entries
stay on the product for a later view; cards show the primary image only.

Without a paired installed Commerce artifact that route is absent. Shop
fail-closes with an unavailable catalog and invents no products, prices, or
stock. Checkout stays closed. Native EmDash Products
(`/_emdash/admin/plugins/dinkus-commerce/products`) is not the shipping catalog
on this default.

A matching installed Commerce artifact is required before Shop can list live
Products on the shipping profile. Historical Commerce49/Payments12 package
fixtures keep their identities and do not qualify this pairing.

## Proof store on the Registry build

Commerce runs one build here, the Registry (sandboxed) one
(template-one-build-registry-20261031). The proof store (`pnpm dev:fresh`,
the browser tests' proof server) mounts the pinned Commerce's
Registry bundle through EmDash's `sandboxed: [...]` under its Registry runtime
id (`scripts/lib/paired-commerce.mjs`; `pnpm prepare:commerce` builds it once
per pin, `DINKUS_PAIRED_COMMERCE_DIR` points at a Commerce checkout being
developed). The storefront reads it exactly as a shipping store reads an
installed Commerce: the public catalog routes. Products are made the way the
owner's tools make them: a Content > Products page, its Dinkus Commerce panel
(or the private `catalog` route the CLI uses) for price and stock, and the
page's publish, which puts the product on sale. The demo catalog seeds itself
the same way on the first signed-in request
(`src/features/playground/demo-registry-seed.ts`). Shipping Playwright mounts
no Commerce at all, so the verifier cannot pass on a mounted plugin while
claiming the installed default. `DINKUS_CATALOG_PROFILE=native-development`
is refused.

On the proof store: open a Content > Products page, add a SKU and press Add
price and stock in its Dinkus Commerce panel, then set Regular in dollars and
publish the page. Reload `/` to see the product under Shop. A lower Sale
strikes Regular and displays Sale. Clear both price fields to take the product
off the shop while Commerce keeps it. An explicit zero Regular is a free listed
product. CMS merchandise cannot claim a Commerce identity. Server failures show
an unavailable catalog, never invented prices or stock. No public mutation
endpoint is added.

## Pins and boundaries

Exact Commerce source is `fca668447473a05dbe4c32897dc77d7e87ffac9a` (Commerce
#91, merged as `fca6684`, adding native public catalog routes). EmDash and
`@emdash-cms/cloudflare` are `1.2.0`. Managed products without a configured
provider fail closed as availability unavailable. No managed-stock admin or
provider transport is introduced. Inventory `8 → 5 → 8` remains the explicit
`DINKUS_STOREFRONT_PROFILE=proof` demonstration, not the shipping catalog.
Checkout, payment, deployment, and production-readiness are not claimed.

## Initialized local starters

`pnpm dev` uses the installed default. Shop is unavailable until a paired
installed artifact exists. The #34 `merchandise` → `products`/`categories`
change is intentionally breaking because no template-store site accepts real
orders. An old initialized database therefore fails closed with no canonical
product records; it is not automatically migrated, guessed, or used as a
fallback.

For a local site, export needed copy, back up the database and uploads, then
reseed or re-bootstrap from the current `seed/seed.json` and review Products,
Categories, and Pages. Do not use seed `update` or claim an automatic
`merchandise` migration. Existing live stores do not exist.

Stop the server and back up the existing SQLite database before that upgrade.
EmDash installs the mounted Commerce Registry bundle and builds its unique
catalog indexes on a fresh store's first requests; Commerce refuses create until
those indexes exist. The merchant catalog starts empty; demo products are not
silently copied into Commerce storage.

## Verification

`bin/verify-web full` shipping projects
(`tests/e2e/shipping-storefront-profile.spec.ts`) prove the installed public
path with no Commerce mounted: unavailable Shop, no invented product cards, no
add-to-cart, closed checkout, preview isolation, desktop and mobile.

Product create, Regular/Sale, stock status and guest-cart add-to-cart are
`tests/e2e/commerce-catalog.spec.ts` and `tests/e2e/guest-cart.spec.ts` on the
proof server, which runs the pinned Commerce's Registry build and speaks only
its routes. Existing suites retain the Inventory sequence, manual availability,
CMS authoring, editorial query card, and preview isolation. Sanitized browser
media is retained separately from product source.
