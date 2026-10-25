# Proof: the store's publish check against a real Commerce build

GrillTrack decision: `template-product-states-20261023` (Commerce half in dinkuskit/commerce#180, released in
Commerce `v0.6.0-beta.1`, commit `1015f67eef99f0027d2033aff6b8832392cb1318`).

## What runs

`pnpm verify:paired-product-on-sale` (`scripts/verify-paired-product-on-sale.mjs`):

1. Fetches dinkuskit/commerce at the exact commit `1015f67eef99f0027d2033aff6b8832392cb1318` (`v0.6.0-beta.1`) and
   runs its own `npm run build`. Before anything runs, the checkout must be at that commit and the built files must
   match the released digests: `dist/sandbox/plugin.mjs`
   `f292f09c1c360f828a0c96614fd69342327b23374150088c6c151ff1b61ed471` (131,050 bytes) and `dist/sandbox/index.mjs`
   `c819be47393501fb38ed31e07251994db5fb9afb4c018467f5d9ef1c9890a665`. The same check covers a cached build and a
   checkout passed in `DINKUS_PAIRED_COMMERCE_DIR`; any mismatch stops the run.
2. Starts this store (`astro dev`, Node 24.22.0) on a fresh SQLite database with that bundle installed
   sandboxed, under the beta profile's runtime id `r_fjzjvld3ssb4j63o`, the way a Registry store installs it.
   `astro.config.mjs` does this only when `DINKUS_PAIRED_COMMERCE_DIR` is set and the build is not Cloudflare;
   no deployed store sets it.
3. Runs `tests/paired/product-on-sale.spec.ts` on a desktop browser and on a phone (Pixel 7), each with its own
   product in the same store. Every page change goes through EmDash's real content routes and
   this store's real middleware; Commerce answers from its sandboxed routes. Sale state is read from Commerce's
   storage rows and from its public catalog route, which is what the storefront lists.

## What it proves

| Step | Who | Action | Result |
| --- | --- | --- | --- |
| 1 | Admin | Content > Products page, Commerce panel, SKU, Add price and stock, Apply, autosave, price 12 | Product is a Draft (`offSale: true`), not in the public catalog |
| 2 | Admin | Publish now in the editor (and confirm) | Page published; product on sale with `pageId` recorded; public catalog lists it; panel says On sale |
| 3 | Same session, role lowered to Author | Unpublish, then Trash, of their own page | Both refused 403 by the store ("Ask an editor or admin"); page stays published; product stays on sale |
| 4 | Admin again | Unpublish | Page draft; product `offSale: true`; catalog empty |
| 5 | Author | Publish their own page | EmDash publishes the page; product stays a Draft; catalog empty |
| 6 | Admin | Opens the page (panel says Draft), publishes again | Product on sale |
| 7 | Admin | Existing store: product row stripped of `pageId`/`offSale` and page links removed (the shape Commerce 0.5.0 stored), then Unpublish and Publish | Unpublish takes it off sale and records the page; Publish puts it back on sale |
| 8 | Admin | Trash the page | Product off sale and lets go of the page (`pageId` gone); Commerce settings lists it under Products without a page |

Step 3 changes the role between requests in one signed-in session: a person who loses `content:publish_any` is
refused on their next request.

The Commerce panel itself needs `content:edit_any`, so an Author never sees it (EmDash answers 403); step 6 checks
the panel as an admin.

## Authority inside one request

The middleware reads the person again from EmDash's user store right before every Commerce write (put on sale,
take off sale, undo, trash release), and the write runs only if they still hold the route's own declared
permission; the write carries that freshly read person. So a person disabled, deleted or lowered while their
request is running writes nothing more: a publish leaves the product a Draft, an unpublish not yet started is
refused 403, and a failed page change is not undone onto sale. A product whose page is relinked to another
product while it is being put on sale is taken off sale again (the page is read back after the write), and
Commerce itself refuses a page that lost the product (`PRODUCT_PAGE_CONFLICT`). These in-request orders are
covered in `tests/unit/product-on-sale.test.ts` (18 tests); a real browser cannot land a role change between two
writes inside one request.

## Older Commerce

The middleware asks EmDash for the `catalog-items/set-on-sale` route's metadata first. Commerce 0.6.0 declares it
with `content:publish_any`, native and sandboxed. A native Commerce 0.5.0 has no such route, and a sandboxed 0.5.0
answers only that the plugin exists, with no permission; either way the store has no publish check, reads nothing
and calls nothing, so pages change exactly as before, including an Author's own unpublish and trash.

## Evidence

Screenshots from the run are written to `test-results/paired-product-on-sale/` (not committed):
`desktop-` and `phone-` versions of `1-draft.png`, `2-published-on-sale.png`, `6-author-published-still-draft.png`
and `8-trashed-product-without-page.png`.

## Known limits (owner decision in the project thread)

- A page published later by EmDash's Schedule goes live with nobody signed in, so its product stays a Draft until an
  admin presses Publish again.
- Two people publishing and unpublishing the same page at the same moment can leave the product a Draft behind a live
  page; publishing again fixes it. Neither limit can leave a product buyable behind an unpublished page.

## Not changed

The playground keeps the native Commerce `v0.5.0` source pin. That release has no `catalog-items/set-on-sale` route,
so the middleware treats the page as having no publish check and its pages change as before. Moving the pin to 0.6.0
also needs the playground's admin and e2e specs moved off Commerce's removed React admin, which belongs with the
0.6.0 promotion.
