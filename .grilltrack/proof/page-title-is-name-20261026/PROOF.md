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
| Committed pin, after review round 2 | v0.6.0-beta.1 `1015f67` | 0 | 4 passed (21.0 min): step 17 below; 0.6.0 refuses title-only writes, so nothing is renamed and the `retitle:` listing a demoted visitor leaves is cleared by the admin's next sweep |
| Local pin to dinkuskit/commerce#188 `6063d50` (adds title-only writes), after review round 2 | `6063d50`, plugin.mjs `fd13ccd6…`, index.mjs `785877ea…` | 1 | 4 passed (21.8 min): steps 6b and 17 on desktop and phone |

Step 17 (scheduled test, review round 2) is the authority-chain proof for the sweep's title catch-up.
An SQLite trigger fires on Commerce's own on-sale write of the scheduled product and changes the
page's live title at that moment; in the "revoked" variant the same trigger also lowers the admin
to Author. Kept: the sweep's read after the write sees the newer title and renames the product with
a title-only write (`name`, no `onSale`), so the catalog record and the shop show the new title.
Revoked: the visitor, read again before the title-only write, no longer holds
`content:publish_any`, so nothing is written; the product keeps the title sent with the on-sale
write and a `retitle:<page>:<product digest>` listing is left. With the admin restored, the next
sweep renames the product and clears the listing. In both variants the product stays on sale and no
write other than the original on-sale write touches sale state.

The second run used a temporary copy of the script with the #188 commit and digests; the committed
pin stays on the released artifact until a Commerce release carries #188, when the pin moves and
`names` becomes true.

Unit coverage (`tests/unit/product-on-sale.test.ts`, 41 tests): the publish answer's title, no stale
pre-publish title, live versus unsaved draft title on undo, a scheduled sweep's title, a newer title
caught up with title-only writes when an older publish's write lands last (at most three a request,
the rest listed for the sweep), title catch-up never writing `onSale` again (so it cannot sell a
product after someone else's unpublish and an Author's republish), Commerce 0.6.0 refusing
title-only writes (native code or sandboxed message) leaving nothing listed, a demoted visitor
writing nothing and leaving a listing an allowed visitor's later sweep finishes, the sweep keeping a
listing while Commerce is unavailable and dropping it for an unpublished page or another product,
and the name rules.
