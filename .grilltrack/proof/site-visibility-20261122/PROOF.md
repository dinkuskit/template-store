# Go live is the store's one search-engine switch (22 Nov 2026)

GrillTrack decision `template-site-visibility-20261122` (supersedes `template-product-url-indexing-028`). Run in a
cloud container, Node 24.22.0, EmDash 1.5.0, local SQLite stores only.

## Browser

`pnpm exec playwright test tests/e2e/site-visibility.spec.ts` (with `shipping-storefront-profile` and
`cms-pages-and-redirects`): 12 passed, 4 skipped by design.

On the shipping store, at desktop and phone size:

1. Settings > General shows **Staging**, "Hidden from search engines", and the **Go live** button.
   `/`, `/cart`, `/feeds/products.json` and `/robots.txt` all answer `X-Robots-Tag: noindex, nofollow`.
   `/_emdash/api/settings` answers no `X-Robots-Tag`, because EmDash's own routes keep their own headers.
2. After **Go live**, it shows **Live**, "Visible to search engines" and "Your site is live".
   The same four paths answer no `X-Robots-Tag`.

On the proof store, the same four paths stay `noindex, nofollow`.

The screenshots are hosted in dinkuskit/dinkus-pr-assets ([manifest](https://github.com/dinkuskit/dinkus-pr-assets/blob/052573d75e58a9858a87e72737f0d8b24080a220/template-store/pr-257-594b5a6/README.md) with sizes and SHA-256 digests):
[`desktop-1-staging.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/052573d75e58a9858a87e72737f0d8b24080a220/template-store/pr-257-594b5a6/desktop-1-staging.png), [`desktop-2-live.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/052573d75e58a9858a87e72737f0d8b24080a220/template-store/pr-257-594b5a6/desktop-2-live.png),
[`phone-1-staging.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/052573d75e58a9858a87e72737f0d8b24080a220/template-store/pr-257-594b5a6/phone-1-staging.png), [`phone-2-live.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/052573d75e58a9858a87e72737f0d8b24080a220/template-store/pr-257-594b5a6/phone-2-live.png).

## Unit

`vitest run`: 65 files, 548 tests passed.

- `site-visibility.test.ts`:
  - Only `false` (Go live) lets search engines in; staging, a store that never chose, and an unreadable setting all answer noindex, so even the request that runs step 007 is covered. It reads EmDash's settings snapshot, because the single-setting read turns a saved `false` into "not set".
  - `/_emdash` paths are EmDash's.
  - A read-only redirect gets a copy with the header.
- `storefront-upgrades.test.ts`: an older store's upgrade runs `007_start_in_staging` and ends with `site:staging` = true; a store whose owner already saved Live (`false`) or staging (`true`) keeps it through the upgrade and through full reruns.
- `public-boundary.test.ts`:
  - Every answer the Worker makes itself (the `/cart/` and slash redirects, and its refusals) carries `noindex, nofollow` on a merchant store too, since those never reach the staging check.
  - The shipping profile gets no env noindex, and `DINKUS_LAUNCH_INDEXABLE` changes nothing.
  - The proof profile stays noindex.
  - The Worker keeps a noindex that the store set.

`bin/verify-web quick` passed.
