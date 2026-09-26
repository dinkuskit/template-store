# Merchant catalog consumption

Commerce Products is the real public catalog. Open EmDash admin → Products
(`/_emdash/admin/plugins/dinkus-commerce/products`), add a name and SKU, then
set Regular in dollars. Reload `/` to see the product under Shop. A lower Sale
strikes Regular and displays Sale. Clear both price fields to remove the product
from public listings and its `/shop/<Commerce ID>` detail page while retaining
it in Products. An explicit zero Regular is a free listed product.

Commerce owns identity, price validation, and availability. The template reads
the same persisted plugin collections through EmDash public `getDb` and
`PluginStorageRepository` APIs, then calls Commerce public resolvers. It does
not copy admin data into the in-memory proof adapters. CMS merchandise cannot
claim a Commerce identity. Server failures show an unavailable catalog, never
invented prices or stock. No public mutation endpoint is added.

The exact Commerce source is `81a6f571b5ad3dcc73ba6af9a89bdb438c6a8e06`.
Products ships at that head; visual stock-status and Store hide controls do not.
The existing backend manual-availability contract is consumed as-is. Managed
products without a configured provider fail closed as availability unavailable.
No managed-stock admin or provider transport is introduced.

Commerce and Inventory are crucial side-by-side launch components. The existing
Inventory `8 → 5 → 8` demonstration remains explicitly separate from merchant
products. Its seeded CMS merchandise and unmanaged proof are retained under
Integration demonstrations; they are not the merchant catalog. Checkout,
payment, deployment, and production-readiness are not claimed.

## Initialized local starters

No seed or CMS collection changes are required. Stop the server and back up
the existing SQLite database before upgrading. Boot the new source against the
same DB and uploads directory. EmDash registers Commerce plugin storage; the
Node scheduler materializes the unique catalog indexes (up to one minute).
Commerce refuses create until those indexes exist. Do not reimport the seed or
replace edited Pages/Merchandise to enable Products. The merchant catalog starts
empty; demo products are not silently copied into real Commerce storage.

This is Node SQLite starter integration on EmDash 0.41.0, not a mounted
Cloudflare compatibility claim. Commerce still declares peer 0.40.1 at this
source; the starter verifier provides bounded 0.41 consumer evidence only.
EmDash #2768 remains the mounted Cloudflare index-materialization blocker;
that pilot still requires its recorded fork.

## Verification

`bin/verify-web full` includes `tests/e2e/commerce-catalog.spec.ts`: real Products
create, missing-Regular hide, Regular, Sale, invalid-price preservation, admin
reload, anonymous detail, authenticated public Edit hydration, and price clearing
on desktop and mobile. Existing suites retain the Inventory sequence, manual
availability, CMS authoring, editorial query card, and preview isolation.
Sanitized retained media is published separately to dinkus-pr-assets.
