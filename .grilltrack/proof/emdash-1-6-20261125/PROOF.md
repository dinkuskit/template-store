# EmDash 1.6.0 template proof (25 Nov 2026)

GrillTrack decision `template-emdash16-20261125`. Run in a cloud container, Node 24.22.0, local SQLite stores only.

## Commerce's Registry build on EmDash 1.6.0

Commerce stays on `v0.9.0-beta.5` (`607744804524`). `pnpm verify:paired-product-on-sale` fetched and built it
with this PR's EmDash 1.6.0 toolchain, and `dist/sandbox/plugin.mjs` (`6da07ddec4ae…`) and
`dist/sandbox/index.mjs` (`3c2bb1ad993e…`) matched the digests recorded for 1.5.0 exactly. It installed that
bundle under its Registry runtime id on a fresh 1.6.0 store and ran `tests/paired`: **13 passed, 5 skipped**
(desktop and phone; the skips are the stand-in and desktop-only cases, as on main). It was run twice, with the
same result.

The screenshots from that run are hosted in dinkuskit/dinkus-pr-assets (manifest with sizes and SHA-256 digests:
[`README.md`](https://github.com/dinkuskit/dinkus-pr-assets/blob/3403d9dae787d52b837273984bffa0ecdf6557b8/template-store/pr-279-9f5c5ad/README.md)):

- [`desktop-2-published-on-sale.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/3403d9dae787d52b837273984bffa0ecdf6557b8/template-store/pr-279-9f5c5ad/desktop-2-published-on-sale.png), [`phone-2-published-on-sale.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/3403d9dae787d52b837273984bffa0ecdf6557b8/template-store/pr-279-9f5c5ad/phone-2-published-on-sale.png): a product page published from the admin, on sale on the shop.
- [`desktop-13-scheduled-on-sale.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/3403d9dae787d52b837273984bffa0ecdf6557b8/template-store/pr-279-9f5c5ad/desktop-13-scheduled-on-sale.png): a page EmDash published on schedule, its product on sale with nobody signed in.
- [`desktop-cart-0-default-sold-out-other-size-buyable.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/3403d9dae787d52b837273984bffa0ecdf6557b8/template-store/pr-279-9f5c5ad/desktop-cart-0-default-sold-out-other-size-buyable.png): a product with Sizes, one sold out.
- [`desktop-cart-2-cart-small.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/3403d9dae787d52b837273984bffa0ecdf6557b8/template-store/pr-279-9f5c5ad/desktop-cart-2-cart-small.png): the cart Commerce holds, with the chosen Size and its price.
- [`desktop-cart-5-checkout-with-print.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/3403d9dae787d52b837273984bffa0ecdf6557b8/template-store/pr-279-9f5c5ad/desktop-cart-5-checkout-with-print.png): checkout with a digital and a printed line.

## What 1.6 changed for these tests

On a phone the editor's settings sheet now opens from **Show settings** (1.6 removed distraction-free mode)
instead of a **Settings** button in the main area. `tests/e2e/helpers/product-page.ts` and
`tests/paired/product-on-sale.spec.ts` accept either name. Before that fix the phone runs of
`product-on-sale` failed to find the button; after it, every paired test passes. The journeys runner gets
the same fix, plus 1.6's new "Unpublish Product?" confirm, in dinkuskit/live-journeys#52.

## A filled 1.5.0 store upgraded

`upgrade-from-1-5-0.md`: a store filled on main (EmDash 1.5.0, Commerce `v0.9.0-beta.5`) was started on this
build. 1.6 applied only `098_user_last_login`. Every product, page answer, catalog entry, Commerce storage count,
unique index and plugin state read the same before and after. New products, carts and checkout then worked on it.

## Checks

`bin/verify-web checks` passed: `astro check` (0 errors), `vitest run` (unit tests), the workflow tests, the
feature audit, the worktree text check, `git diff --check`, the build and `verify-site`.
