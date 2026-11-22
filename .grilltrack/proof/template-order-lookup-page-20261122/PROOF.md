# Order lookup page at /track-order

Decision: `template-order-lookup-page-20261122` (supersedes
`shopper-accounts-playground-20261020`). Commerce side: dinkuskit/commerce
`commerce-order-lookup-20261122`, route `orders/lookup`.

## What the store does

| Request | Expected | Source of the expectation |
| --- | --- | --- |
| `GET /track-order` | 200, "Track your order" form: order number and email, `method="post"`, `action="/track-order"`, no script | WooCommerce `templates/order/form-tracking.php`: the same two boxes, posted to the page itself |
| `POST /track-order`, right number and email | Commerce's one order: number, status, placed date, lines with option text (`Size: M · Colour: Red`), totals, shipping address, carrier and tracking once completed | Commerce `projectShopperOrder`; option text as Commerce's `lineOptions` writes it |
| `POST /track-order`, wrong pair | 422 and "No order matches that order number and email. Check both and try again."; both boxes keep what was typed | Commerce `ORDER_NOT_FOUND` |
| 5 wrong tries for one email or one order number | 429 and "Too many tries. Try again in an hour." | Commerce `LOOKUP_LIMITED` |
| `POST /track-order` from another site | no order shown, Commerce not asked | Same-store form rule, as `/checkout` |
| `GET /account` | 302 to `/track-order` | The store's Account menu links keep working until Accounts brings sign-in |

## Observed (Node 24.22.0, 2026-11-22)

- `vitest run`: 62 files, 540 tests pass. `tests/unit/order-lookup.test.ts`
  drives the page's server helper with Commerce's real answer shape: the
  in-process call (`orders/lookup`, same-origin headers, the store's own
  origin), the found order's view, the not-found and limited answers, a
  cross-site post refused before Commerce is asked, an empty box, an oversized
  post, and Commerce answering nothing it promised.
- `node --test tests/workflows/*.test.mjs`: 103 pass, 2 skipped, 0 fail.
- `astro check`: 0 errors. `check-features`, `check-worktree-text`: ok.
- Playwright, desktop and mobile Chromium, against the proof store running the
  pinned Commerce's Registry build: `order-lookup.spec.ts` (4 pass),
  `store-header-nav.spec.ts` (6 pass), `guest-cart.spec.ts` (6 pass).
  - Find order button contrast, read from the painted colours in every preset
    and theme (`order-lookup.spec.ts`, 16 pass on desktop and mobile). The
    button now uses the store's ink colour with the surface colour as its text,
    the pair the shell already reads well with:

    | Preset | Light | Dark |
    | --- | --- | --- |
    | Aizome (default) | 17.2:1 | 14.8:1 |
    | Forest | 16.5:1 | 14.4:1 |
    | Cobalt | 18.6:1 | 16.0:1 |

    Before the fix, Dark mode drew "Find order" in #141e30 on #334155.

## Found order on the installed Commerce (EmDash 1.5.0, Commerce v0.9.0-beta.4)

The store pins Commerce `v0.9.0-beta.4` (`d8d654cc17c0`), the first beta with
`orders/lookup`. `pnpm prepare:commerce` built its Registry bundle
(`backend.js` 124,997 B, `2377557a1315…`), and the proof store runs that
bundle under its Registry id. `order-lookup.spec.ts` writes two paid orders
into that Commerce's own `orders` storage, in the shape Commerce's paid-order
receiver keeps, then uses the page in desktop and mobile Chromium
(18 pass, 1.3 minutes). The page asks the real route; nothing is mocked.

| Case | Expected (source) | Observed |
| --- | --- | --- |
| `#7101` and `PAT.DESKTOP@EXAMPLE.TEST` | 200, that one order: "Order #7101", "Processing · Placed November 1, 2026", "Red hat × 2 $24.00", Total $24.00, "Pat Shopper, 1 Lookup Way, Springfield IL 62701, US"; no payment id (WooCommerce form-tracking: number plus billing email, case-insensitive; Commerce `projectShopperOrder`) | 200, exactly those lines; the page has no `pi_` |
| `7101` and Sam's email | 422, "No order matches that order number and email. Check both and try again.", no order (Commerce `ORDER_NOT_FOUND`) | 422, that message; the page never shows "Pat Shopper" |
| 5 wrong emails for `7102`, then Sam's own email | 5 × 422, then 429 "Too many tries. Try again in an hour." before anything is shown (commerce-order-lookup-20261122) | 422 × 5, then 429 with that message; no order, no "Sam Shopper"; Commerce's `order_lookup_guesses` holds a count of 5 |
| Mobile, `#7201` / `7202` | the same | the same |

The trace is kept with the screenshots (`found.png`, `limited.png`,
`trace.json`) under the ignored `runs/order-lookup-20261122/browser/`.

## Playground preview: two visitor stores (2026-11-22 18:45 UTC)

The PR's playground preview (`pr-253.playground.dinkuskit.com`, built from
`8cc31a9`) runs the same pinned Commerce `v0.9.0-beta.4` Registry build in
each visitor's own store. A headless Chromium opened two visitor stores and
used `/track-order` in each:

| Store | Lookup | Answer |
| --- | --- | --- |
| A | `1001` + `jordan.rivers@example.com` (a sample order) | 200, "Order #1001", "Completed · Placed November 20, 2026", "Carrier: USPS", "Tracking number: TEST10010000000", two lines, Total $55.00, Jordan Rivers' address |
| A | `1001` + five wrong emails | 422 each, the one not-found message |
| A | `1001` + `jordan.rivers@example.com` again | 429, "Too many tries. Try again in an hour.", no order |
| B | `1001` + `jordan.rivers@example.com` | 200, its own copy of the sample order: store A's tries never reached store B's Commerce |

Each visitor store's lookup reads and counts tries only in that store's own
Commerce storage. The preview also shows a completed order's carrier and
tracking number.
