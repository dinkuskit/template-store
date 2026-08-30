# Feature ownership map

This map is the repository contract for bounded template work. Features own
their implementation, tests, and public entry. Cross-feature access goes
through an `index.ts` entry.

| Stable feature ID | Responsibility | Owned paths | Public entry | Dependencies | Quick proof | Full proof | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.store-shell` | Neutral Astro/EmDash shell, CMS composition, document metadata, and shared page frame | `src/features/store-shell/`; `src/pages/index.astro`; `src/live.config.ts`; `seed/` | `src/features/store-shell/index.ts` | EmDash; `@dinkuskit/blocks`; managed-product public entry | `bin/verify-web quick` | `bin/verify-web full` | verified pilot |
| `dinkus.managed-product-availability` | Commerce catalog identity, official Configure Inventory orchestration, Inventory registration/opening/read/adjust composition, proof adapter, proof-only HTTP action, and storefront availability panel | `src/features/managed-product-availability/`; `src/pages/api/proof/stock.ts` | `src/features/managed-product-availability/index.ts` | `@dinkuskit/commerce` package root; `@dinkuskit/inventory` package root | `bin/verify-web quick` | `bin/verify-web full` | verified pilot |

## Boundary rules

- No template file imports a Dinkus package feature internal. Pre-release
  aliases terminate at package-root `src/index.ts` only.
- CMS content and transactional facts remain separate authorities even when one
  storefront page presents both.
- The proof adapter stays inside `managed-product-availability` and is never
  presented as a production adapter.
- The product bootstrap enters Inventory through Commerce's store configuration
  and `configureCatalogItemInventory`; the browser-facing command supplies only
  the Commerce catalog item identity.
- Cart, checkout, payments, shipping, deployment, and package publication are
  outside this map.
