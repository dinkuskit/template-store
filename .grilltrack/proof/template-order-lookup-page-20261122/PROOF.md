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
  - The proof store pins Commerce `v0.9.0-beta.2`, which has no
    `orders/lookup` route yet, so a lookup there answers "Order lookup is
    unavailable right now. Try again in a moment." The found-order case runs in
    the browser once the pin moves to the Commerce beta that carries the route.
