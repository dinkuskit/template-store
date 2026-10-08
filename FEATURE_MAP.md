# Feature ownership map

This map is the repository contract for bounded template work. Features own
their implementation, tests, and public entry. Cross-feature access goes
through its declared public entry. `index.ts` is the default. The guest cart
keeps a pure browser entry there and exposes its server-rendered Astro
components through the explicit public `ui.ts` entry.

| Stable feature ID | Responsibility | Owned paths | Public entry | Dependencies | Quick proof | Full proof | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.store-shell` | Neutral Astro/EmDash shell, first-class page layout renderers with Portable Text fallback, copied Home opener and query card, canonical slashless products/collections, Commerce-linked product resolver, document metadata, and shared page frame | `src/features/store-shell/`; `src/pages/index.astro`; `src/pages/collections/`; `src/pages/products/`; `src/live.config.ts`; `seed/` | `src/features/store-shell/index.ts` | EmDash; installed Commerce public item lookup; managed-product and unmanaged-product public entries | `bin/verify-web quick` | `bin/verify-web full` | canonical URL candidate |
| `dinkus.site-verifier` | Read-only public-origin crawler for URL status, redirects, sitemap, robots, canonical, and structured-data contract | `bin/verify-site` | `bin/verify-site <origin>` | Public EmDash routes | `bin/verify-site <local-origin>` | `bin/verify-web full` | #34 product URL checks required; #35 product data/feed checks remain skipped |
| `dinkus.managed-product-availability` | Commerce catalog identity, official Configure Inventory orchestration, Inventory registration/opening/read/adjust composition, proof adapter, proof-only HTTP action, and storefront availability panel | `src/features/managed-product-availability/`; `src/pages/api/proof/stock.ts` | `src/features/managed-product-availability/index.ts` | `@dinkuskit/commerce` package root; `@dinkuskit/inventory` package root | `bin/verify-web quick` | `bin/verify-web full` | verified pilot |
| `dinkus.unmanaged-product-sellability` | Unmanaged Commerce catalog identity, isolated manual availability, unified storefront resolver, proof-only HTTP action, and storefront sellability panel that never contacts Inventory or shows quantity | `src/features/unmanaged-product-sellability/`; `src/pages/api/proof/unmanaged-availability.ts` | `src/features/unmanaged-product-sellability/index.ts`; pure identities through `src/features/unmanaged-product-sellability/identity/index.ts` | `@dinkuskit/commerce` package root | `bin/verify-web quick` | `bin/verify-web full` | verified pilot |

## Merchant catalog

| Stable feature ID | Responsibility | Owned paths | Public entry | Dependencies | Quick proof | Full proof | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.commerce-catalog` | Installed Commerce public-only SSR catalog consumption with complete opaque pagination; explicit native-development proof retains Regular/Sale composition | `src/features/commerce-catalog/`; `src/pages/shop/`; `tests/e2e/commerce-catalog.spec.ts` | `src/features/commerce-catalog/index.ts` | Commerce catalog/public installed boundary; EmDash public-only SSR dispatch | `bin/verify-web quick` | `bin/verify-web full` | installed read candidate; checkout closed |

| Journey | How to reach | Proof action | Observable success |
| --- | --- | --- | --- |
| Merchant admin to real catalog | EmDash Products at `/_emdash/admin/plugins/dinkus-commerce/products`; public `/` Shop and `/shop/<Commerce ID>` | Add name/SKU, save Regular, save lower Sale, reject malformed Regular, reload admin, clear prices. Separate anonymous page and authenticated public Edit context; desktop/mobile. | No Regular means no public card and detail 404, but admin retains product. Regular lists it; Sale strikes Regular. Invalid edit leaves public price unchanged. Commerce availability has no invented quantity. A product with no projected image shows "No image" and no `<img>`; a projected media id renders that alt text and srcset. Add to cart still keys off the Commerce id. Public Edit hydrates without changing catalog authority. |
| Guest cart presentation | Header Cart on storefront pages; `/cart`; add-to-cart on persisted Shop products only | Create a priced in-stock Commerce product, add it, change quantity, reload, remove to empty, inject malformed storage, change the product to out-of-stock then unpriced, open `/cart?success=1`. Desktop and mobile. | Only sellable priced Shop products can be added. Preview merchandise has no add-to-cart. Browser storage holds version, IDs, and quantities only. `/cart` shows current Commerce name/price/sellability. Missing, unpriced, or unsellable lines keep a readable reason and cannot checkout. Snapshot failure keeps intent and offers retry. Checkout stays disabled with `Checkout unavailable`. A forged success query never confirms a purchase. |

Shipping v1 has Inventory off and uses persisted unmanaged Commerce Products.
The existing seeded merchandise and stock panels are explicit development
integration demonstrations, not persisted merchant products or shipping stock.
Preserve managed regression proof and existing fail-closed data. The stock
management Coming soon control belongs to the exact paired Commerce artifact.
Final pairing is pending the Commerce owner's immutable artifact handoff. No seed import is needed to add
Commerce Products to an initialized starter; preserve its edited CMS content.
See [operator and compatibility boundaries](docs/implementation/commerce-catalog.md).

## Canonical product URLs and public site verification

Published products are routed only at `/products/{slug}` and collections only
at `/collections/{slug}`. Product identity is the linked Commerce `itemId`;
slugs are editorial URL input, never identity. Duplicate or invalid published
links fail closed. `/shop/{id}`, legacy collection digests, `/home`, and slash
variants are redirect inputs only, and redirect responses are `302`/`no-store`
until verified for a later `301`. The default starter is indexable; demo-host
noindex is explicit via `DINKUS_DEMO_NOINDEX=1` or the proof profile.

Run the site verifier in order against the local server, a preview origin,
then production: `bin/verify-site <origin>`. It performs read-only GET/HEAD
checks and crawls the homepage, sitemap-linked internal URLs, and nested
internal links discovered on child pages until the queue is empty. A deployment
is complete only after the production run passes. Checks owned by the not-yet
landed product data/feed work remains an explicit `SKIP` owned by #35; the
canonical product/collection URL checks are required.

## Authorized guest cart

| Stable feature ID | Responsibility | Owned paths | Public entry | Dependencies | Quick proof | Full proof | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.guest-cart` | Validated browser identity/quantity intent cache, cart editing and Commerce snapshot presentation; exact installed guest protocol/recovery client and safe return pages remain closed until upstream catalog/config admission | `src/features/guest-cart/`; `src/pages/cart.astro`; `src/pages/checkout/`; `src/pages/api/guest-cart/snapshot.ts`; `tests/unit/guest-cart.test.ts`; `tests/unit/guest-checkout-recovery.test.ts`; `tests/unit/checkout-dependency-handoff.test.ts`; `tests/e2e/guest-cart.spec.ts`; `tests/e2e/guest-checkout-feasibility.spec.ts` | `src/features/guest-cart/index.ts`; UI through `src/features/guest-cart/ui.ts` | Commerce catalog public entry; store-shell public entry; exact installed Commerce runtime metadata and unresolved same-catalog/config authority | `bin/verify-web quick` | `bin/verify-web full` | candidate; checkout admission unresolved |

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
| `dinkus.test-checkout-host` | Byte-bounded Payments wake HTTP transport and trusted scheduler assembly for canonical Commerce reconciliation | `src/features/test-checkout-host/`; `src/worker.ts`; `scripts/verify-checkout-package.mjs`; `tests/unit/checkout-host-wake-client.test.ts`; `tests/unit/checkout-host-scheduler.test.ts`; `tests/unit/checkout-host-payment-cap.test.ts` | `src/features/test-checkout-host/index.ts` | Exact reviewed Commerce49 source/owner artifact; Payments12 transport | `pnpm test` | `pnpm verify`; `pnpm verify:checkout-package <owner-commerce.tgz>` | matched source consumer; installed runtime activation pending |

## Commerce49 Registry services / Payments12 checkout consumer

| Stable feature ID | Responsibility | Owned paths | Public entry | Dependencies | Quick proof | Full proof | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.paired-checkout-consumer` | Preserved opt-in checkout contract plus exact Commerce49 default Registry service assembly proof; shipping defaults remain disabled | `src/features/paired-checkout/`; `scripts/verify-registry-checkout.mjs`; `scripts/lib/immutable-payments-fixture.mjs`; `tests/unit/paired-checkout-consumer.test.ts` | `src/features/paired-checkout/index.ts` | Reviewed Commerce49 source `45ced324bfb2c39c0a1fe200e5d8ceda7c5581ef`; reviewed Payments12 source `37842220fddb10dc5294af084110cd33804715be` | `pnpm test -- tests/unit/paired-checkout-consumer.test.ts` | `pnpm verify`; `pnpm verify:registry-checkout` | actual compiled default workerd + immutable Payments HTTP/JWT/SQLite proof; official Registry installation and real Stripe TEST pending |

Commerce49 derives canonical TEST payment lookup and wake list/ACK from original owner settings/context. The local default-backend verifier exercises the original EmDash workerd bridge, encrypted synthetic credentials and SDK storage; immutable Payments12 supplies HTTP/JWT/SQLite. Official Registry installation, grants, identity renewal, callbacks and one registered site scheduler remain pending; the default Worker still runs only EmDash maintenance. No raw SQL or invented routes substitute for admission. Source aliases and fresh extracted owner-package fixtures are separate proof levels, neither a Registry install nor a real Stripe TEST purchase. See [the matched compiled pair proof](.grilltrack/proof/paired-checkout-20261006/PROOF.md), [the historical response-cap successor proof](.grilltrack/proof/test-checkout-host-response-cap-20261005/PROOF.md), [historical Commerce42 proof](.grilltrack/proof/test-checkout-host-20261001/PROOF.md) and [the next runtime prerequisite](.grilltrack/proof/test-checkout-host-20261001/RUNTIME-ACTIVATION-GATE.md).

## Default inventory-off profile

The default source-pilot profile is `shipping`; explicit
`DINKUS_STOREFRONT_PROFILE=proof` selects development demonstrations.
`tests/e2e/shipping-storefront-profile.spec.ts` covers the installed public
catalog path with no native plugin mount: fail-closed Shop, no invented
products, absent quantities/demonstrations, preview isolation, and closed
checkout on desktop/mobile. Native Products create, Regular/Sale, Coming soon,
and guest-cart add-to-cart remain `native-development` proof.
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
- Product titles, collection links, descriptions, visual labels, and slugs come
  from EmDash `products` entries. Each published entry requires a
  `commerceItemId`; Commerce remains authoritative for identity, price and
  availability.
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

## Installed catalog consumer (2026-10-07)

Default catalog reads use the exact installed `r_gshdrqaldna3r7sn` public `catalog/public` route through EmDash public-only SSR dispatch. An absent/private route or malformed projection fails closed. Every cursor is followed, including empty filtered pages. Commerce projects the customer price; Template does not reconstruct a sale comparison. Native storage reads and the native plugin registration require `DINKUS_CATALOG_PROFILE=native-development`; canonical browser fixtures set that explicit profile. Shipping installation needs the matching installed Commerce artifact.

The current source pin is Commerce `5ade2bd0e4480b8ec9220c7872d7445e35547a3e`, with EmDash `1.2.0`. Existing Commerce49/Payments12 package verifiers are historical exact-artifact fixtures and intentionally refuse this new pairing. They are not proof of this candidate. The optional cart coupon passes only intent to canonical checkout; it stays disabled together with checkout until an owner-supplied configuration/readiness contract exists. Catalog or prepare success does not imply readiness.
