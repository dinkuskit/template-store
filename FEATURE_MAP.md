# Feature ownership map

This map is the repository contract for bounded template work. Features own
their implementation, tests, and public entry. Cross-feature access goes
through its declared public entry. `index.ts` is the default. The guest cart
keeps a pure browser entry there and exposes its server-rendered Astro
components through the explicit public `ui.ts` entry.

| Stable feature ID | Responsibility | Owned paths | Public entry | Dependencies | Quick proof | Full proof | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.store-shell` | Neutral Astro/EmDash shell, first-class page layout renderers with Portable Text fallback, copied Home opener and query card, merchandise catalog, collection and product browse pages, document metadata, and shared page frame | `src/features/store-shell/`; `src/pages/index.astro`; `src/pages/collections/`; `src/pages/products/`; `src/live.config.ts`; `seed/` | `src/features/store-shell/index.ts` | EmDash; managed-product and unmanaged-product public entries | `bin/verify-web quick` | `bin/verify-web full` | verified pilot |
| `dinkus.managed-product-availability` | Commerce catalog identity, official Configure Inventory orchestration, Inventory registration/opening/read/adjust composition, proof adapter, proof-only HTTP action, and storefront availability panel | `src/features/managed-product-availability/`; `src/pages/api/proof/stock.ts` | `src/features/managed-product-availability/index.ts` | `@dinkuskit/commerce` package root; `@dinkuskit/inventory` package root | `bin/verify-web quick` | `bin/verify-web full` | verified pilot |
| `dinkus.unmanaged-product-sellability` | Unmanaged Commerce catalog identity, isolated manual availability, unified storefront resolver, proof-only HTTP action, and storefront sellability panel that never contacts Inventory or shows quantity | `src/features/unmanaged-product-sellability/`; `src/pages/api/proof/unmanaged-availability.ts` | `src/features/unmanaged-product-sellability/index.ts`; pure identities through `src/features/unmanaged-product-sellability/identity/index.ts` | `@dinkuskit/commerce` package root | `bin/verify-web quick` | `bin/verify-web full` | verified pilot |

## Merchant catalog

| Stable feature ID | Responsibility | Owned paths | Public entry | Dependencies | Quick proof | Full proof | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.commerce-catalog` | Persisted native Commerce Products admin consumption, public listing and detail, Regular/Sale and availability read composition | `src/features/commerce-catalog/`; `src/pages/shop/`; `tests/e2e/commerce-catalog.spec.ts` | `src/features/commerce-catalog/index.ts` | Commerce public root; EmDash public runtime/repository APIs | `bin/verify-web quick` | `bin/verify-web full` | local integration |

| Journey | How to reach | Proof action | Observable success |
| --- | --- | --- | --- |
| Merchant admin to real catalog | EmDash Products at `/_emdash/admin/plugins/dinkus-commerce/products`; public `/` Shop and `/shop/<Commerce ID>` | Add name/SKU, save Regular, save lower Sale, reject malformed Regular, reload admin, clear prices. Separate anonymous page and authenticated public Edit context; desktop/mobile. | No Regular means no public card and detail 404, but admin retains product. Regular lists it; Sale strikes Regular. Invalid edit leaves public price unchanged. Commerce availability has no invented quantity. Public Edit hydrates without changing catalog authority. |
| Guest cart presentation | Header Cart on storefront pages; `/cart`; add-to-cart on persisted Shop products only | Create a priced in-stock Commerce product, add it, change quantity, reload, remove to empty, inject malformed storage, change the product to out-of-stock then unpriced, open `/cart?success=1`. Desktop and mobile. | Only sellable priced Shop products can be added. Preview merchandise has no add-to-cart. Browser storage holds version, IDs, and quantities only. `/cart` shows current Commerce name/price/sellability. Missing, unpriced, or unsellable lines keep a readable reason and cannot checkout. Snapshot failure keeps intent and offers retry. Checkout stays disabled with `Checkout unavailable`. A forged success query never confirms a purchase. |

Shipping v1 has Inventory off and uses persisted unmanaged Commerce Products.
The existing seeded merchandise and stock panels are explicit development
integration demonstrations, not persisted merchant products or shipping stock.
Preserve managed regression proof and existing fail-closed data. The stock
management Coming soon control belongs to the exact paired Commerce artifact.
Final pairing is pending the Commerce owner's immutable artifact handoff. No seed import is needed to add
Commerce Products to an initialized starter; preserve its edited CMS content.
See [operator and compatibility boundaries](docs/implementation/commerce-catalog.md).

## Authorized guest cart

| Stable feature ID | Responsibility | Owned paths | Public entry | Dependencies | Quick proof | Full proof | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.guest-cart` | Validated browser identity/quantity intent cache, cart editing and Commerce snapshot presentation; inactive checkout until upstream guest mount | `src/features/guest-cart/`; `src/pages/cart.astro`; `src/pages/api/guest-cart/snapshot.ts`; `tests/unit/guest-cart.test.ts`; `tests/unit/checkout-dependency-handoff.test.ts`; `tests/e2e/guest-cart.spec.ts`; `tests/e2e/guest-checkout-feasibility.spec.ts` | `src/features/guest-cart/index.ts`; UI through `src/features/guest-cart/ui.ts` | Commerce catalog public entry; store-shell public entry | `bin/verify-web quick` | `bin/verify-web full` | candidate; checkout contract pending |

Issue #20 supersedes the earlier catalog-only no-cart exclusion for this bounded
shopper feature. Cart persistence is untrusted identity/quantity intent, never
price, stock, checkout or order authority. Current catalog prices/sellability
are read through the existing Commerce consumer. Guest capability, frozen
attempts, hosted handoff and durable paid-order return states depend on Commerce
issue #32 and exact artifact/mount proof. No browser URL establishes payment.
No synthetic provider, registry release or Stripe proof is claimed here.
See [.grilltrack/proof/checkout-integration-20260930/PROOF.md](.grilltrack/proof/checkout-integration-20260930/PROOF.md) and [.grilltrack/proof/checkout-integration-20260930/DEPENDENCY-HANDOFF.md](.grilltrack/proof/checkout-integration-20260930/DEPENDENCY-HANDOFF.md) for post-merge guest checkout failclosed feasibility qualification.

## TEST checkout host adapter and scheduler slice

| Stable feature ID | Responsibility | Owned paths | Public entry | Dependencies | Quick proof | Full proof | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.test-checkout-host` | Byte-bounded Payments wake HTTP transport and trusted scheduler assembly for canonical Commerce reconciliation | `src/features/test-checkout-host/`; `src/worker.ts`; `scripts/verify-checkout-package.mjs`; `tests/unit/checkout-host-wake-client.test.ts`; `tests/unit/checkout-host-scheduler.test.ts`; `tests/unit/checkout-host-payment-cap.test.ts` | `src/features/test-checkout-host/index.ts` | Exact reviewed Commerce44 source/owner artifact; Payments11 transport | `pnpm test` | `pnpm verify`; `pnpm verify:checkout-package <owner-commerce.tgz>` | successor source verified; installed runtime activation pending |

One trusted configuration supplies canonical TEST payment lookup and wake list/ACK. Descriptor JSON cannot carry host callbacks. EmDash has plugin cron contexts, but the actual installed checkout host/storage injection remains unproved; the default Worker still runs only EmDash maintenance. No raw SQL or invented routes substitute for admission. Source aliases and fresh extracted owner-package fixtures are separate proof levels, neither a Registry install nor a real Stripe TEST purchase. See [the current response-cap successor proof](.grilltrack/proof/test-checkout-host-response-cap-20261005/PROOF.md), [historical Commerce42 proof](.grilltrack/proof/test-checkout-host-20261001/PROOF.md) and [the next runtime prerequisite](.grilltrack/proof/test-checkout-host-20261001/RUNTIME-ACTIVATION-GATE.md).

## Default inventory-off profile

The default source-pilot profile is `shipping`; explicit
`DINKUS_STOREFRONT_PROFILE=proof` selects development demonstrations.
`tests/e2e/shipping-storefront-profile.spec.ts` covers Products create, Regular/Sale,
manual availability, absent quantities/demonstrations, preview isolation, and
merchant product detail on desktop/mobile. The current Commerce pin
`444b0505ae061c58e2f738e9f39fb0b366d50e8c` preserves the disabled Coming soon
control under the native entry, while registry pairing remains pending.
`pnpm verify` keeps both this profile and all earlier managed regressions.

## Storefront drivers

| Journey | How to reach | Proof action | Observable success |
| --- | --- | --- | --- |
| Classic merchandise catalog | Open `/` after EmDash setup. Edit hero in Pages `home`; edit merchandise entries in EmDash Merchandise. | Inspect `data-collection-nav` and `data-merch-catalog` on desktop and mobile; follow collection and product detail links and back links; follow each connected card's View availability link and open its native details by keyboard. | Tees, Hoodies, and Hats group CMS entries. Connected Everyday Tee and Canvas Cap cards lead to compact, focused summaries with live status; technical authority, IDs, and provenance remain in details. Preview cards and product pages state `Preview only · not purchasable`, have no purchase link, and show no price. Missing or draft product/collection routes return 404. |
| First-class page composition | After EmDash setup, open Pages `home`. The optional `layout` field offers Home opener, Rich text, and Query card. Existing `content` stays Portable Text and remains the fallback. `/section` continues to apply only to Portable Text. | On desktop and mobile, edit the first-class layout through admin, publish a Query card over a throwaway collection, inspect signed-out public and authenticated Edit-mode views, then remove layout and restore it through revision history. A separate built-server proof registers an allowed missing local renderer through schema APIs and captures the production fallback. | Home opener and published Query Card render from ordered block data; drafts stay absent; an independently copied Home opener is page-owned; original Portable Text survives edits and renders when layout is absent; history retains both shapes. Production `dist/server` renders registered unknown native and nested Portable Text fallbacks. |

### Availability proof drivers

| Journey | How to reach | Proof action | Observable success |
| --- | --- | --- | --- |
| Managed Inventory `8 → 5 → 8` | Open `/` after EmDash setup. Public panel `#managed-product` / `[data-managed-product]`. Admin composition remains the Pages `home` entry at `/_emdash/admin/content/pages/home`. | POST `/api/proof/stock` with `{ commandId, delta: "-3", reason: "proof-change" }`, reload, then POST `{ commandId, delta: "3", reason: "proof-restore" }` and reload. Proof mode only (`DINKUS_PROOF_MODE=1`). | `[data-commerce-sku]` is `DINKUS-DEMO-001`. `[data-inventory-sku]` is `dinkus-inventory-sku-demo`. `[data-stock-value]` reads `8`, then `5`, then `8`. `[data-stock-version]` increases monotonically. Hero action contrast stays readable and neither the page nor the fact rail overflows. |
| Unmanaged manual availability | Open `/` after EmDash setup. Public panel `#unmanaged-product` / `[data-unmanaged-product]`. A human reaches the same product from admin by editing the page-hero secondary CTA on Pages `home` without a code change. Manual status itself is Commerce-owned (`catalog-items/set-manual-availability`); the playground POST is the local stand-in until Commerce ships visual admin UI. | POST `/api/proof/unmanaged-availability` with `{ catalogItemId: "dinkus-template-unmanaged-product", status }` cycling `out-of-stock` → `available-on-backorder` → `in-stock`. Proof mode only. | `[data-unmanaged-sku]` is `DINKUS-DEMO-UNMANAGED`. Default `[data-availability-status]=in-stock` and `[data-sellable]=true` with `[data-quantity-shown]=never` and no `[data-stock-value]` inside the panel. Status then becomes `out-of-stock` / not sellable, `available-on-backorder` / sellable, then `in-stock` / sellable. Quantity remains absent. Admin before/after screenshots of Pages `home` stay operable. |
| Public Regular / Sale and unpriced hide | Open `/` after EmDash setup. Public panels `[data-managed-product]` and `[data-unmanaged-product]`. Admin Pages `home` remains operable. | Observe public prices. No POST. Proof mode not required. | Managed `[data-regular-price]` is `$12.00` with no sale. Unmanaged `[data-regular-price]` is `$12.00` struck through and `[data-sale-price]` is `$10.00`. `DINKUS-DEMO-UNPRICED` is absent on `/`. Admin Pages `home` still opens. |

### Query card editorial list

| Journey | How to reach | Proof action | Observable success |
| --- | --- | --- | --- |
| Legacy Portable Text editorial records | Create a collection with title, text, image URL, and link fields in EmDash admin; retain existing `/query` content as a readable Portable Text compatibility path. The first-class `layout` Query card uses the same record contract without `/query`. | `tests/e2e/upstream-blocks.spec.ts` owns first-class admin/public proof and retained Portable Text fallback. | Both renderer paths query only published records and render the bounded title/text/image/safe-link projection. Drafts stay absent; commerce/cart concepts do not enter either path. |

See [first-class block transition and upgrade boundaries](docs/implementation/upstream-blocks-transition.md) and the [Portable Text Query Card compatibility notes](docs/implementation/query-card.md).
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
- Authoritative cart checkout, payments, shipping and package publication remain upstream
  delivery gates outside this preparation slice; catalog proof alone cannot
  establish v1 readiness. Inventory is not a shipping v1 gate. Deployment is
  planned separately and requires explicit approval.
