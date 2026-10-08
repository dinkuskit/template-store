# Merchant catalog consumption

## Shipping default

Shop on `/` and `/shop/<Commerce ID>` consume installed Commerce
`catalog/public` through EmDash public-only SSR dispatch
(`handlePublicPluginApiRoute`). The Registry runtime identity is
`r_gshdrqaldna3r7sn`. The request is a fresh public GET: no incoming cookies,
credentials, query parameters, or shopper capability. Every opaque cursor is
followed, including empty filtered pages. Display price is Commerce's projected
customer price; this template does not reconstruct a Regular/Sale pair.

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

Exact Commerce source is `5ade2bd0e4480b8ec9220c7872d7445e35547a3e`. EmDash and
`@emdash-cms/cloudflare` are `1.2.0`. Managed products without a configured
provider fail closed as availability unavailable. No managed-stock admin or
provider transport is introduced. Inventory `8 → 5 → 8` remains the explicit
`DINKUS_STOREFRONT_PROFILE=proof` demonstration, not the shipping catalog.
Checkout, payment, deployment, and production-readiness are not claimed.

## Initialized local starters

`pnpm dev` uses the installed default. Shop is unavailable until a paired
installed artifact exists. Do not treat an empty or unavailable Shop as a cue
to reimport seed or replace edited Pages/Merchandise.

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
