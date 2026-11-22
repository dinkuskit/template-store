# Stars and reviews on the product page

Decisions: `template-product-rating-20261122` (locked; the owner approved on
2026-11-22) for the rating under the title, and
`template-product-reviews-list-20261122` (locked; approved the same day) for
the list below the product. Reviews side: dinkuskit/reviews main `d6d2133`,
public raw route `list`.

## What the page does

| Case | Expected | Source of the expectation |
| --- | --- | --- |
| A product with published reviews | Under the title: stars, "4.5 / 5" and "(2)"; the count links to `#reviews` | Shopify Dawn `sections/main-product.liquid` rating block (stars, `value / scale_max`, `(count)`, drawn only when the product has a rating; a decimal part from 0.3 to 0.7 is a half star, above 0.7 the next whole star). WooCommerce `single-product/rating.php` links the count to `#reviews`. Both read 2026-11-22 |
| The same product, below the product | "2 reviews for Product", then each review newest first: stars, the shown name, "(verified buyer)", a dash, the date, the words, the store's reply | WooCommerce `single-product-reviews.php` ("N reviews for Product") and `review/review-meta.php` (author, "(verified owner)", dash, date) |
| More than 20 reviews | 20 on the page and a plain "More reviews" link to the next 20 (`?reviews=<cursor>#reviews`) | Reviews' `list` answers 20 a page with a cursor; 20 is our own number |
| A product nobody has reviewed | No stars, no "0 reviews", no reviews section | Dawn and WooCommerce both draw the rating only when there is one; Reviews answers `rating: null` |
| A store without Reviews installed | No stars, no reviews; `/review` answers 404 | The page asks the plugin inside its server; no plugin, no answer |
| Reviews answers something it does not promise, or fails | Nothing is shown and the product page still loads | A page must never fail because reviews could not be read |

Privacy: the page shows only what Reviews' public `list` gives (the name the
buyer chose, never an email address or order number), and nothing is drawn by
script.

The page changes no seed content and adds no menu link, so it needs no
self-upgrade step.

## How the proof store runs Reviews

`package.json` `dinkuskit.sourcePins.reviews` pins the exact Reviews commit.
`pnpm prepare:reviews` (run by `bin/verify-web` and cached in CI) fetches and
builds it under `.artifacts/paired-reviews/<commit>`, and the browser tests'
proof store mounts that build through EmDash's `sandboxed: [...]` under
Reviews' Registry id, the way a store that installed it runs it. Local dev, the
playground, the shipping store and every store build mount none.

## Observed (Node 24.22.1, 2026-11-22)

- `vitest run`: 66 files, 560 tests pass. `tests/unit/product-reviews.test.ts`
  covers the in-process call, EmDash's raw-route envelope, the next-page
  cursor, every "show nothing" answer (not installed, no rating, wrong
  product, wrong scale, too many reviews, an oversized answer, a thrown
  error), reviews that cannot be shown, and Dawn's star rounding.
- `astro check`: 0 errors. `check-features`, `check-worktree-text`: ok.
- `node --test tests/workflows/*.test.mjs`: 98 pass, 2 skipped, 8 fail. The 8
  are `playground-build-artifact.test.mjs` refusing this machine's Node
  24.22.1 against the 24.22.0 pin; they fail the same way on untouched main.
- Playwright, desktop and mobile Chromium, 12 pass:
  - `product-reviews.spec.ts` against the proof store running the pinned
    Commerce and the pinned Reviews. Reviews were written through Reviews' own
    `send` route. Trace, desktop (mobile matches):
    `no reviews yet: rating none shown, reviews none shown`;
    `two reviews (5 and 4 stars): "4.5 / 5", count 2, heading "2 reviews for
    Reviewed Mug desktop", Reviews keeps {value 4.5, count 2}`;
    `23 reviews: 20 on the first page, 3 behind "More reviews"`;
    `another product with no reviews: rating none shown`. The title sits above
    the rating and the rating above the price; the count link lands on the
    reviews section; neither block holds a script, an email address or an
    order number.
  - `review-form.spec.ts` now runs against the real Reviews too: the emailed
    link opens the form, a post without stars answers 422 and keeps nothing, a
    5-star post is kept once, and refused posts (wrong secret, product not in
    the order, a link asked 61 days ago, another site) leave Reviews' storage
    byte for byte unchanged.
  - `shipping-storefront-profile.spec.ts` (no Reviews mounted): the product
    page shows no rating and no reviews, and `GET` and `POST /review` answer
    404.
