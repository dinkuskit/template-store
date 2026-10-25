# DinkusKit Store Starter — Stitch Design System & Upstream EmDash Architecture

Updated: 2026-10-21
Stitch Project ID: `projects/986073655661399908`
Canonical visual contract: `design.md`

---

## 1. Aesthetic Direction & Tactile Stamp System

The `template-store` visual language blends **Warm Minimalist Editorial** with **Tactile Industrial Blueprint** precision:
- **Tactile Stamp Framing**: Cards, spec panels, and editorial modules use crisp `1.5px solid var(--store-ink-border)` rules, `10px` radius (`var(--store-radius-card)`), and a `4px 4px 0 var(--store-shadow)` hard offset shadow (`3px 3px 0` on interactive controls).
- **12-Column Asymmetric Architectural Grid**: Maximum container width `70rem` (`1120px`), `1.25rem` (`20px`) grid gap, and `clamp(1rem, 3vw, 2.5rem)` outer gutter.
- **High-Contrast Authority Separation**:
  - **EmDash CMS Composition** (hero blocks, Portable Text sections, editorial notes, menus, widget areas) uses warm paper surfaces and editorial serif/grotesk hierarchy.
  - **Commerce & Inventory Truth** (catalog prices, SKU/GTIN/MPN identifiers, stock counters, order receipts, policy definition lists) uses tabular monospace (`var(--font-mono)`) and structured spec-sheet rails.

---

## 2. Upstream EmDash Theming (`src/styles/tokens.css` + `src/styles/theme.css`)

In alignment with upstream EmDash templates (`blog`, `marketing`, `portfolio`), all design tokens live inside `@layer base` in `src/styles/tokens.css` using CSS `light-dark(<light>, <dark>)`, while `src/styles/theme.css` ships as a blank unlayered `:root {}` override sheet where template adopters place brand customizations without fighting specificity.

### 2.1 Curated Stitch Presets (`@layer base` in `src/styles/tokens.css`)

1. **`aizome` — Japanese Indigo & Hanko Vermilion (Default — `:root, :root[data-preset="aizome"]` — Stitch `Palette 2` / `12731803759120499283`)**
   - `--store-bg`: `light-dark(#f4f1ea, #0b111d)` (Warm Washi / Deep Indigo Night)
   - `--store-surface`: `light-dark(#fcfbf8, #141e30)` (Crisp Chalk / Slate Indigo Card)
   - `--store-surface-subtle`: `light-dark(#ebe6dc, #1b2840)`
   - `--store-ink`: `light-dark(#101827, #f4f1ea)` (Deep Aizome Indigo / Warm Washi Ink)
   - `--store-ink-border`: `light-dark(#101827, #334155)`
   - `--store-line`: `light-dark(#dcd6c8, #26354d)`
   - `--store-muted`: `light-dark(#525b6c, #9ca6b8)`
   - `--store-accent`: `light-dark(#d1492f, #e05a40)` (Hanko Vermilion)
   - `--store-vault-bg`: `#101827` (Anchored Aizome Vault)
   - `--store-vault-ink`: `#fcfbf8`
   - `--store-shadow`: `light-dark(#101827, #05080f)`
   - `--dinkus-action-background`: `#172033` (Preserves exact RGB `rgb(23, 32, 51)` primary CTA contract)
   - `--dinkus-action-color`: `#fffefb` (Preserves exact RGB `rgb(255, 254, 251)` primary CTA contract)

2. **`forest` — Alpine Forest & Terracotta Clay (`:root[data-preset="forest"]` — Stitch `Palette 1` / `12731803759120499283`)**
   - `--store-bg`: `light-dark(#f4efe6, #09130e)` (Warm Sand / Deep Pine Night)
   - `--store-surface`: `light-dark(#fcfbf7, #12221a)` (Ivory Chalk / Forest Card)
   - `--store-surface-subtle`: `light-dark(#eae3d5, #192f24)`
   - `--store-ink`: `light-dark(#0f1f18, #f4efe6)` (Alpine Forest / Warm Sand Ink)
   - `--store-ink-border`: `light-dark(#0f1f18, #2d4a3e)`
   - `--store-line`: `light-dark(#d8d0c0, #233b30)`
   - `--store-muted`: `light-dark(#526058, #9bb0a5)`
   - `--store-accent`: `light-dark(#c85a32, #db6b42)` (Terracotta Clay)
   - `--store-vault-bg`: `#0f1f18`
   - `--store-vault-ink`: `#fcfbf7`
   - `--store-shadow`: `light-dark(#0f1f18, #040907)`

3. **`cobalt` — Carbon Graphite & Bauhaus Cobalt (`:root[data-preset="cobalt"]` — Stitch `Palette 3` / `12731803759120499283`)**
   - `--store-bg`: `light-dark(#f3f4f6, #0b0d11)` (Cool Chalk / Carbon Night)
   - `--store-surface`: `light-dark(#ffffff, #161922)` (Pure White / Graphite Card)
   - `--store-surface-subtle`: `light-dark(#e5e7eb, #1f2430)`
   - `--store-ink`: `light-dark(#111318, #f3f4f6)` (Carbon Graphite / Cool Chalk Ink)
   - `--store-ink-border`: `light-dark(#111318, #374151)`
   - `--store-line`: `light-dark(#d1d5db, #262b38)`
   - `--store-muted`: `light-dark(#525866, #9ca3af)`
   - `--store-accent`: `light-dark(#2554d9, #4b7bf5)` (Bauhaus Cobalt)
   - `--store-vault-bg`: `#111318`
   - `--store-vault-ink`: `#ffffff`
   - `--store-shadow`: `light-dark(#111318, #050608)`

### 2.2 Color Scheme & Preset Persistence

- `:root[data-theme="light"] { color-scheme: light; }`
- `:root[data-theme="dark"] { color-scheme: dark; }`
- `:root:not([data-theme]), :root[data-theme="system"] { color-scheme: light dark; }` (defaulting to `light` when no cookie is set so deterministic headless browser checks see the light palette unless toggled).
- Restored before first paint via an inline script in `StoreHeader.astro` reading cookies `dinkus_theme` (`light` | `dark` | `system`) and `dinkus_preset` (`aizome` | `forest` | `cobalt`).
- Interactive switcher controls (`[data-theme-switcher]` and, when `profile === "proof"`, `[data-preset-switcher]`) are mounted in `StoreFooter.astro` Column 4 and in the `.store-demo-banner` utility bar on `proof`/playground.

---

## 3. Typography (`Type 3` — Technical Grotesk & Tabular Mono)

- `--font-display`: `"Space Grotesk", Inter, ui-sans-serif, system-ui, -apple-system, sans-serif`
- `--font-sans`: `"DM Sans", Inter, ui-sans-serif, system-ui, -apple-system, sans-serif`
- `--font-mono`: `"Space Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`
- Numeric discipline: `font-variant-numeric: tabular-nums` on all prices (`[data-product-price]`, `.price`), stock values (`[data-stock-value]`), SKUs (`[data-product-sku]`), and order totals.

---

## 4. Locked Stitch Screen Architecture

| Surface | Locked Stitch Screen ID | Layout & Component Contract |
| --- | --- | --- |
| **Homepage (`/`)** | `R2-3 + R2-1` (`7810202636535205212` / `3271005116230829400`) | Asymmetric 7/5 `HomeOpener.astro` hero with 3-column fact rail (`EmDash + Blocks`, `Dinkus Commerce`, `Dinkus Payments`), runtime `.catalog-guidance` callout, 3-column `CommerceCatalog.astro` tactile stamp cards, and collapsible `ManagedProductAvailability.astro` / `UnmanagedProductSellability.astro` proof drawers. |
| **Category (`/categories/[slug]`)** | `Cat 3` (`7010631373142009984`) | Compact breadcrumb + collection header band with item-count pill, followed by the 3-column tactile stamp `MerchCatalog.astro` grid. |
| **Product Detail (`/products/[id]`)** | `PDP 1` (`12897201338897466387`) | 7/5 asymmetric split: `4:3` garment media frame on the left; sticky right buy column with category eyebrow, display title, tabular mono price + SKU/GTIN/MPN/Brand pills, fieldset variant selector pills, availability badge, and primary `AddToCart.astro` CTA. |
| **Guest Cart (`/cart`)** | `Cart 1` (`12413218872074049968`) | 7/5 split layout: left line-item cards (`[data-guest-cart-lines]`) with quantity stepper and remove button; right sticky summary & checkout contact/delivery fieldset (`[data-guest-cart-contact]`), disabled coupon box (`[data-guest-cart-coupon-box]`), and primary checkout button (`[data-guest-cart-checkout]`). |
| **Order Confirmation (`/checkout/success`)** | `Order 2` (`17023558311715088332`) | Tactile receipt sheet (`GuestCheckoutReturn.astro`) with order heading, `TEST` badge, tabular item list (`[data-guest-checkout-order-items]`), totals (`[data-guest-checkout-order-totals]`), next-steps note, and continue-shopping CTA. |
| **Shopper Account (`/account`)** | `Account 1` (`12309268467303058426`) | Signed-out 2-column split comparing Option 1 (Verified Email 6-Digit PIN + Updates Opt-In) and Option 2 (Instant Demo Shopper `shopper@example.com` on playground); signed-in session bar + 2-column order history and default shipping address editor. |
| **Shipping & Returns (`/shipping`, `/returns`)** | `Policy B1` (`1531494688908048456`) + `System 4` (`15376069851779807133`) | Standardized 4/8 split: left 4-col Aizome Care & Provenance Rail (`getSection("policy-support-note")` rendered via `<PortableText />` inside `[data-policy-support-section="policy-support-note"]` + sibling policy nav); right 8-col Crisp Chalk policy card (`dl[data-shipping-policy]` / `dl[data-return-policy]` or unset status). |
| **Live Search (`/search`) & Header Search Pill** | `Search 3 + 2 Hybrid` (`15718260648419012371`) | Rounded `[ Search products... (GO) ]` pill form (`store-header__search-pill`) in `StoreHeader.astro`, inside the `/search` vault, and inside the footer search widget. `/search` uses a 5/7 Inverted Split: left 5-col Dark Aizome Search Command Vault (`7px` Vermilion shadow) housing the pill search bar, `<LiveSearch>` instant dropdown (`emdash/ui/search`), collection scope pills (`products`, `categories`, `pages`), and quick links; right 7-col Crisp Chalk matched entries card when `?q=` is present. |
| **Shared Global Footer (`StoreFooter.astro`)** | `Tiebreaker A: Footer 1 + 4 Hybrid` (`12243498420296028630`) | Mounted across all public routes. Top Dark Aizome tier (`3px` Vermilion top rule): Col 1 Brand + Provenance in a `4px` Vermilion tactile stamp card (`getSiteSettingsWithCacheHint()`); Col 2 `footer_shop` menu (`[data-footer-shop-nav]`); Col 3 `<WidgetArea name="footer" />` (`content` widget + `menu:footer_policies` widget in center + `core:search` `component` widget in a right `4px` Vermilion tactile stamp card with the `[ Search products... (GO) ]` pill). Bottom `#0B111D` Colophon Band: copyright + Theme (`Light`/`Dark`/`System`) & color-coded Preset (`Aizome`/`Forest`/`Cobalt`) switcher pills (strictly in the footer colophon, never in the header). |
| **EmDash Composition Primitives** | `System 1` + `System 3` + `System 4` | Exercises all 3 EmDash composition primitives in one storefront: `blocks` (`pages.layout`: `home_opener`, `rich_text`, `query_card`), `sections` (`home-opener` + `policy-support-note` via `getSection()` + `<PortableText />`), and `widgetAreas` (`<WidgetArea name="footer" />` with `content`, `menu`, and `component` widgets). |
