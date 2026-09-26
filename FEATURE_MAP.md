# Feature ownership map

This map is the repository contract for bounded template work. Features own
their implementation, tests, and public entry. Cross-feature access goes
through an `index.ts` entry.

| Stable feature ID | Responsibility | Owned paths | Public entry | Dependencies | Quick proof | Full proof | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.store-shell` | Neutral Astro/EmDash shell, CMS hero, seeded Home opener section, merchandise catalog, collection and product browse pages, document metadata, and shared page frame | `src/features/store-shell/`; `src/pages/index.astro`; `src/pages/collections/`; `src/pages/products/`; `src/live.config.ts`; `seed/` | `src/features/store-shell/index.ts` | EmDash; `@dinkuskit/blocks`; managed-product and unmanaged-product public entries | `bin/verify-web quick` | `bin/verify-web full` | verified pilot |
| `dinkus.managed-product-availability` | Commerce catalog identity, official Configure Inventory orchestration, Inventory registration/opening/read/adjust composition, proof adapter, proof-only HTTP action, and storefront availability panel | `src/features/managed-product-availability/`; `src/pages/api/proof/stock.ts` | `src/features/managed-product-availability/index.ts` | `@dinkuskit/commerce` package root; `@dinkuskit/inventory` package root | `bin/verify-web quick` | `bin/verify-web full` | verified pilot |
| `dinkus.unmanaged-product-sellability` | Unmanaged Commerce catalog identity, isolated manual availability, unified storefront resolver, proof-only HTTP action, and storefront sellability panel that never contacts Inventory or shows quantity | `src/features/unmanaged-product-sellability/`; `src/pages/api/proof/unmanaged-availability.ts` | `src/features/unmanaged-product-sellability/index.ts` | `@dinkuskit/commerce` package root | `bin/verify-web quick` | `bin/verify-web full` | verified pilot |

## Storefront drivers

| Journey | How to reach | Proof action | Observable success |
| --- | --- | --- | --- |
| Classic merchandise catalog | Open `/` after EmDash setup. Edit hero in Pages `home`; edit merchandise entries in EmDash Merchandise. | Inspect `data-collection-nav` and `data-merch-catalog` on desktop and mobile; follow collection and product detail links and back links; follow each connected card's View availability link and open its native details by keyboard. | Tees, Hoodies, and Hats group CMS entries. Connected Everyday Tee and Canvas Cap cards lead to compact, focused summaries with live status; technical authority, IDs, and provenance remain in details. Preview cards and product pages state `Preview only · not purchasable`, have no purchase link, and show no price. Missing or draft product/collection routes return 404. |
| Home opener section | After EmDash setup, open admin Sections or type `/section` in Pages `home`. The library entry is slug `home-opener`, title Home opener, source theme. Public `/` stays the ordinary Pages `home` copy until a shop owner inserts the section. Admin and the public page are separate browser contexts. | On desktop and mobile, insert Home opener with `/section`, edit the inserted hero headline, publish, then restore the previous Pages `home` revision. | The insert adds one Page Hero and one Fact Rail as a copy. The library section still says `Welcome to the shop`. The unauthenticated public page shows the edited headline. Restore returns the original home composition, including one hero and one fact rail. |

### Availability proof drivers

| Journey | How to reach | Proof action | Observable success |
| --- | --- | --- | --- |
| Managed Inventory `8 → 5 → 8` | Open `/` after EmDash setup. Public panel `#managed-product` / `[data-managed-product]`. Admin composition remains the Pages `home` entry at `/_emdash/admin/content/pages/home`. | POST `/api/proof/stock` with `{ commandId, delta: "-3", reason: "proof-change" }`, reload, then POST `{ commandId, delta: "3", reason: "proof-restore" }` and reload. Proof mode only (`DINKUS_PROOF_MODE=1`). | `[data-commerce-sku]` is `DINKUS-DEMO-001`. `[data-inventory-sku]` is `dinkus-inventory-sku-demo`. `[data-stock-value]` reads `8`, then `5`, then `8`. `[data-stock-version]` increases monotonically. Hero action contrast stays readable and neither the page nor the fact rail overflows. |
| Unmanaged manual availability | Open `/` after EmDash setup. Public panel `#unmanaged-product` / `[data-unmanaged-product]`. A human reaches the same product from admin by editing the page-hero secondary CTA on Pages `home` without a code change. Manual status itself is Commerce-owned (`catalog-items/set-manual-availability`); the playground POST is the local stand-in until Commerce ships visual admin UI. | POST `/api/proof/unmanaged-availability` with `{ catalogItemId: "dinkus-template-unmanaged-product", status }` cycling `out-of-stock` → `available-on-backorder` → `in-stock`. Proof mode only. | `[data-unmanaged-sku]` is `DINKUS-DEMO-UNMANAGED`. Default `[data-availability-status]=in-stock` and `[data-sellable]=true` with `[data-quantity-shown]=never` and no `[data-stock-value]` inside the panel. Status then becomes `out-of-stock` / not sellable, `available-on-backorder` / sellable, then `in-stock` / sellable. Quantity remains absent. Admin before/after screenshots of Pages `home` stay operable. |
| Public Regular / Sale and unpriced hide | Open `/` after EmDash setup. Public panels `[data-managed-product]` and `[data-unmanaged-product]`. Admin Pages `home` remains operable. | Observe public prices. No POST. Proof mode not required. | Managed `[data-regular-price]` is `$12.00` with no sale. Unmanaged `[data-regular-price]` is `$12.00` struck through and `[data-sale-price]` is `$10.00`. `DINKUS-DEMO-UNPRICED` is absent on `/`. Admin Pages `home` still opens. |

### Query card editorial list

| Journey | How to reach | Proof action | Observable success |
| --- | --- | --- | --- |
| Current editorial records | Create a collection with title, text, image URL, and link fields in EmDash admin; open Pages home and insert `/query` → Query Card with that Source and Limit. | `tests/e2e/query-card.spec.ts` drives real admin insertion and publication, adds a published record and a draft through authenticated APIs, and reloads a separate anonymous public page on desktop/mobile. | One card becomes two without republishing the page; image, title, text, and safe link render; draft stays absent. Admin lists the draft; public Edit mode hydrates the plugin placeholder. Original Home is restored. `bin/verify-web full` owns the proof. |

See [operator steps and proof boundaries](docs/implementation/query-card.md).
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
  on `/`. Regular and optional Sale display uses Commerce Money. Visual admin
  Regular/Sale boxes are outside this map.
- Named order reservations, packed holds, and stock transfers exist on the
  Inventory pin. This playground does not consume them.
- Cart, checkout, payments, shipping, deployment, persisted Manage Stock
  toggle, visual EmDash Regular/Sale admin fields, and package publication are
  outside this map.
