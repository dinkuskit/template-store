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

## Authority and links changed inside one request

Before each write that can make a product buyable (putting it on sale, or undoing an off-sale write after a failed
page change) and before the off-sale write that gates an unpublish or trash, the middleware reads the person again
from EmDash's user store and writes only if they still hold the route's declared permission, carrying that freshly
read person. Off-sale writes later in the same request only take back what this allowed request started, so they
always run: a person who lost the permission meanwhile never leaves a product buyable behind a page this request
changed. After every on-sale write the page is read back, and the product goes off sale again if the page is no
longer published with it.

Steps 9-12 of the same paired run prove this against the real runtime. SQLite triggers land each change at an exact
point between the request's own writes (when EmDash writes the page row, or when Commerce writes the product row);
a second page sells the product released in step 8:

| Step | Change inside the request | Result |
| --- | --- | --- |
| 9 | Admin publishes; lowered to Author the moment EmDash publishes the page | Page live; Commerce never puts the product on sale (`offSale: true`, no page recorded); catalog empty |
| 10 | Admin unpublishes; lowered to Author at Commerce's off-sale write, then the page change is refused | Request fails; page still published; product stays off sale (no undo without the permission); catalog empty |
| 11 | Admin publishes; at the on-sale write lowered to Author and the page unpublished from elsewhere | Read-back sees the page unpublished; the product is taken off sale again; catalog empty |
| 12 | Admin publishes; the page is linked to another product the moment it goes live | Read-back sees the new link; the first product is taken off sale again; catalog empty |

Control: the same run against the previous head's middleware (9190def, which checked the person only once per
request) fails at step 9: `expect(product(itemId).offSale).toBe(true)` received `undefined`, the product went on
sale for a person who had already lost the permission.

The same orders are covered in `tests/unit/product-on-sale.test.ts`.

## Older Commerce

The middleware asks EmDash for the `catalog-items/set-on-sale` route's metadata first. Commerce 0.6.0 declares it
with `content:publish_any`, native and sandboxed. A native Commerce 0.5.0 has no such route, and a sandboxed 0.5.0
answers only that the plugin exists, with no permission; either way the store has no publish check, reads nothing
and calls nothing, so pages change exactly as before, including an Author's own unpublish and trash.

## Evidence

Screenshots from the run are written to `test-results/paired-product-on-sale/` (not committed):
`desktop-` and `phone-` versions of `1-draft.png`, `2-published-on-sale.png`, `6-author-published-still-draft.png`,
`8-trashed-product-without-page.png`, `13-scheduled-on-sale.png` and `14-author-scheduled-still-draft.png`. The run with
steps 13-15 passed 4 of 4 (two tests, desktop and phone) in 10.2 minutes.

## Scheduled publishes (follow-up the owner chose, 25 Oct 2026 00:20 UTC: "Merge now, fix schedules next")

EmDash publishes a scheduled page from its own scheduler (a timer on Node, the Cron Trigger on Cloudflare) with
nobody signed in, so the publish check cannot put the product on sale then. Instead:

- The product-url plugin keeps a record per products page (`pending_sales`). Each schedule asked for through the admin
  or MCP is first proposed (who, their role then, the product, the time; a schedule from no person proposes no one).
  When EmDash has stored a schedule (`content:afterSchedule`), the proposal at that time becomes the page's grant; if
  overlapping proposals share the time, the one with the least authority is taken, and each stored schedule clears the
  proposals, so one request's proposal never lends its authority to another's schedule and a failed schedule grants
  nothing. EmDash's own scheduled publish marks the grant publishing, and published once it succeeded. A person's own
  publish, an unschedule, unpublish or trash removes the record.
- On the next request from someone holding the route's permission, at most once a minute per isolate, the store reads
  a batch of records (all before any write), resuming where the last sweep stopped. A published grant sells the page's
  product as that visitor when the page is published with the granted product and not scheduled again, and the person
  who scheduled it held the permission then and still does. Right before the write, the visitor is read again and the
  record must still be the one read; after it, the page and the record are read again, and if either changed the
  product goes off sale again. That off-sale write is first recorded (`takeback:<page>`) and retried on later sweeps
  until Commerce accepts it; it never sells. Anything else (an Author's grant, a page gone, unpublished or linked to
  another product) drops the record without selling; a record still in progress is kept until it is ten minutes old.

The same paired run proves it, on desktop and phone, with EmDash's real scheduler:

| Step | Who | Action | Result |
| --- | --- | --- | --- |
| 13 | Admin | Tries to schedule a live page whose product is a Draft (an Author published it) in the past: EmDash refuses after the plugin saw the proposal. Schedules another page 3 seconds ahead; no request is made until EmDash publishes it | Failed schedule: no grant, its product stays a Draft. Stored schedule: granted; published with the product still a Draft; on the admin's next visit (within a minute) the product goes on sale, the panel says On sale and the record is gone |
| 14 | Author (same person, role lowered) | After an admin unpublish, schedules their own page; EmDash publishes it; the admin visits | The admin's visit drops the Author's grant; the product stays a Draft; catalog empty |
| 15 | Admin | Schedules both pages; EmDash publishes both, so one sweep reads both grants. Triggers remove both grants the moment Commerce writes either product on sale, and refuse Commerce's off-sale writes | The first product is written on sale, its grant is gone, and the refused off-sale write is kept on the list; the second grant, read before and removed after that write, never reaches Commerce. Once Commerce accepts writes again, a later visit takes the first product off sale and clears the list: one on-sale write, one off-sale write, both products Drafts, catalog empty |

Unit tests in `tests/unit/product-on-sale.test.ts` and `tests/unit/product-url-plugin.test.ts` cover proposal and
confirmation (including a failed admin reschedule over an Author's stored schedule, a schedule from no person, and a
stored time that differs), the scheduler's publish, every removal, schedules by an Author or by someone who lost the
permission or gained it only later, a visitor without it, an older Commerce, a record removed or replaced before the
write and after it (including one removed by another write of the same sweep), overlapping proposals at the same time,
gone, unpublished, relinked and stale records, a refused sale kept for later, a refused off-sale write retried until
accepted, progress across batches, and the once-a-minute limit.

## Known limit (accepted by the owner, Ronald, 25 Oct 2026 00:20 UTC)

- Two people publishing and unpublishing the same page at the same moment can leave the product a Draft behind a live
  page; publishing again fixes it. It can never leave a product buyable behind an unpublished page.

## Not changed

The playground keeps the native Commerce `v0.5.0` source pin. That release has no `catalog-items/set-on-sale` route,
so the middleware treats the page as having no publish check and its pages change as before. Moving the pin to 0.6.0
also needs the playground's admin and e2e specs moved off Commerce's removed React admin, which belongs with the
0.6.0 promotion.
