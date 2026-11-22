# EmDash 1.5.0 template proof (22 Nov 2026)

GrillTrack decision `template-emdash15-20261122`. Run in a cloud container, Node 24.22.0, local SQLite stores only.

## Commerce's Registry build on EmDash 1.5.0

`pnpm verify:paired-product-on-sale` fetched and built the pinned Commerce `v0.9.0-beta.3`
(`c9b24fc79c2a`), checked `dist/sandbox/plugin.mjs` (`1d0132bec854…`) and `dist/sandbox/index.mjs`
(`1c61faf8b79d…`) against the recorded digests, installed that bundle under its Registry runtime id on a
fresh 1.5.0 store, and ran `tests/paired`: **12 passed** (desktop and phone).

The screenshots from that run are hosted in dinkuskit/dinkus-pr-assets (manifest with sizes and SHA-256 digests:
[`template-store/pr-255-f4489a0/README.md`](https://github.com/dinkuskit/dinkus-pr-assets/blob/e26bb525a013f2447437478ae932da3a9cc3a8df/template-store/pr-255-f4489a0/README.md)):

- [`desktop-2-published-on-sale.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/e26bb525a013f2447437478ae932da3a9cc3a8df/template-store/pr-255-f4489a0/desktop-2-published-on-sale.png), [`phone-2-published-on-sale.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/e26bb525a013f2447437478ae932da3a9cc3a8df/template-store/pr-255-f4489a0/phone-2-published-on-sale.png): a product page published from the
  admin, on sale on the shop.
- [`desktop-cart-0-default-sold-out-other-size-buyable.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/e26bb525a013f2447437478ae932da3a9cc3a8df/template-store/pr-255-f4489a0/desktop-cart-0-default-sold-out-other-size-buyable.png): a product with Sizes, one sold out.
- [`desktop-cart-2-cart-small.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/e26bb525a013f2447437478ae932da3a9cc3a8df/template-store/pr-255-f4489a0/desktop-cart-2-cart-small.png): the cart Commerce holds, with the chosen Size and its price.
- [`desktop-cart-5-checkout-with-print.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/e26bb525a013f2447437478ae932da3a9cc3a8df/template-store/pr-255-f4489a0/desktop-cart-5-checkout-with-print.png): checkout with a digital and a printed line.

EmDash 1.5 names plugin unique indexes `uidx_plugin_` plus a SHA-256 prefix. On the 1.5 store's database
the catalog's two indexes are `uidx_plugin_914b72f0…` (`commandId`) and `uidx_plugin_617097d8…` (`skuKey`),
which `tests/e2e/helpers/plugin-index.ts` computes. The browser tests now wait for those names.

## A filled 1.4.0 store upgraded

`upgrade-from-1-4-0.md`: a store filled on main (EmDash 1.4.0, Commerce 0.9.0-beta.2) was started on this
build. 1.5 applied 092-097 and renamed Commerce's unique indexes. Every product, page answer, catalog entry
and Commerce storage count read the same before and after. New products, carts and checkout then worked on
it, and a duplicate SKU was still refused with Commerce's own message.

## Checks

`bin/verify-web checks` passed: `astro check`, `vitest run` (unit tests), the workflow tests, the
feature audit, the worktree text check, `git diff --check`, the build and `verify-site`.
