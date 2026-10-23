# Tour step 1 opens Content > Products (playground-tour-step-one-content-products-20261023)

Local playground build (`astro build --config astro.playground.config.mjs`, EmDash 1.2.0), run with
`wrangler dev --local` and driven by Playwright through the real admin, 23 Oct 2026.

| Moment | Shop product page | Tour |
| --- | --- | --- |
| Fresh visitor | seeded short description | 0 of 4; Edit a product is next and its button opens `/_emdash/admin/content/products` |
| Short description changed, Save pressed | unchanged (the editor says "Visitors still see the published version") | Edit a product not ticked |
| Publish changes confirmed | shows the new description | "Done: Edit a product", next is Connect Payments |

The other tick on the way (1 of 4 after Save) is Look at your shop, because the proof opened the shop page.

Unit coverage: `tests/unit/playground-existing-state.test.ts` "ticks Edit a product when the visitor publishes a
change to a product page in Content > Products", plus the existing upgrade test that keeps a catalog change made
before the tour. `tests/unit/playground-plugins.test.ts` checks the step's link.

Only published product pages count: a new product saved as a draft does not tick the step until it is published
(`tests/unit/playground-existing-state.test.ts`, "doesn't tick Edit a product for a new product that is only a draft,
until it is published"; it fails when the query also reads drafts).
