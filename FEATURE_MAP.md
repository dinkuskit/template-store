# Feature ownership map

This map is the repository contract for bounded template work. Features own
their implementation, tests, and public entry. Cross-feature access goes
through its declared public entry. `index.ts` is the default. The guest cart
keeps a pure browser entry there and exposes its server-rendered Astro
components through the explicit public `ui.ts` entry.

| Stable feature ID | Responsibility | Owned paths | Public entry | Dependencies | Quick proof | Full proof | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.store-shell` | Neutral Astro/EmDash shell, upstream EmDash `@layer base` `tokens.css` (`light-dark()` + `aizome`/`forest`/`cobalt` Stitch presets) and unlayered adopter `theme.css`, first-class page layout renderers (`blocks`) with Portable Text fallback, reusable `policy-support-note` section (`sections`) on `/shipping` and `/returns` alongside paired Commerce `<dl>` + EmDash `PortableText` policy pages, `/search` page with `<LiveSearch>` and the storefront upgrades an older store runs on its own first request (`src/features/store-shell/storefront-upgrades.ts`, D1 or SQLite; `005_commerce_box_off` removes the old Commerce product box only once no page (draft or trashed page included) has its box as the only record of a real Commerce product (archived ones included) that no other page sells, and the store's Registry Commerce holds links, otherwise it logs those pages and waits) with the non-demo `pnpm search:upgrade` (`scripts/upgrade-storefront-search.ts`) manual entrypoint, shared `StoreHeader` (`primary` menu) and `StoreFooter` (`getSiteSettingsWithCacheHint()`, `footer_shop` / `footer_policies` menus exposing `/shipping` and `/returns` under **Policies & Care**, and `<WidgetArea name="footer" />` exercising `content`, `menu` (`footer_account`: Account, Shopping bag), and `core:search` `component` widgets), product page variant pickers (one per Commerce option, one Add to cart, `src/features/store-shell/variant-picker.ts`), canonical slashless products/categories, and Commerce-linked product resolver (Commerce's page link first; an older store's box only for a product Commerce sells on no other page) | `src/styles/tokens.css`; `src/styles/theme.css`; `src/features/store-shell/`; `scripts/upgrade-storefront-search.ts`; `src/pages/index.astro`; `src/pages/proof.astro`; `src/pages/search.astro`; `src/pages/shipping.astro`; `src/pages/returns.astro`; `src/pages/categories/`; `src/pages/products/`; `src/live.config.ts`; `seed/`; `tests/unit/store-menu.test.ts`; `tests/unit/emdash-theme-composition.test.ts`; `tests/unit/storefront-upgrades.test.ts`; `tests/unit/variant-picker.test.ts`; `tests/e2e/store-header-nav.spec.ts` | `src/features/store-shell/index.ts`; `pnpm search:upgrade` | EmDash (`ui`, `ui/search`, `menus`, `sections`, `widgets`, `settings`, `search`); installed Commerce public item lookup; managed-product and unmanaged-product public entries | `bin/verify-web quick` | `bin/verify-web full` | canonical URL + Stitch design & EmDash composition candidate |
| `dinkus.product-on-sale` | The store's publish check, Commerce half (GrillTrack template-product-states-20261023): Commerce holds which product a page sells (template-no-commerce-box-20261029), so the check asks Commerce's private `catalog` route (`get` by `entryId`, as the person) for the page's product and sends set-on-sale the page alone; a publish of a page Commerce links to no product is refused (422 `PUBLISH_REJECTED`, naming the Dinkus Commerce panel); an older store's Commerce product box counts, and is sent as `catalogItemId`, only while Commerce links that page to nothing or cannot say; the product-url plugin's publish and schedule hooks ask Commerce the same way, as the signed-in person, so such a box claims a value and names it in a schedule grant only while Commerce links the page to nothing, and the sweep holds a grant to its box product only while the page still sells by its box; the seed's demonstration pages are known by their slugs; middleware around a signed-in person's publish, unpublish or trash of a Content > Products page calls Commerce's private `catalog-items/set-on-sale` route as that person, only when Commerce declares the route and the person, read again before every write, holds its permission (`content:publish_any`); a Commerce without the route (0.5.0) leaves pages alone; unpublish and trash take the product off sale first and are refused (503, or 403 without the permission) when Commerce cannot, so a product is never buyable behind an unpublished page; publish puts it on sale afterwards, and a failure leaves it a Draft and is logged; every on-sale write carries the published page title as the product's `name` (GrillTrack template-page-title-is-name-20261026; from EmDash's publish answer, else the live title, never an unsaved draft; cut to Commerce's 1-160 character rules; the read after each on-sale write catches up with a newer title an overlapping publish gave the page by title-only writes (`name` with no `onSale`, Commerce from dinkuskit/commerce#188), which rename only the page's own product and never change whether it is for sale, at most three a request, as the person read again; work left unfinished is listed (`retitle:`) and later sweeps finish it as an allowed visitor; a Commerce that refuses title-only writes (0.6.0) is left alone), so the page title is the one name shoppers, cart and orders see once Commerce saves it (a Commerce that ignores `name` keeps its own); trash then drops the page link; if the page change fails or throws after Commerce took the product off sale, it goes back on sale only when the page, read again, is still published and names that product; every on-sale write is followed by a fresh page read that takes the product off sale again if the page is no longer published with it, and a successful unpublish takes it off sale again afterwards, so overlapping requests settle on the page's final state; a page that cannot be read is not unpublished or trashed (503); a page whose product another page sells (`PRODUCT_PAGE_CONFLICT`) or a store without the plugin or route (`NOT_FOUND`, `ROUTE_NOT_FOUND`) changes freely; Commerce never reads the CMS; a page EmDash publishes on a schedule (nobody signed in) goes on sale on the next request from someone holding the permission, at most once a minute per isolate, a batch of records per sweep, only on the product-url plugin's grant (`pending_sales`): a schedule EmDash stored, made by a person who held the permission then and still does, whose scheduled publish succeeded (proposals are kept until the record is removed, the grant is read from the schedule the page holds, and proposals from different people at that time, or too many, grant nothing; one person's grant takes their least role); records are read before any write and re-read right before it, and the page and record after it, taking the product off sale again if either changed, with that off-sale write listed per product (`takeback:`), retried until Commerce accepts it and cleared only at the revision that write answered; an Author's schedule leaves the product a Draft; a person's own publish, unschedule, unpublish or trash drops the record | `src/features/product-on-sale/`; `src/features/product-url-plugin/`; `src/middleware.ts`; `tests/unit/product-on-sale.test.ts`; `tests/unit/product-url-plugin.test.ts`; `tests/paired/`; `scripts/verify-paired-product-on-sale.mjs` | `src/features/product-on-sale/index.ts` | EmDash `handleContentGet` and `handlePluginApiRoute`; Commerce `catalog-items/set-on-sale` (dinkuskit/commerce#180) | `pnpm test -- tests/unit/product-on-sale.test.ts` | `pnpm verify:paired-product-on-sale` (this store in front of a real Commerce Registry build, now the Commerce 0.7.0 release on EmDash 1.4.0 (0.7.0-beta.3 was the first beta carrying commerce#208); it also proves an older store's boxed pages keep selling through `005_commerce_box_off`) | candidate; the playground's native Commerce pin is the Commerce that holds page links |
| `dinkus.site-verifier` | Read-only public-origin crawler for URL status, redirects, sitemap, robots, canonical, and structured-data/feed contract | `bin/verify-site` | `bin/verify-site <origin>` | Public EmDash routes | `bin/verify-site <local-origin>` | `bin/verify-web full` | #34 URL checks and #35 Product JSON-LD/feed checks run from fetched bytes; an origin with no product URL does not fail only for that absence |
| `dinkus.access-route-policy` | Fail-closed Cloudflare Access policy generation from installed Commerce/Payments route declarations; no plugin-wide bypasses | `scripts/verify-access-routes.mjs`; `DEPLOY.md`; `tests/workflows/access-route-policy.test.mjs` | `pnpm verify:access-routes`; `node scripts/verify-access-routes.mjs --format=markdown` | Pinned Commerce source; paired Payments route manifest; separately authorized Access operator | `node --test tests/workflows/access-route-policy.test.mjs` | `pnpm verify:access-routes` plus production `bin/verify-site` | source-pin preview only, not deployment authority; live rules blocked on Commerce #79 installed manifest; no live Access mutation |
| `dinkus.managed-product-availability` | Commerce catalog identity, official Configure Inventory orchestration, Inventory registration/opening/read/adjust composition, proof adapter, proof-only HTTP action, and storefront availability panel | `src/features/managed-product-availability/`; `src/pages/api/proof/stock.ts` | `src/features/managed-product-availability/index.ts` | `@dinkuskit/commerce` package root; `@dinkuskit/inventory` package root | `bin/verify-web quick` | `bin/verify-web full` | verified pilot |
| `dinkus.unmanaged-product-sellability` | Unmanaged Commerce catalog identity, isolated manual availability, unified storefront resolver, proof-only HTTP action, and storefront sellability panel that never contacts Inventory or shows quantity | `src/features/unmanaged-product-sellability/`; `src/pages/api/proof/unmanaged-availability.ts` | `src/features/unmanaged-product-sellability/index.ts`; pure identities through `src/features/unmanaged-product-sellability/identity/index.ts` | `@dinkuskit/commerce` package root | `bin/verify-web quick` | `bin/verify-web full` | verified pilot |
| `dinkus.template-playground` | Public disposable playground with per-visitor DO/SQLite, template-owned seed, anonymous playground admin, one-hour expiry, noindex responses, and closed checkout | `astro.playground.config.mjs`; `wrangler.playground.jsonc`; `src/playground-worker.ts`; `src/playground-middleware.ts`; `src/features/playground/`; `tests/unit/playground.test.ts` | `src/playground-worker.ts` | EmDash playground database adapter; infra-keeper `PLAYGROUND_CREATION_LIMITER` binding | `pnpm test -- tests/unit/playground.test.ts` | `pnpm verify` plus Worker Preview browser proof | candidate; preview-only |
| `dinkus.playground-plugins` | Playground prospect demo (GrillTrack playground-prospect-demo-20261022, playground-pretend-connected-20261022): Payments and Ship installed as their released Registry bundles (exact release tags packed with the official Registry packager) running in process under their Registry ids, a playground-only exception (GrillTrack playground-plugins-in-store-20261023) because EmDash's sandbox saves plugin data only through `env.DB` and each playground visitor's store is its own Durable Object; shipping stores keep sandbox execution through `LOADER`; a pretend DinkusKit (`dinkuskit-stand-in.ts`) answers Connect, store passes, Payments status and Ship labels for keys it issued, while any other key goes to the real service; Connect links open the CMS page `connect-to-dinkuskit`; two sample orders and a practice label made once per visitor store; playground-only guided tour (GrillTrack playground-guided-tour-20261023): an admin dashboard card and Playground tour admin page in Block Kit that show one next step with Take me there and Check my progress, tick off an edited product, the pretend Payments Connect, the visitor's own test order and practice label, and end at Start your real store; the shop's guide card points at the button to press for the test order; the steps' words are the playground-only CMS page `playground-tour`, also shown at `/playground-tour`; EmDash toolbar's Deploy your own button retargeted to Start your real store (`retargetPlaygroundDeployLink`); EmDash 1.4.0 playground user `createdAt` fix so plugin routes run; pins stay on each plugin's latest stable release by exact tag, moved by the Update playground plugins button as a PR | `scripts/prepare-playground-plugins.mjs`; `scripts/update-playground-plugins.mjs`; `.github/workflows/update-playground-plugins.yml`; `src/features/playground-plugins/`; `src/features/playground/demo-orders.ts`; `src/features/playground-tour/`; `src/pages/connect-to-dinkuskit.astro`; `src/pages/playground-tour.astro`; `astro.playground.config.mjs`; `wrangler.playground.jsonc`; `src/playground-worker.ts`; `src/playground-middleware.ts`; `tests/unit/playground-plugins.test.ts` | `src/features/playground-plugins/registry-plugins.mjs` | `dinkuskit/payments` and `dinkuskit/ship` release tags in `package.json` `dinkuskit.playgroundPlugins`; EmDash in-process `ctx.http` through the Worker's wrapped `globalThis.fetch` | `pnpm test -- tests/unit/playground-plugins.test.ts` | `pnpm verify` plus Worker Preview browser proof | candidate; preview-only |
| `dinkus.shopper-account` | Store-local shopper account `/account` page, `StoreHeader` account link, 6-digit OTP sign-in, matching paid order history, saved shipping address and phone editor, definitive server-session revocation recovery (without discarding sessions on transient errors), `/checkout` contact/delivery prefill, and two-path playground sign-in (verified email OTP + `PLAYGROUND_LEADS_DB` opt-in vs instant no-PIN `shopper@example.com` demo opt-out) | `src/features/shopper-account/`; `src/pages/account.astro`; `src/pages/api/account/demo-session.ts`; `scripts/verify-playground-account-http.mjs`; `tests/unit/shopper-account.test.ts`; `tests/unit/shopper-session-denial.test.ts`; `tests/unit/playground-account-preview.test.ts`; `tests/unit/playground-existing-state.test.ts`; `tests/e2e/shopper-account.spec.ts`; `tests/e2e/shopper-session-recovery.spec.ts` | `src/features/shopper-account/index.ts`; `src/features/shopper-account/ui.ts` | `@dinkuskit/commerce/features/customers`; Commerce public `/account/*` routes | `bin/verify-web quick` | `bin/verify-web full`; `pnpm verify:playground-account-http` | verified pilot |

## Merchant catalog

| Stable feature ID | Responsibility | Owned paths | Public entry | Dependencies | Quick proof | Full proof | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.commerce-catalog` | Installed Commerce public-only SSR catalog consumption with complete opaque pagination; the proof store, running the pinned Commerce's Registry build (template-one-build-registry-20261031), proves Regular/Sale composition, truthful catalog guidance, and warm-neutral card presentation | `src/features/commerce-catalog/`; `tests/e2e/commerce-catalog.spec.ts`; `tests/e2e/shipping-storefront-profile.spec.ts` | `src/features/commerce-catalog/index.ts` | Commerce catalog/public installed boundary; EmDash public-only SSR dispatch | `bin/verify-web quick` | `bin/verify-web full` | installed read candidate; checkout closed; bounded 2026-10-09 visual refinement |

| Journey | How to reach | Proof action | Observable success |
| --- | --- | --- | --- |
| Merchant admin to real catalog | EmDash Products at `/_emdash/admin/plugins/dinkus-commerce/products`; public `/` Shop cards | Add name/SKU, save Regular, save lower Sale, reject malformed Regular, reload admin, clear prices. Separate anonymous page and authenticated public Edit context; desktop/mobile. | No Regular means no public card, but admin retains product. Regular lists it; Sale strikes Regular. Invalid edit leaves public price unchanged. Commerce availability has no invented quantity. A product with no projected image shows "No image" and no `<img>`; a projected media id renders that alt text and srcset. Add to cart still keys off the Commerce id. Public Edit hydrates without changing catalog authority. |
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

Published products are routed only at `/products/{slug}` and categories only
at `/categories/{slug}`. Product identity is the linked Commerce `itemId`, and
Commerce holds which page sells it: product pages have no Commerce product box
(GrillTrack template-no-commerce-box-20261029);
slugs are editorial URL input, never identity. Duplicate or invalid published
links fail closed. `/shop/{id}`, legacy category digests, `/home`, and slash
variants are redirect inputs only, and redirect responses are `302`/`no-store`
until verified for a later `301`. Demos, previews, and staging are noindex by
default; a real merchant store must explicitly set
`DINKUS_LAUNCH_INDEXABLE=1`. Noindex controls search visibility, not access.

Category pages honor the CMS's ordered **Products in this category** references,
read through the SDK's published/edit-preview reference query and all of its
pages. Ordering applies only to the already-eligible merchandise: it cannot add
draft, missing, or Commerce-removed products or change Commerce facts. Missing
reference fields or failed reads retain the previous product order; unmatched
eligible products remain stably last. See
`src/features/store-shell/category-product-order.ts` and
`tests/unit/category-product-order.test.ts`.

Run the site verifier in order against the local server, a preview origin,
then production: `bin/verify-site <origin>`. It performs read-only GET/HEAD
checks and crawls the homepage, sitemap-linked internal URLs, and nested
internal links discovered on child pages until the queue is empty. A deployment
is complete only after the production run passes. Product JSON-LD and the
public feed checks run from fetched bytes. A commerce-linked product page
(one that shows a Commerce SKU) must contain exactly one Product block whose
sku and canonical URL match the page. A valid editorial page must also contain
exactly one page-facts-only Product block with no Offer; 404, removed, and 503
routes emit none. When those linked pages are present, the slashless feed URLs
must answer 200. With only editorial pages or an empty catalog, valid empty
200 feeds pass; unavailable Commerce still fails closed with 503. Malformed
empty documents, wrong content types, and other errors fail verification.
An origin with no product URL does not fail only because the product pages
or feed routes are absent. A trailing slash on a feed URL must not
be a second document. Native-development feeds may join
`loadProductFeedEligibility`; shipping and registry profiles consume only the
installed public `feedChannels` projection and do not open storage.

## Authorized guest cart

| Stable feature ID | Responsibility | Owned paths | Public entry | Dependencies | Quick proof | Full proof | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dinkus.guest-cart` | Validated browser identity/quantity intent cache, unified `window.Dinkus.actions` cart batcher and progressive `document.modelContext`/`navigator.modelContext` WebMCP co-browsing adapter (`src/features/guest-cart/webmcp.ts`, `untrustedContentHint: true`, `consequentialHint: true`, 2-step `buyer_review_required` gate), `/cart` line/subtotal review with `Proceed to Checkout` (`/checkout`), dedicated `/checkout` Contact & Delivery vault with a billing address on every order (Commerce `commerce-billing-address-001`: "Billing address same as delivery address" is ticked by default and sends a full copy; unticked or on a digital-only basket the billing fields, any country, are required), order manifest, and live shipping/tax/total breakdown; exact installed guest protocol/recovery client, readiness parser, and safe return pages admit only with supported installed test readiness | `src/features/guest-cart/`; `src/pages/cart.astro`; `src/pages/checkout/`; `src/pages/api/guest-cart/snapshot.ts`; `docs/implementation/agentic-ucp-and-webmcp.md`; `tests/unit/guest-cart.test.ts`; `tests/unit/guest-cart-webmcp.test.ts`; `tests/unit/guest-checkout-recovery.test.ts`; `tests/unit/checkout-dependency-handoff.test.ts`; `tests/unit/registry-merchant-checkout-readiness.test.ts`; `tests/unit/registry-checkout-middleware.test.ts`; `tests/workflows/registry-merchant-checkout.test.mjs`; `tests/e2e/guest-cart.spec.ts`; `tests/e2e/guest-checkout-feasibility.spec.ts` | `src/features/guest-cart/index.ts`; UI through `src/features/guest-cart/ui.ts` | Commerce catalog public entry; store-shell public entry; the original installed Commerce public dispatcher and supported checkout readiness route | `bin/verify-web quick` | `bin/verify-web full` | local candidate; compiled Registry fixture verified, publication and hosted purchase pending |
| `dinkus.playground-checkout` | `DINKUS_CHECKOUT_ENABLED` gate for playground/demo cart and Stripe test-mode checkout via Payments; admission also requires the Payments env and a valid https `EMDASH_SITE_URL` trusted return origin (provisioned with that env, not a secret; checkout shows unavailable without it); public test-card and 3-per-10-minute notices; pre-DO body validation and `PLAYGROUND_CHECKOUT_LIMITER`; success return through the capability-scoped Commerce return controller; native playground status recovery; flat-rate playground shipping; playground-only native Commerce entry with host-side Payments port (store-pass exchange) | `src/features/playground-checkout/`; `astro.playground.config.mjs`; `src/middleware.ts`; `src/pages/cart.astro`; `src/pages/checkout/index.astro`; `src/pages/checkout/success.astro`; `src/pages/api/checkout/status.ts`; `scripts/verify-playground-checkout-authority.mjs`; `scripts/verify-playground-checkout-http.mjs`; `tests/unit/playground-checkout.test.ts`; `tests/unit/playground-checkout-gates.test.ts`; `tests/unit/playground-payments-port.test.ts`; `tests/unit/playground-status-binding-handoff.test.ts`; `tests/unit/playground-existing-state.test.ts` | `src/features/playground-checkout/index.ts` | Payments checkout session/lookup (playground site); guest-cart intent | `bin/verify-web quick` | `bin/verify-web full`; `pnpm verify:playground-authority`; `pnpm verify:playground-http` | candidate; off by default |

Issue #20 supersedes the earlier catalog-only no-cart exclusion for this bounded
shopper feature. Cart persistence is untrusted identity/quantity intent, never
price, stock, checkout or order authority. Current catalog prices/sellability
are read through the existing Commerce consumer. Guest capability, frozen
attempts, hosted handoff and durable paid-order return states depend on Commerce
issue #32 and exact artifact/mount proof. No browser URL establishes payment.
No synthetic provider, registry release or Stripe proof is claimed here.
See [.grilltrack/proof/checkout-integration-20260930/PROOF.md](.grilltrack/proof/checkout-integration-20260930/PROOF.md), [.grilltrack/proof/checkout-integration-20260930/DEPENDENCY-HANDOFF.md](.grilltrack/proof/checkout-integration-20260930/DEPENDENCY-HANDOFF.md), and [.grilltrack/proof/registry-merchant-checkout-20261012/PROOF.md](.grilltrack/proof/registry-merchant-checkout-20261012/PROOF.md) for qualification and installed readiness verification.

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
catalog path with no Commerce mounted: fail-closed Shop, no invented
products, absent quantities/demonstrations, preview isolation, and closed
checkout on desktop/mobile. Product create, Regular/Sale, stock status and
guest-cart add-to-cart are proved on the proof store, which runs the pinned
Commerce's Registry build (template-one-build-registry-20261031) and speaks
only its routes. `pnpm verify` keeps both this profile and all earlier managed
regressions.

## Storefront drivers

| Journey | How to reach | Proof action | Observable success |
| --- | --- | --- | --- |
| Classic merchandise catalog | Open `/` after EmDash setup. Edit hero in Pages `home`; edit merchandise entries in EmDash Merchandise. | Inspect `data-collection-nav` and `data-merch-catalog` on desktop and mobile; follow collection and product detail links and back links; follow each connected card's View availability link and open its native details by keyboard. | Tees, Hoodies, and Hats group CMS entries. Connected Everyday Tee and Canvas Cap cards lead to compact, focused summaries with live status; technical authority, IDs, and provenance remain in details. Preview cards and product pages state `Preview only · not purchasable`, have no purchase link, and show no price. Missing or draft product/collection routes return 404. |
| First-class page composition | After EmDash setup, open Pages `home`. The optional `layout` field offers Home opener, Rich text, and Query card. Existing `content` stays Portable Text and remains the fallback. `/section` continues to apply only to Portable Text. | On desktop and mobile, edit the first-class layout through admin, publish a Query card over a throwaway collection, inspect signed-out public and authenticated Edit-mode views, then remove layout and restore it through revision history. A separate built-server proof registers an allowed missing local renderer through schema APIs and captures the production fallback. | Home opener and published Query Card render from ordered block data; drafts stay absent; an independently copied Home opener is page-owned; original Portable Text survives edits and renders when layout is absent; history retains both shapes. Production `dist/server` renders registered unknown native and nested Portable Text fallbacks. |
| Any kind of product, rich product page | Publish a Products entry whose Dinkus Commerce panel added its product (Commerce holds the link; an older store's Commerce product box comes off on its own once Commerce links every page that still depends on it); `visual_label` is optional placeholder art. Optional `summary` (rich text beside the price) and `details` (Collapsible section, Spec table, Rich text) fields. Older stores take these fields on their own on the first request after a deploy (`src/features/store-shell/storefront-upgrades.ts`, D1 or SQLite); `pnpm search:upgrade` reruns them on a local database. | `tests/e2e/product-page-content.spec.ts` on desktop and mobile: a seed packet with three Commerce pictures, a summary with bold and a link, two sections and a spec table; a priced product with no art and no picture. | The summary shows in the buy box while the short description stays the meta description and JSON-LD; sections keep the owner's order and open state; thumbnails swap the main picture; a product with no picture says `No image`. GrillTrack template-sells-anything-20261027, template-rich-product-page-20261027, template-store-self-upgrade-20261028, template-no-commerce-box-20261029. |
| CMS pages and old WooCommerce addresses | Publish a Pages entry; it shows at `/<slug>`. Starter redirects `/product/[slug]` and `/product-category/[slug]` live in EmDash Redirects (group `Moving from WooCommerce`). | `tests/e2e/cms-pages-and-redirects.spec.ts`; Worker trailing-slash 301s in `tests/e2e/cloudflare-checkout-return.spec.ts` (`CLOUDFLARE_E2E=1`). | A draft page 404s, the published page shows with the store header and footer, an unknown address says `Page not found` (404, noindex), old product and category addresses land on `/products/...` and `/categories/...`. GrillTrack template-cms-pages-and-redirects-20261027. |

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

## Test-enforced invariants

Tests and scripts enforce these rules. Keep them through redesigns and
refactors; changing an enforcing check needs owner approval in the same pull
request.

- No `src/**/*.{astro,mjs,ts}` file may contain the whole lowercase word `any`
  (`/\bany\b/u` in `scripts/check-features.mjs:141`, run by `bin/verify-web`).
  The ban covers types, comments, and UI copy: use `unknown` or a precise type,
  and reword prose.
- In light mode the home opener's primary action keeps
  `color: rgb(255, 254, 251)` and `background-color: rgb(23, 32, 51)`
  (`tests/e2e/managed-product-availability.spec.ts:30-31`). These are the light
  values of `--dinkus-action-color: #fffefb` and
  `--dinkus-action-background: #172033` in `src/styles/tokens.css:70-71`.
- Page-wide link locators must each find one link:
  `getByRole("link", { name: /Cart/ })` in `tests/e2e/guest-cart.spec.ts:120`,
  `:142`, and `:310`, and `getByRole("link", { name: "Catalog" })` in
  `tests/e2e/merch-catalog.spec.ts:53`, `:58`, and `:64`. Playwright matches a
  string name as a case-insensitive substring. The header cart link is named
  `Cart` (`src/features/guest-cart/GuestCartNav.astro:3`), so the footer
  `/cart` link in the `footer_account` menu is `Shopping bag` (`seed/seed.json:218`,
  `src/features/store-shell/store-menu.ts:40`). Keep `Cart`, and `catalog` in
  any case, out of every other link name; the header and footer render on
  every page.
- Pages never scroll sideways: `document.documentElement.scrollWidth` must not
  exceed `clientWidth`. The phone project checks this at 320×640 with the menu
  open (`tests/e2e/store-header-nav.spec.ts:287-293`), and other specs check it
  at each project viewport. Wide header items collapse: below 48rem the store
  label and search pill are hidden
  (`src/features/store-shell/global.css:232-245`).
- When no shipping policy is configured, `/shipping` `<main>` text must not
  match `/\$\d|\b[A-Z]{2}\b|\d+ days/u`
  (`tests/e2e/structured-data-policy-feed.spec.ts:151-155`). That rules out
  text such as `$5`, `US`, `GO`, or `5 days` in the fallback prose
  (`src/pages/shipping.astro:52-54`), the seeded `policy-support-note` section,
  and other main content. The check reads `textContent`, so hidden text counts.
- A seeded `custom` menu item's `url` lands in `_emdash_menu_items.custom_url`;
  the table has no `url` column, so queries select `custom_url`.
  `tests/unit/emdash-theme-composition.test.ts:139-150` does, and pins
  `footer_policies` to `/shipping` and `/returns`, in that order. Account and
  Shopping bag live in the `footer_account` menu, which the footer menu widget
  shows (`tests/unit/emdash-theme-composition.test.ts:170`).
- `tests/unit/emdash-theme-composition.test.ts:43-87` reads source as text:
  `src/styles/tokens.css` stays in `@layer base` with the `aizome`, `forest`,
  and `cobalt` presets, `src/styles/theme.css` keeps an empty unlayered
  `:root {}`, and each public page it lists contains
  `<StoreFooter profile={profile} />`.

Keep these store-shell `data-*` hooks, with their values:

| Surface | Hooks | Defined in | Read by |
| --- | --- | --- | --- |
| Header | `data-store-header`, `data-store-main-nav`, `data-shopper-account-nav` | `src/features/store-shell/StoreHeader.astro:39`, `:47`, `:84` | `tests/e2e/store-header-nav.spec.ts:15`, `:76`; `tests/e2e/shopper-account.spec.ts:17` |
| Header menu | `data-store-menu-toggle`, `data-store-menu-parent`, `data-store-menu-expand` | `src/features/store-shell/StoreHeader.astro:42`, `:50`, `:52` | `src/features/store-shell/store-menu-client.ts:11-22`, which `tests/e2e/store-header-nav.spec.ts` exercises |
| Cart link | `data-guest-cart-nav`, `data-guest-cart-count` | `src/features/guest-cart/GuestCartNav.astro:3`, `:5` | `tests/e2e/store-header-nav.spec.ts:77`; `tests/e2e/guest-checkout-feasibility.spec.ts:144`; `tests/unit/guest-cart.test.ts:271`, `:295` |
| Footer | `data-store-footer`, `data-footer-shop-nav`, `data-footer-policies-nav`, `data-nav-source`, `data-theme-switcher`, `data-theme-choice`, `data-preset-switcher` | `src/features/store-shell/StoreFooter.astro:77`, `:93-94`, `:115-116`, `:170-201` | `tests/e2e/store-header-nav.spec.ts:78`, `:85`, `:92-93`; `tests/unit/emdash-theme-composition.test.ts:95-99` |
| Footer widgets | `data-widget-area="footer"` and `data-widget-type`, rendered by EmDash `<WidgetArea name="footer" />` | `src/features/store-shell/StoreFooter.astro:139` | `tests/e2e/store-header-nav.spec.ts:86-90`; `tests/unit/emdash-theme-composition.test.ts:94`, `:109` |
| Policy pages | `data-policy-support-section="policy-support-note"`, `data-section-source` | `src/pages/shipping.astro:45-46`; `src/pages/returns.astro:59-60` | `tests/e2e/store-header-nav.spec.ts:102-107` |
| Search | `data-search-result={hit.slug ?? hit.id}` | `src/pages/search.astro:162` | `tests/e2e/store-header-nav.spec.ts:113` |
| Product page content | `data-product-summary`, `data-product-details`, `data-product-section`, `data-product-specs`, `data-product-gallery`, `data-gallery-thumb`, `data-product-image-placeholder` | `src/pages/products/[id].astro`, `src/features/store-shell/blocks/CollapsibleSection.astro`, `src/features/store-shell/blocks/SpecTable.astro`, `src/features/commerce-catalog/ProductGallery.astro` | `tests/e2e/product-page-content.spec.ts` |
| CMS pages | `data-cms-page`, `data-cms-page-body`, `data-page-not-found` | `src/pages/[slug].astro` | `tests/e2e/cms-pages-and-redirects.spec.ts` |

Feature specs and source-reading unit tests such as
`tests/unit/shopper-account.test.ts:635` pin many more hooks. Search `tests/`
for a `data-*` name before renaming or removing it.

## Installed catalog consumer (2026-10-07)

Default catalog reads use the installed Registry Commerce runtime `r_gshdrqaldna3r7sn` and its public `catalog/public` route through EmDash public-only SSR dispatch. The identity derives from publisher `did:plc:ekk4pjmkh3k3ql2kfoex3qt4` and slug `dinkus-commerce`. An absent/private route or malformed projection fails closed without falling back to a native plugin. Every cursor is followed, including empty filtered pages. Commerce projects the customer price; Template does not reconstruct a sale comparison. Native storage reads and the native plugin registration require `DINKUS_CATALOG_PROFILE=native-development`; canonical browser fixtures set that explicit profile. Shipping installation needs the matching installed Commerce artifact.

For a separate Cloudflare Registry target, `DINKUS_WRANGLER_CONFIG` selects both the adapter configuration and the build-time catalog profile. A shipping configuration must contain a `LOADER` Worker Loader binding; the host selects the published Cloudflare sandbox module. The default native demo remains separate. Verify with `pnpm verify`, a fresh local Worker database, and an actual signed Registry install before claiming hosted readiness. A build or absent-plugin fail-closed check does not establish installation or deployment. Deployment-specific configuration stays under ignored `runs/` and requires protected admin/setup before routing a hostname.

Git builds use `pnpm run build:registry` with preprovisioned resource identities from private build variables. [Registry Git build settings](docs/implementation/registry-git-build.md) define the build/deploy commands and inputs. `tests/workflows/registry-build.test.mjs` checks missing-input refusal, pinned resource IDs, shipping selection, and closed bootstrap defaults.

The local source pin is the released Commerce tag and commit in `package.json`
`dinkuskit.sourcePins.commerce` (`v0.5.0` at
`6ff63efb58fbbc501d07bada6ee84a088b9ada32` when written), with EmDash `1.2.0`;
the Update playground plugins button moves it to the latest stable release. Existing
Commerce49/Payments12 package verifiers are historical exact-artifact fixtures
and intentionally refuse this new pairing. They are not proof of this source
candidate. The optional cart coupon passes only intent to canonical checkout;
it stays subject to Commerce support. Checkout admission now consumes the
exact owner-supplied TEST readiness response through the original installed
public dispatcher; the playground's native-development catalog, absent plugins, and
missing/invalid configuration remain closed. Catalog or prepare success does
not imply Registry readiness. See [Registry merchant checkout](docs/implementation/registry-merchant-checkout.md).
