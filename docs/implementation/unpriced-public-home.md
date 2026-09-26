# Unpriced products stay off the public home

Status: implemented locally
Baseline: `c12b2d9bac456f468a14dc414075dff94c74cb95`
Commerce source: `3f20fe96d5b3104c4b599e669d18f54fd8ab2587`

## Shop-owner contract

- EmDash admin Pages `home` stays operable. The unpriced Commerce draft is
  not on `/`. Visual catalog admin is the next grill.
- The public website does not. Woo would still list it as not purchasable;
  this store keeps the stronger Commerce lock.
- Priced bags show Regular as `$12.00`. Sale strikes Regular and shows Sale.
- No Regular/Sale boxes in EmDash admin this slice. That is the next grill.

## Wiring

Pin Commerce to `3f20fe9`. Both proof products set Regular through
`setCatalogItemRegularPrice`. The unmanaged proof also sets Sale `$10.00`.
An unmanaged unpriced draft is created without Regular. `index.astro` renders
a panel only when Commerce `listable` is true.

## Proof

`bin/verify-web full` with `NO_PROXY` for Playwright. Public vs admin
screenshots from the existing unmanaged browser spec.
