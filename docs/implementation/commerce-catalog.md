# Merchant catalog consumption

## Shipping default

Shop on `/` consumes installed Commerce
`catalog/public` through EmDash public-only SSR dispatch
(`handlePublicPluginApiRoute`). The native Commerce plugin identity is
`dinkus-commerce`; the old registry runtime ID is legacy and is not used for
this catalog consumer. The request is a fresh public GET: no incoming cookies,
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

## Native-development proof

`DINKUS_CATALOG_PROFILE=native-development` mounts native `dinkusCommerce()` and
reads persisted plugin collections through EmDash `getDb` /
`PluginStorageRepository`, then Commerce public resolvers. Canonical proof
Playwright uses that profile. Shipping Playwright deletes it so the verifier
cannot pass on native storage while claiming the installed default.

On the native-development profile only: open EmDash admin → Products, add a name
and SKU, then set Regular in dollars. Reload `/` to see the product under Shop.
A lower Sale strikes Regular and displays Sale. Clear both price fields to
remove the product from public listings and its `/shop/<Commerce ID>` detail
page while retaining it in Products. An explicit zero Regular is a free listed
product. CMS merchandise cannot claim a Commerce identity. Server failures show
an unavailable catalog, never invented prices or stock. No public mutation
endpoint is added.

## Pins and boundaries

Exact Commerce source is `938cb06cc6c0a1e7f457e514076d608219e38c65` (the merge
commit containing Commerce #58). EmDash and
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

Native Products create still needs `DINKUS_CATALOG_PROFILE=native-development`.
Stop the server and back up the existing SQLite database before that upgrade.
EmDash registers native Commerce plugin storage; the Node scheduler materializes
the unique catalog indexes (up to one minute). Commerce refuses create until
those indexes exist. The merchant catalog starts empty; demo products are not
silently copied into Commerce storage.

## Verification

`bin/verify-web full` shipping projects
(`tests/e2e/shipping-storefront-profile.spec.ts`) prove the installed public
path without a native plugin: unavailable Shop, no invented product cards, no
add-to-cart, closed checkout, preview isolation, desktop and mobile.

Native Products create, Regular/Sale, Coming soon, and guest-cart add-to-cart
remain `tests/e2e/commerce-catalog.spec.ts` and `tests/e2e/guest-cart.spec.ts`
on the explicit native-development proof server. Existing suites retain the
Inventory sequence, manual availability, CMS authoring, editorial query card,
and preview isolation. Sanitized browser media is retained separately from
product source.
