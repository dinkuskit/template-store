# Playground welcome card: product edits and checkout readiness

- Repository: `dinkuskit/template-store`, PR #137.
- Scope: the two ClawSweeper findings on head `3ebefab` against
  `src/features/playground-plugins/welcome-plugin.ts`.

## What changed

1. **Edit a product** links to Commerce's own Products page
   (`/_emdash/admin/plugins/dinkus-commerce/products`), which is the page
   that holds the name and price the storefront shows. The step says
   "change its name or price"; that page has no photo control, so the step
   doesn't mention photos. The card no longer listens to CMS `products` saves.
   It marks the step done when Commerce's `catalogItems`, `catalogPrices` and
   `catalogMedia` differ from the first time this visitor's dashboard
   loaded. It keeps a SHA-256 digest of those records in the plugin's own
   KV, and the playground seeds the catalog before the dashboard first loads.
2. **Place a test order** appears only when `playgroundCheckoutConfigured`
   is true. That is the same decision the store middleware uses for checkout
   admission, read from the per-request playground env. When checkout is
   closed, the card shows "Look at your storefront" with "Test checkout is
   switched off in this playground", never mentions 4242, and counts one goal
   instead of two. Checkout itself is untouched.
3. The meter shows `done/total`. EmDash 1.2.0 drew the raw value as a
   percent ("1%").

## Observed (local playground)

- Node `v24.22.0`. `astro build --config astro.playground.config.mjs`, then
  `wrangler dev --local` on the built Worker, checkout env unset (closed,
  like the PR previews). Chromium through Playwright.
- Fresh session dashboard: "0 of 1 thing to do so far", "→ Look at your
  storefront" with the switched-off text, and no 4242.
- On Commerce Products, "Dinkus Demo Ceramic Mug" was renamed to "Playground
  Morning Mug" (Rename). The storefront home then contained "Playground
  Morning Mug".
- Back on the dashboard: "1 of 1 thing to do so far", meter `1/1`, and
  "✓ Edit a product (done)".
- Desktop 1440 px and phone 390 px screenshots of the card were taken. Under
  this repo's media rule, they stay out of git.

## Checks

- `vitest run tests/unit/playground-plugins.test.ts`: 6/6 passed, including
  the new closed-checkout case and the Commerce Products link.
- `bin/verify-web quick`: 446/447 passed. The one failure is
  `seed-demo-repeat`, which needs the `sqlite3` CLI that this environment
  lacks; it fails the same way on the unchanged base.
- `pnpm typecheck`: 0 errors. `node scripts/check-features.mjs`: ok.
  `git diff --check`: clean.
