# The stop page for review emails

Decision: `template-review-stop-page-20261122` (locked; the owner approved on
2026-11-22). Builds on `template-review-page-20261122`. The plugin's side is
`reviews-email-stop-link-20261122` in dinkuskit/reviews.

## What the page does

| Case | Expected | Source of the expectation |
| --- | --- | --- |
| The stop link is opened (`/review?o=…&k=…&stop=1`), once or many times | 200, "Stop review emails from <store>?", one "Stop review emails" button in a plain form with method post, no script, and no stop is kept | The locked decision: a button, not a bare link, so mail filters that open every link stop nothing |
| The button is pressed | 200, "Done", "You won't get review emails from <store> again.", and Reviews keeps one stop record whose id is the SHA-256 of the address in lower case | The locked decision; Reviews' `send` with `stop` |
| The link is opened or pressed again | 200, "Done", stored records unchanged | Pressing twice keeps one record |
| A wrong secret, or another order's secret | 404 "This link does not work", nothing kept | Reviews answers CLOSED for any link that opens nothing |
| The form posted from another site | 403 from the store's boundary, nothing kept | The store's same-site rule for form posts |
| The request is 61 days old | The review link answers 404; the stop link still works | The stop link works as long as Reviews keeps the order's request |
| A store without Reviews, or a Reviews without the stop link | 404 | The review page's existing rule |

The page keeps `Cache-Control: no-store` and `Referrer-Policy: no-referrer`,
and shows nothing of the order, the secret or the buyer's address.

## Observed (Node 24.22.1, 2026-11-23)

- `tests/unit/review-form.test.ts`: 19 pass (6 new for the stop link).
- `astro check`: 0 errors. Vitest: 67 files, 555 tests pass.
- Playwright `review-form.spec.ts` and `product-reviews.spec.ts`, desktop and
  mobile Chromium, 12 pass, against the proof store running the pinned
  Commerce and Reviews builds. Stop journey, desktop (mobile matches):

```json
{"step": "open the stop link twice", "status": 200, "heading": "Stop review emails from this store?", "stopKept": false, "reviewLinkAfter61Days": 404}
{"step": "wrong secret, another order's secret, a post from another site", "statuses": [404, 404, 404, 403], "stopKept": false}
{"step": "press Stop review emails", "status": 200, "heading": "Done", "stopKept": true, "addressKept": false}
{"step": "open and press again", "status": 200, "heading": "Done", "storageUnchanged": true}
```

  The proof store has no site name set, so Reviews gives none and the page
  says "this store". A store with a name shows the name; the unit tests cover
  both.

Screenshots are written to `runs/review-stop-link-20261122/browser/` by the
test (ignored; the pull request shows them).
