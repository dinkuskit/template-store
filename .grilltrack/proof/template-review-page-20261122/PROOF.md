# Buyer's review page at /review

Decision: `template-review-page-20261122`. Reviews side: dinkuskit/reviews
`reviews-review-page-on-store-20261122`, routes `write` and `send`
(dinkuskit/reviews#8, head `b554da9`).

## What the store does

| Request | Expected | Source of the expectation |
| --- | --- | --- |
| `GET /review?o=&p=&k=` with a link Reviews opens | 200, "How was <product>?", a plain `method="post"` form: five rating choices, optional words, the name to show (pre-filled "Sam T." for Sam Taylor); `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, robots noindex | Reviews `write` answers `state: "open"` with the product's name and the shown name; the link's secret is in the address, so the page passes its address to nobody |
| `POST` the form with a rating | 200, "Thank you for your review"; Reviews keeps one published review for that order and product | Reviews `send` answers `result: "sent"` (or `held` with approve-first on) |
| `POST` the form with no rating | 422, "Choose a rating from 1 to 5 stars.", the words typed are still in the form | Reviews `send` refuses with `STARS` |
| The same link again | 200, "You already reviewed this" | Reviews `write` answers `state: "done"`: one review per product per order |
| Wrong secret, a product not in the order, a link older than 60 days | 404, "This link does not work" | Reviews answers `CLOSED` for every link that opens nothing, with no reason |
| Any `/review` address on a store without Reviews installed | 404, "This link does not work", no form | The store asks the plugin inside its server; no plugin, no answer |
| `POST /review` from another site | Reviews is not asked, nothing is kept | Same-store form rule, as `/checkout` and `/track-order` |

The page changes no seed content and adds no menu link, so it needs no
self-upgrade step.

## Observed (Node 24.22.1, 2026-11-22)

- `vitest run`: 65 files, 555 tests pass. `tests/unit/review-form.test.ts`
  drives the page's server helper with Reviews' real answer shapes: the
  in-process call (same-origin headers, the store's own origin, the link taken
  from the page's address and never from a form field), the open form, each
  refusal with the typed text kept, sent, held and already reviewed, a
  cross-site post refused before Reviews is asked, an oversized post, Reviews
  absent, and Reviews answering something it never promised.
- `astro check`: 0 errors. `check-features`, `check-worktree-text`: ok.
- `node --test tests/workflows/*.test.mjs`: 95 pass, 2 skipped, 8 fail. The 8
  are `playground-build-artifact.test.mjs` refusing this machine's Node
  24.22.1 against the 24.22.0 pin ("Build toolchain does not match source
  pins"); they fail the same way on untouched main `555a73d` here.
- Playwright, desktop and mobile Chromium, against the proof store (pinned
  Commerce Registry build, no Reviews): `review-form.spec.ts`, 6 pass. `/review`
  and a made-up link answer 404 "This link does not work" with `no-store` and
  `no-referrer`, no form, and the secret nowhere in the page; a review posted
  from another site or to this store shows no form and no thanks.

## The full form on an installed Reviews build (EmDash 1.5.0)

The template does not pin Reviews yet, so this run is not in CI. For it, the
proof store's `astro.config.mjs` was changed on this machine only to mount the
Reviews Registry bundle built from dinkuskit/reviews#8 (`backend.js` 22,526 B,
`d08e40b4cd87…`) beside Commerce, under Reviews' Registry id
`r_t7rmn7qidmbmuyge`. One shipped order (Sam Taylor; Camp mug and Red hat;
asked today) was written into that plugin's own `shipped` storage with the
SHA-256 of a known secret, as the request run keeps it. Desktop and mobile
Chromium then used the page (2 pass, 55 seconds). The page asks the real
routes; nothing is mocked.

| Step | Expected (source) | Observed |
| --- | --- | --- |
| Open the Camp mug link | 200, "How was Camp mug?", name box "Sam T.", `no-store`, `no-referrer`; no order id or email in the page (Reviews `write`) | exactly that |
| Send with words but no rating (the browser's own check switched off) | 422, "Choose a rating from 1 to 5 stars.", words kept (Reviews `STARS`) | 422, that message, "Keeps coffee hot for hours." still in the box |
| Choose 5 stars and send | 200, thanks; one published review kept (Reviews `sent`) | 200, `sent`; storage holds one review: `camp-mug`, 5 stars, the words, "Sam T.", `published`; its id is a hash, not the order's id |
| Open the same link again | 200, "You already reviewed this" (Reviews `done`) | 200, `already` |
| Open the order's Red hat link | 200, its own form (one review per product) | 200, "How was Red hat?" |
| Wrong secret; a product not in the order | 404, "This link does not work" (Reviews `CLOSED`) | 404 and 404 |
| Post the Red hat form from another site | nothing kept (same-store rule) | 403 from the store's public-address rules; still one review for the order |
| Rating record for Camp mug | value 5, count 1 after the first review (Reviews `refreshRating`) | `{ value: 5, count: 1, turn: 1 }`, then count 2 after the mobile run's review |

### Refused posts and the longest allowed review (same setup, later the same day)

Each refused case is a direct `POST` of the form (`stars=1`, words, a name)
with same-site headers unless said otherwise. Before and after each one, every
row of the plugin's `reviews` and `ratings` storage was read and compared byte
for byte. Desktop and mobile Chromium, 2 pass; secrets are not shown.

| Step | Expected (source) | Observed (desktop; mobile the same) |
| --- | --- | --- |
| POST with a wrong secret | 404, nothing kept (Reviews `CLOSED`) | 404, storage identical |
| POST for a product not in the order, right secret | 404, nothing kept (Reviews `CLOSED`) | 404, storage identical |
| POST with the right secret on a link asked 61 days ago | 404, nothing kept (Reviews `opens()`, 60 days) | 404, storage identical |
| POST from another site, right secret, link still good | refused before Reviews is asked (same-store rule) | 403, storage identical |
| The browser's own form with 2,000 Chinese characters (漢) and a 60-character name, 5 stars | 200, kept whole: the textarea allows 2,000 characters, and a plain form sends each as 9 bytes | form body 18,559 bytes; 200, `sent`; the kept review holds all 2,000 characters; rating `5 / 1` |
| POST the same link again with 1 star | 200, "You already reviewed this", nothing changed (Reviews `done`) | 200, `already`, storage identical: still 5 stars, rating `5 / 1` |

The 18,559-byte form is why the page's form limit is 32 KB: the first limit,
16 KB, would have dropped that review. `tests/unit/review-form.test.ts` covers
the same submission.

Screenshots (`1-form.png`, `2-refused.png`, `3-thanks.png`, `4-already.png`,
`5-wrong-secret.png`) and `trace.json` are kept under the ignored
`runs/review-page-20261122/`. A browser test that runs this in CI comes with
the PR that pins Reviews in the template (storefront stars).
