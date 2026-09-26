# Feature ownership map

This map is the repository contract for bounded template work. Features own
their implementation, tests, and public entry. Cross-feature access goes
through an `index.ts` entry.

| Stable feature ID | Responsibility | Owned paths | Public entry | Dependencies | Quick proof | Full proof | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.store-shell` | Neutral Astro/EmDash shell, first-class page layout renderers with Portable Text fallback, copied Home opener and query card, merchandise catalog, collection and product browse pages, document metadata, and shared page frame | `src/features/store-shell/`; `src/pages/index.astro`; `src/pages/collections/`; `src/pages/products/`; `src/live.config.ts`; `seed/` | `src/features/store-shell/index.ts` | EmDash; `@dinkuskit/blocks`; managed-product and unmanaged-product public entries | `bin/verify-web quick` | `bin/verify-web full` | verified pilot |
| `dinkus.managed-product-availability` | Commerce catalog identity, official Configure Inventory orchestration, Inventory registration/opening/read/adjust composition, proof adapter, proof-only HTTP action, and storefront availability panel | `src/features/managed-product-availability/`; `src/pages/api/proof/stock.ts` | `src/features/managed-product-availability/index.ts` | `@dinkuskit/commerce` package root; `@dinkuskit/inventory` package root | `bin/verify-web quick` | `bin/verify-web full` | verified pilot |
| `dinkus.unmanaged-product-sellability` | Unmanaged Commerce catalog identity, isolated manual availability, unified storefront resolver, proof-only HTTP action, and storefront sellability panel that never contacts Inventory or shows quantity | `src/features/unmanaged-product-sellability/`; `src/pages/api/proof/unmanaged-availability.ts` | `src/features/unmanaged-product-sellability/index.ts` | `@dinkuskit/commerce` package root | `bin/verify-web quick` | `bin/verify-web full` | verified pilot |

## Merchant catalog

| Stable feature ID | Responsibility | Owned paths | Public entry | Dependencies | Quick proof | Full proof | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.commerce-catalog` | Persisted native Commerce Products admin consumption, public listing and detail, Regular/Sale and availability read composition | `src/features/commerce-catalog/`; `src/pages/shop/`; `tests/e2e/commerce-catalog.spec.ts` | `src/features/commerce-catalog/index.ts` | Commerce public root; EmDash public runtime/repository APIs | `bin/verify-web quick` | `bin/verify-web full` | local integration |

| Journey | How to reach | Proof action | Observable success |
| --- | --- | --- | --- |
| Merchant admin to real catalog | EmDash Products at `/_emdash/admin/plugins/dinkus-commerce/products`; public `/` Shop and `/shop/<Commerce ID>` | Add name/SKU, save Regular, save lower Sale, reject malformed Regular, reload admin, clear prices. Separate anonymous page and authenticated public Edit context; desktop/mobile. | No Regular means no public card and detail 404, but admin retains product. Regular lists it; Sale strikes Regular. Invalid edit leaves public price unchanged. Commerce availability has no invented quantity. Public Edit hydrates without changing catalog authority. |

Commerce and Inventory are crucial side-by-side launch components. The existing
seeded merchandise and stock panels below Shop are explicitly separate integration
demonstrations, not persisted merchant products. No seed import is needed to add
Commerce Products to an initialized starter; preserve its edited CMS content.
See [operator and compatibility boundaries](docs/implementation/commerce-catalog.md).

## Storefront drivers

| Journey | How to reach | Proof action | Observable success |
| --- | --- | --- | --- |
| Classic merchandise catalog | Open `/` after EmDash setup. Edit hero in Pages `home`; edit merchandise entries in EmDash Merchandise. | Inspect `data-collection-nav` and `data-merch-catalog` on desktop and mobile; follow collection and product detail links and back links; follow each connected card's View availability link and open its native details by keyboard. | Tees, Hoodies, and Hats group CMS entries. Connected Everyday Tee and Canvas Cap cards lead to compact, focused summaries with live status; technical authority, IDs, and provenance remain in details. Preview cards and product pages state `Preview only · not purchasable`, have no purchase link, and show no price. Missing or draft product/collection routes return 404. |
| First-class page composition | After EmDash setup, open Pages `home`. The optional `layout` field offers Home opener, Rich text, and Query card. Existing `content` stays Portable Text and remains the fallback. `/section` continues to apply only to Portable Text. | On desktop and mobile, edit the first-class layout through admin, publish a Query card over a throwaway collection, inspect signed-out public and authenticated Edit-mode views, then remove layout and restore it through revision history. | Home opener and published Query Card render from ordered block data; drafts stay absent; an independently copied Home opener is page-owned; original Portable Text survives edits and renders when layout is absent; history retains both shapes. |

### Availability proof drivers

| Journey | How to reach | Proof action | Observable success |
| --- | --- | --- | --- |
| Managed Inventory `8 → 5 → 8` | Open `/` after EmDash setup. Public panel `#managed-product` / `[data-managed-product]`. Admin composition remains the Pages `home` entry at `/_emdash/admin/content/pages/home`. | POST `/api/proof/stock` with `{ commandId, delta: "-3", reason: "proof-change" }`, reload, then POST `{ commandId, delta: "3", reason: "proof-restore" }` and reload. Proof mode only (`DINKUS_PROOF_MODE=1`). | `[data-commerce-sku]` is `DINKUS-DEMO-001`. `[data-inventory-sku]` is `dinkus-inventory-sku-demo`. `[data-stock-value]` reads `8`, then `5`, then `8`. `[data-stock-version]` increases monotonically. Hero action contrast stays readable and neither the page nor the fact rail overflows. |
| Unmanaged manual availability | Open `/` after EmDash setup. Public panel `#unmanaged-product` / `[data-unmanaged-product]`. A human reaches the same product from admin by editing the page-hero secondary CTA on Pages `home` without a code change. Manual status itself is Commerce-owned (`catalog-items/set-manual-availability`); the playground POST is the local stand-in until Commerce ships visual admin UI. | POST `/api/proof/unmanaged-availability` with `{ catalogItemId: "dinkus-template-unmanaged-product", status }` cycling `out-of-stock` → `available-on-backorder` → `in-stock`. Proof mode only. | `[data-unmanaged-sku]` is `DINKUS-DEMO-UNMANAGED`. Default `[data-availability-status]=in-stock` and `[data-sellable]=true` with `[data-quantity-shown]=never` and no `[data-stock-value]` inside the panel. Status then becomes `out-of-stock` / not sellable, `available-on-backorder` / sellable, then `in-stock` / sellable. Quantity remains absent. Admin before/after screenshots of Pages `home` stay operable. |
| Public Regular / Sale and unpriced hide | Open `/` after EmDash setup. Public panels `[data-managed-product]` and `[data-unmanaged-product]`. Admin Pages `home` remains operable. | Observe public prices. No POST. Proof mode not required. | Managed `[data-regular-price]` is `$12.00` with no sale. Unmanaged `[data-regular-price]` is `$12.00` struck through and `[data-sale-price]` is `$10.00`. `DINKUS-DEMO-UNPRICED` is absent on `/`. Admin Pages `home` still opens. |

### Query card editorial list

| Journey | How to reach | Proof action | Observable success |
| --- | --- | --- | --- |
| Legacy Portable Text editorial records | Create a collection with title, text, image URL, and link fields in EmDash admin; open Pages home and insert `/query` → Dinkus Query Card in `content`. The first-class `layout` Query card uses the same record contract without `/query`. | `tests/e2e/query-card.spec.ts` owns the existing Dinkus plugin path; `tests/e2e/upstream-blocks.spec.ts` owns the first-class renderer. | Both renderer paths query only published records and render the bounded title/text/image/safe-link projection. Drafts stay absent; commerce/cart concepts do not enter either path. |

See [first-class block transition and upgrade boundaries](docs/implementation/upstream-blocks-transition.md) and the [legacy plugin Query Card notes](docs/implementation/query-card.md).
No seed collection, new route, price, stock, cart, filters, or pagination is added.

## Boundary rules

- No template file imports a Dinkus package feature internal. Pre-release
  aliases terminate at package-root `src/index.ts` only.
- Merchandise titles, categories, descriptions, and visual labels come from EmDash
  `merchandise` entries. Only exact demo entry IDs `everyday-tee` and
  `canvas-cap` bind to connected proof products; all other IDs are previews.
  CMS fields cannot assert Commerce or Inventory authority.
- CMS content and transactional facts remain separate authorities even when one
  storefront page presents both.
- The proof adapter stays inside `managed-product-availability` and is never
  presented as a production adapter.
- The unmanaged proof adapter stays inside `unmanaged-product-sellability`. It
  never contacts Inventory, never copies a quantity onto the storefront, and is
  never presented as a production adapter.
- The product bootstrap enters Inventory through Commerce's store configuration
  and `configureCatalogItemInventory`; the browser-facing command supplies only
  the Commerce catalog item identity.
- Unmanaged storefront reads go through `resolveStorefrontAvailability`. Manual
  availability writes go through `setCatalogItemManualAvailability`.
- Public home renders a product panel only when Commerce `listable` is true.
  Unpriced drafts remain in the catalog and in EmDash admin; they do not appear
  on `/`. Regular and optional Sale display uses Commerce Money. Native Products admin
  Regular/Sale boxes operate the separate persisted merchant catalog above.
- Named order reservations, packed holds, and stock transfers exist on the
  Inventory pin. This playground does not consume them.
- Cart, checkout, payments, shipping, deployment, persisted Manage Stock
  toggle, visual stock-status/Store-hide controls, and package publication are
  outside this map.
