# Storefront pigment drift, card bloom, product stage and receipt (PR 151)

Code head: `8503a4f73d6ba8ceb265151e5526b6bbda88139a` (main `944d855` merged in).
This file is the only change after it.

## Review findings on `5acbdf7` and what changed

| Finding | Change | Evidence |
| --- | --- | --- |
| P1 receipt observer rewrites its own stamp text forever | `GuestCheckoutReturn.astro` writes the stamp only when the label changes; the barcode was already guarded | `guest-checkout-feasibility.spec.ts` paid-return case now asserts the stamp text, the `DK-FIXTURE` barcode, and zero mutations on the order block over 750 ms after confirmation (fails on the old loop), desktop and phone |
| P2 hover bloom hidden under opaque artwork | Wash sits above the image (`z-index: 2`, `mix-blend-mode: multiply`, rest opacity 0, hover 0.55) in `ProductMedia.astro` and `MerchCatalog.astro` | Source; catalog and merch specs pass desktop and phone |
| P2 animated SVG artwork under reduced motion | All 13 product and merch SVGs are still (no SMIL); the footer and hero wash are still too, and their pause scripts are gone | `motion-pigment-multiplane.test.ts` asserts no `<animate` in every asset, the hero and the footer |
| P2 product-detail hover missing from reduced motion | `.product-detail__visual:hover` selectors added for the wash and the image | Source |

The unlinked product page fallback no longer carries an unstyled wash span.

## CI phone failure on `5acbdf7`

`guest-cart.spec.ts` failed on phone with `route.fulfill: Route is already handled!`.
It passed on main and failed with this branch locally; reverting only
`StoreFooter.astro` made it pass. The animated full-width footer turbulence made
phone full-page screenshots slow enough that the test outlived a 30 s held
snapshot route which the next reload had already abandoned. The footer filter
is now still, two octaves, on its own layer (`will-change`, `contain: strict`),
and that one held route ignores only the "already handled" error.

## Observed checks

Node `24.22.0`, pnpm `11.9.0`.

- `pnpm verify` (`bin/verify-web full`) on `97f6260` (before main `c0daca7` and `944d855`): vitest 56 files / 470 tests passed; Playwright 69 passed, 7 skipped (15.9 min) across chromium-desktop, chromium-mobile, shipping-chromium-desktop and shipping-chromium-mobile; verify-site passed (32 URLs); `verify-web: full passed`.
- After merging main `c0daca7`: `bin/verify-web quick` passed; `merch-catalog`, `commerce-catalog`, `guest-cart` and `guest-checkout-feasibility` specs on all four projects: 30 passed, 2 skipped.
- After merging main `944d855` (no shared files with this PR): `bin/verify-web quick` passed; `astro check` 258 files, 0 errors.
