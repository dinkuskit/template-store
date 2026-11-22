# Rating and reviews in a product's data for search engines

Decision: `template-product-rating-jsonld-20261122` (locked; the owner approved on
2026-11-22). Builds on `template-product-rating-20261122`.

## What the page does

| Case | Expected | Source of the expectation |
| --- | --- | --- |
| A product with published reviews | Its schema.org `Product` data gains `aggregateRating` (`ratingValue`, `bestRating` 5, `worstRating` 1, `reviewCount`) and `review`: the 5 newest, each with the shown name, the date, the stars and the words | WooCommerce `class-wc-structured-data.php`, read 2026-11-22: `aggregateRating` with `ratingValue` and `reviewCount` when the product has ratings, and its 5 most recent reviews. schema.org `AggregateRating` and `Review` |
| The same product, any option picked | Every prepared option's data carries the same rating and reviews, beside that option's offer | The page prepares one data block per option on the server and the browser only selects one |
| A later page of reviews (`?reviews=<cursor>`) | `aggregateRating` only | The newest reviews are not on that page, and the data must match what the page shows |
| No published review, or no Reviews installed | No `aggregateRating`, no `review` | Nothing to rate; WooCommerce writes neither without ratings |

Only what the page already shows is written: the name the buyer chose, never
an email address or an order number.

## Observed (Node 24.22.1, 2026-11-22)

- `tests/unit/product-reviews.test.ts`: 6 pass, including the exact
  `aggregateRating` and `Review` shapes, the cap of 5, a review with no words,
  and a later page.
- `astro check`: 0 errors.
- Playwright `product-reviews.spec.ts`, desktop and mobile Chromium, 2 pass,
  against the proof store running the pinned Commerce and Reviews builds;
  reviews were written through the store's `/review` page. Trace, desktop
  (mobile matches):

```json
{"step": "no reviews yet", "rating": "none shown", "reviews": "none shown", "jsonLd": "no aggregateRating, no review"}
{"step": "two reviews (5 and 4 stars)", "rating": "4.5 / 5", "count": 2, "heading": "2 reviews for Reviewed Mug desktop", "kept": {"value": 4.5, "count": 2, "turn": 2}, "jsonLd": {"aggregateRating": {"@type": "AggregateRating", "ratingValue": 4.5, "bestRating": 5, "worstRating": 1, "reviewCount": 2}, "reviews": 2}}
{"step": "23 reviews", "firstPage": 20, "secondPage": 3, "kept": {"value": 5, "count": 23, "turn": 23}, "jsonLd": {"firstPageReviews": 5, "reviewCount": 23, "laterPageReviews": 0}}
{"step": "another product with no reviews", "rating": "none shown", "jsonLd": "no aggregateRating"}
```

  The test also checks that the data keeps the product's offer, that the two
  reviews are `["Verified buyer", 4]` and `["Sam T.", 5, words]`, that with 23
  reviews the data names reviews 21 to 17, and that the data holds no surname,
  email address or order number.
