# Page title is the product's one name: paired proof

Decision: `template-page-title-is-name-20261026` (Commerce `catalog-page-title-is-name-20261026`,
`catalog-page-title-upgrade-order-20261026`). Issue #157.

`pnpm verify:paired-product-on-sale` runs this store's own publish check in front of a real
Commerce Registry sandbox build, on desktop Chromium and a Pixel 7 viewport. Step 6b renames the
published product page (PUT title, then publish) and checks the Commerce catalog record, the public
catalog and the product page heading.

| Run (26 Oct 2026) | Commerce | `DINKUS_PAIRED_COMMERCE_NAMES` | Result |
|---|---|---|---|
| Committed pin | v0.6.0-beta.1 `1015f67`, plugin.mjs `f292f09c…` | 0 | 4 passed (14.8 min): Commerce 0.6.0 ignores `name`, the product keeps its name, every other step unchanged |
| Local pin to dinkuskit/commerce#188 head | `9d8f24c`, plugin.mjs `05ea64f0…`, index.mjs `785877ea…` | 1 | 4 passed (14.5 min): the shop, the catalog record and the product page heading show the renamed title on desktop and phone; the page that takes the product over names it |

The second run used a temporary copy of the script with the #188 commit and digests; the committed
pin stays on the released artifact until a Commerce release carries #188, when the pin moves and
`names` becomes true.

Unit coverage (`tests/unit/product-on-sale.test.ts`, 38 tests): the publish answer's title, no stale
pre-publish title, live versus unsaved draft title on undo, a scheduled sweep's title, a newer title
written when an older publish's write lands last (at most three writes per request), and the name
rules.
