# DinkusKit Store Starter design contract

Updated: 2026-09-30
Canonical path: `design.md`

## Product intent

Provide a neutral, legible proving ground where a store builder can see EmDash
composition, Commerce identity, and Inventory truth operating on
one storefront surface. The first audience is DinkusKit maintainers and early
adopters evaluating the stack, not shoppers on a production store. The classic
merch-catalog first slice provides collection navigation and a product grid.

## Merchant catalog

The Shop above the separate integration demonstrations is driven by persisted
Commerce Products. Name/SKU and Regular/Sale are operated in native EmDash
Products admin. Missing Regular hides both listing and detail; Sale strikes
Regular. Render truthful Commerce availability without inventing quantity.
The catalog may be empty. Shop cards and product pages show the primary image Commerce projects from EmDash's Media Library: the projected alt text, responsive `/_image` srcset, and Commerce's store placeholder when that projection sets `placeholder: true`. A missing or unresolvable image is the text placeholder "No image", never another product's photo, a filename, or a URL from the catalog payload. Prices, availability, and add-to-cart stay on the card. The earlier catalog-only scope is superseded for the authorized guest-cart slice below; checkout remains unavailable until the exact Commerce guest runtime is paired. Preserve
the existing neutral visual language, keyboard links, and narrow-screen fit.
The approved shipping v1 profile has Inventory off. Managed demonstrations
remain explicit development proof. Default shopper pages consume the persisted
Commerce catalog, authoritative prices and unmanaged manual availability, with
no stock quantity or provider requirement. The Commerce owner supplies disabled
Coming soon stock management; preserve existing managed data/fail-closed reads.

## Confirmed constraints

- Show each connected product name and truthful current availability prominently
  in a compact summary below the grid, with Commerce Regular/Sale prices when listable, without implying checkout.
  Put SKU, Inventory identity/location/version, sellability/mode, authority
  explanation, and exact package provenance in keyboard-operable native details.
  Unmanaged availability never shows a quantity or Inventory identity.
- Keep unpriced Commerce products off the public home. Preserve EmDash admin editing.
- Distinguish CMS-authored merchandising from transactional Inventory facts.
- Let a human edit the hero and merchandise titles, collection names, descriptions,
  and visual labels in EmDash admin. Preview cards explicitly say they cannot be
  purchased, and contain no purchase links.
- Ship a seeded first-class Home opener block in Pages `layout`, with neutral
  copy and no prices or stock. Each inserted/duplicated card owns independent
  field values; there is no implicit `/section` insertion into the blocks field.
  Keep legacy Portable Text and its `/section` content renderable during
  migration. The site migration explicitly copies old compositions and never
  overwrites an already-populated `layout`.
- Give each published collection and product a browsable page with catalog/collection back links. Unpublished or missing paths return 404. Product pages use current Commerce/Inventory availability for the two exact connected IDs; previews explicitly remain non-purchasable.
- Use neutral tees, hoodies, and hats; no site-specific branding or invented
  price, shipping, coupons, bundles, or payment authority. The authorized guest cart uses Commerce product reads and identity/quantity intent only.
- Preserve semantic headings, keyboard navigation, visible focus, sufficient
  contrast, and useful status text without relying on color alone.
- Fit narrow mobile and desktop Chromium viewports without horizontal overflow.
- Keep proof controls out of the customer page; automated mutation uses a
  proof-only HTTP endpoint.

## Locked Stitch visual language & upstream EmDash architecture (2026-10-21)

The earlier unresolved visual language is now locked through the GrillTrack +
Google Stitch design cycle (`projects/986073655661399908`; see `.stitch/DESIGN.md`):

- **Tactile Stamp & Architectural Grid**: Storefront cards, policy panels, and
  commerce surfaces use a Warm Minimalist Editorial + Tactile Industrial
  Blueprint system with `1.5px` crisp structural borders, `10px` radius, and
  offset stamp shadows over a 12-column `70rem` container.
- **Upstream EmDash Theming (`src/styles/tokens.css` + `src/styles/theme.css`)**:
  All design tokens live inside `@layer base` in `src/styles/tokens.css` using
  CSS `light-dark(<light>, <dark>)`. `src/styles/theme.css` ships as a blank
  unlayered `:root {}` stylesheet where template adopters place brand overrides.
  `src/styles/tokens.css` ships 3 curated Stitch presets inside `@layer base`:
  `aizome` (default Japanese Indigo `#101827`, Warm Washi `#F4F1EA`, Crisp Chalk
  `#FCFBF8`, Hanko Vermilion `#D1492F`), `forest` (Alpine Forest `#0F1F18` &
  Terracotta Clay `#C85A32`), and `cobalt` (Carbon Graphite `#111318` & Bauhaus
  Cobalt `#2554D9`). Cookie-persisted Light / Dark / System (`dinkus_theme`) and
  proof-mode preset (`dinkus_preset`) switchers restore inline before first
  paint.
- **Shared `StoreFooter.astro` & `<WidgetArea name="footer" />`**: Every public
  route mounts `src/features/store-shell/StoreFooter.astro`, combining
  `getSiteSettingsWithCacheHint()` brand identity, the Commerce/Inventory
  authority statement, the `footer_shop` menu, `<WidgetArea name="footer" />`
  exercising all 3 EmDash widget types (`content` Portable Text note, `menu`
  bound to `footer_policies`, and `component` `core:search`), and the theme/preset
  switcher dock.
- **Full-Text Search (`/search`) & All 3 EmDash Composition Primitives**:
  `products`, `categories`, and `pages` enable `"search"` support in
  `seed/seed.json` and power `/search` (`src/pages/search.astro`) via
  `<LiveSearch>` from `"emdash/ui/search"` and SSR `search()`. Together with
  `pages.layout` (`blocks`), `<WidgetArea name="footer" />` (`widgetAreas`), and
  the seeded `policy-support-note` Portable Text section rendered via
  `getSection("policy-support-note")` + `<PortableText />` on `/shipping` and
  `/returns` (`sections`), the starter exercises every core EmDash composition
  primitive.

## Component contract

- EmDash Merchandise entries render grouped catalog cards; category names link
  to collection pages, and every card links to its product page. The card status reads the connected runtime or
  says preview only; it never stores an editorial stock quantity.
- A shop owner may add a first-class Query Card to Pages `layout` to list up to
  24 current published editorial records from one collection: image, title,
  text, and safe link. Adding a published record updates the list without
  republishing the page. Drafts stay private. This does not replace product or
  collection routes or add filters, pagination, price, stock, or cart.
- Existing Portable Text continues to render through its original renderer when
  no first-class `layout` has been migrated. A page's populated `layout` takes
  precedence; the previous `content` field is retained as a rollback source.
- EmDash Blocks render CMS composition through local presentation components,
  documented classes, attributes, and theme tokens.
- Card View availability links target focusable, visibly highlighted summaries.
  Both summaries retain their machine-readable `data-*` proof hooks; native
  details keep the technical facts and provenance available without dominating
  the shopper-facing page. The managed read remains fail-closed.
- Loading and mutation controls are not required in the first server-rendered
  slice. Browser proof reloads after each command.

## Verification

`bin/verify-web full` must build the real Astro project and run desktop and
mobile acceptance for the default unmanaged profile, plus the explicit
development profile through the complete managed `8 -> 5 -> 8` stock
sequence and the unmanaged manual-availability sequence. Curated screenshots
and the exact assertion record belong in the current proof packet.

## Authorized guest cart extension

Issue #20 authorizes a neutral guest cart within the existing warm-neutral
visual language: add, positive integer quantity changes, remove, empty state,
validated browser persistence and recoverable errors on desktop/mobile. EmDash
composition remains untouched. Browser contents are untrusted intent/cache;
current Commerce catalog reads supply price and sellability for presentation.
The template must not establish its own pricing, stock, checkout or order
backend. The initial cart candidate keeps checkout disabled until Commerce
issue #32 supplies the supported guest capability/status mount and immutable
artifact. Return URL claims never establish a confirmed purchase. Later actual
integration must preserve frozen attempts and clear only the purchased cart
after Commerce durable paid-order confirmation. Synthetic UI proof is not
Stripe test-mode or released registry-pair proof.

## Bounded demo visual refresh (2026-10-09)

This approved refinement stays within the restrained warm-neutral storefront.
Shopper headers use the neutral label `Demo store` for the proof/development
profile and `Store` for shipping semantics; technical integration-status
language stays out of shopper content. The home page adds a short,
runtime-derived guidance note: ready catalogs explain eligible add-to-cart
behavior and closed checkout, while empty or unavailable catalogs explain that
products are not being shown. It never invents a product, media asset, price,
availability, or cart capability.

Commerce cards use clearer media, title, price, availability, and action
grouping. Missing or unresolved media remains the plain `No image` placeholder.
CMS composition, published editorial content, Commerce authority, guest-cart
behavior, and the closed checkout boundary are unchanged. This is a bounded
presentation refinement, not a new visual candidate round or a design-ledger
closure.

## Registry merchant TEST admission (2026-10-12)

The authorized checkout extension consumes Commerce PR106's versioned readiness
response through the same installed public dispatcher as the catalog. The cart
shows its existing checkout flow only for supported TEST readiness; unavailable
or native-development contexts remain closed. This local candidate does not
establish Registry publication, deployment or a real hosted purchase.

## Store header main menu (2026-10-17)

Every shopper page (home, category, product, cart, checkout return) shares one
header: the store mark on the left, the main menu, and the existing store label
and Cart link on the right. The main menu is EmDash's own Menus feature, read
with `getMenu("primary")`; the template does not keep a second navigation
model. The seed creates `primary` as Home and Shop, with Shop opening All
products and one link per seeded category, so fresh stores start with a working
bar and owners rename, reorder or add links in the EmDash admin under Menus.
Category links resolve through the collection URL pattern, and a category that
is unpublished drops out of the menu. A store without a `primary` menu shows
the header without a menu, never invented links.

On desktop the menu is a single row; an item with children opens its
dropdown while the mouse is over it, and its chevron button opens it for
keyboard and click until Escape, a second click, or a click elsewhere closes
it, with `aria-expanded` always matching what is shown. Under 48rem the menu
collapses behind a Menu button and opens as a full-width stacked list with the
same chevron per dropdown. Escape closes the open dropdown, then the menu.
Without JavaScript, desktop dropdowns open on hover and focus, and phones show
the full menu expanded. The link for the current page carries
`aria-current="page"`. The look stays within the existing warm-neutral tokens;
this adds navigation, not a new visual round. `primary` is the only
navigation menu a fresh store seeds: the older `store-primary` ("Store
navigation") menu controlled nothing a shopper sees, so it is gone, and the
category row inside the `/proof` integration demonstrations lists the
published categories it shows.

## Stitch tactile stamp system & upstream EmDash theming (2026-10-21)

- **Upstream EmDash Tokens (`src/styles/tokens.css` + `src/styles/theme.css`)**:
  All design tokens live inside `@layer base` in `src/styles/tokens.css` using CSS
  `light-dark(<light>, <dark>)`, paired with an unlayered `src/styles/theme.css`
  (`:root {}`) imported after `tokens.css` for brand overrides. Three curated
  Stitch presets ship in `@layer base`: `aizome` (default: Japanese Indigo
  `#101827`, Warm Washi `#F4F1EA`, Crisp Chalk `#FCFBF8`, Hanko Vermilion
  `#D1492F`), `forest` (`#0F1F18`, `#F4EFE6`, `#C85A32`), and `cobalt`
  (`#111318`, `#F3F4F6`, `#2554D9`).
- **Shared `StoreFooter.astro` & `<WidgetArea name="footer" />`**:
  Mounted across all public routes (`/`, `/categories/[slug]`, `/products/[id]`,
  `/cart`, `/checkout/success`, `/account`, `/shipping`, `/returns`, `/search`).
  Uses `getSiteSettingsWithCacheHint()` for brand identity with fallback to
  `STORE_TITLE`, renders `footer_shop` and `footer_policies` menus, and mounts
  `<WidgetArea name="footer" />` exercising all three EmDash widget types
  (`content` store note, `menu` bound to `footer_policies`, and `component`
  `core:search`). The bottom colophon band houses the cookie-persisted
  `Light` / `Dark` / `System` switcher and (on `proof`) color-coded
  `Aizome` / `Forest` / `Cobalt` preset pills with dual-tone palette swatches.
- **Header Search Pill & `/search` (`Search 3 + 2 Hybrid`)**:
  `StoreHeader.astro` includes the rounded `[ Search products... (GO) ]` search
  pill (`[data-store-search-nav]`), and `src/pages/search.astro` uses a 5/7
  Inverted Split with the left Dark Aizome Search Command Vault (`<LiveSearch>`
  from `"emdash/ui/search"`, pill search bar, and collection scopes) and right
  Crisp Chalk FTS5 results card.
- **All 3 EmDash Composition Primitives (`blocks`, `sections`, `widgetAreas`)**:
  `pages.layout` exercises `blocks` on `/`; `seed.sections` retains
  `home-opener` and adds `policy-support-note` rendered via
  `getSection("policy-support-note")` + `<PortableText />` on `/shipping` and
  `/returns`; and `seed.widgetAreas` seeds the `footer` widget area.
