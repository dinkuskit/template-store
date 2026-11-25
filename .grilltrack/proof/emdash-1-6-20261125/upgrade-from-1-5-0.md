# EmDash 1.5.0 to 1.6.0 upgrade of a filled store

Before: template-store main `8cce9dc` (EmDash 1.5.0, Commerce `v0.9.0-beta.5`, Registry build).
After: this PR (EmDash 1.6.0, the same Commerce `v0.9.0-beta.5` Registry build), both under the beta runtime id
`r_fjzjvld3ssb4j63o`. Run 25 Nov 2026 in a cloud container, Node 24.22.0, local SQLite stores.

## Steps

1. On main, a fresh store was filled by main's own paired specs, desktop: `catalog-card-availability` and
   `variant-cart` (3 passed). They made products with Sizes, a sold-out Size, a digital and a printed
   product, published pages and two carts.
2. A recorder (a throwaway script, not committed) read the store from its database and as an anonymous
   shopper: migrations, every Content > Products page and its status, Commerce's catalog, Commerce storage
   counts, plugin unique indexes, plugin state, users and their columns, and each `/products/<slug>` answer.
3. That database (checkpointed, sha256 `9023f4fd…0223`) was copied to this PR's store, which started on it,
   ran EmDash 1.6's migrations, and the recorder read the same things.
4. On the upgraded store, the same specs ran on the phone project (3 passed): they made new products and
   pages, filled carts with a chosen Size and checked out, as they do on a fresh store.

## Results

| Check | EmDash 1.5.0 store | Same database on EmDash 1.6.0 |
|---|---|---|
| Starts on the existing database | yes | yes |
| Core migrations | 96, last `097_room_storage` | 97: adds only `098_user_last_login` |
| `users.last_login_at` column | absent | present (the only schema change) |
| Products in Content > Products (slug, status) | 9 | identical |
| Commerce catalog (id, name, SKU) | 7 entries | identical |
| Commerce storage | catalog_items 7, checkout_carts 2, checkout_guest_capabilities 2, product_pages 8 | identical |
| Commerce unique indexes | `uidx_plugin_4d884285…`, `uidx_plugin_617097d8…`, `uidx_plugin_61baf318…`, `uidx_plugin_914b72f0…`, `uidx_plugin_e1b0467f…` | identical (1.6 renames nothing) |
| Commerce plugin state | active, 0.9.0-beta.5 | identical |
| Everything recorded, compared field by field | | **equal** |

Product pages, as an anonymous shopper (both stores answered the same):

| Page | Status |
|---|---|
| `boxy-tee-preview` | 200 |
| `pullover-hoodie-preview` | 200 |
| `ribbed-beanie-preview` | 200 |
| `canvas-cap` | 404 |
| `everyday-tee` | 404 |
| `card-desktop-family` | 404 |
| `card-desktop-simple` | 404 |
| `grow-guide` | 404 |
| `sized-hoodie` | 404 |

Drafts answer 404, as do the two published seed pages that also answer 404 on main.

After the writes on 1.6.0: Commerce storage catalog_items 14, checkout_carts 4, checkout_guest_capabilities 4,
product_pages 16.

Pictures of the upgraded store, taken after step 4:

- [`upgraded-admin-products.png`](ASSETS_BASE/upgraded-admin-products.png): Content > Products, all 13 pages (the 9 from 1.5 and the 4 made on 1.6). The footer reads EmDash v1.6.0.
- [`unpublish-asks-first.png`](ASSETS_BASE/unpublish-asks-first.png): on 1.6, Unpublish on a published product page asks "Unpublish Product?" first. Cancel was pressed, so the page stayed published.
- [`phone-show-settings-commerce-panel.png`](ASSETS_BASE/phone-show-settings-commerce-panel.png): on a phone (Pixel 7), Show settings opens the sheet with the Dinkus Commerce panel.

## For each store's own upgrade

The live upgrade of a store is a separate step on the owner's go: bookmark its D1 database, deploy (EmDash applies
098 on the first request), then run `emdash media repair-usage --all` once, as the 1.6 release notes ask.
