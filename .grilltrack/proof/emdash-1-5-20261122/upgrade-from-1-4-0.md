# EmDash 1.4.0 to 1.5.0 upgrade of a filled store

Before: template-store main `8743e59` (EmDash 1.4.0, Commerce `v0.9.0-beta.2` b460433, Registry build).
After: this PR (EmDash 1.5.0, Commerce `v0.9.0-beta.3` c9b24fc, Registry build), both under the beta
runtime id `r_fjzjvld3ssb4j63o`. Run 22 Nov 2026 in a cloud container, Node 24.22.0, local SQLite stores
started by `tests/paired`'s own Playwright config.

## Steps

1. On main, a fresh store was filled by main's own paired specs, desktop: `catalog-card-availability` and
   `variant-cart` (3 passed). They made products with Sizes, a sold-out Size, a digital and a printed
   product, published pages and two carts.
2. A recorder (a throwaway spec, not committed) read the store as the owner and as an anonymous shopper:
   every Content > Products page and its status, each `/products/<slug>` answer, Commerce's private
   catalog list, its public catalog, and from the database the migrations, plugin unique indexes,
   Commerce storage counts and plugin state.
3. That database (checkpointed, sha256 `990ea9ca…6db3836`) was copied to this PR's store, which started
   on it, ran EmDash 1.5's migrations, and the recorder read the same things.
4. On the upgraded store, the same specs ran on the phone project (3 passed): they made new products and
   pages, filled carts with a chosen Size and checked out, as they do on a fresh store. Then a new product with an SKU
   another product already has was tried.

## Results

| Check | EmDash 1.4.0 store | Same database on EmDash 1.5.0 |
|---|---|---|
| Starts on the existing database | yes | yes |
| New core migrations | last `091_redirect_artifacts` | `092_plugin_kv_options`, `093_menu_item_orphans`, `094_media_usage_file_url_reindex`, `095_plugin_storage_unique_scope`, `096_revision_kind_and_editors`, `097_room_storage` |
| Products in Content > Products (slug, status) | 9 | identical |
| Commerce catalog list (id, name, SKU) | 4 products | identical |
| Commerce storage | catalog_items 7, checkout_carts 2, checkout_guest_capabilities 2, product_pages 8 | identical |
| Commerce unique indexes | `uidx_plugin_r_fjzjvld3ssb4j63o_catalog_items_commandId`, `uidx_plugin_r_fjzjvld3ssb4j63o_catalog_items_skuKey`, `uidx_plugin_r_fjzjvld3ssb4j63o_managed_sku_claims_claimKey`, `uidx_plugin_r_fjzjvld3ssb4j63o_managed_sku_claims_operationId`, `uidx_plugin_r_fjzjvld3ssb4j63o_store_inventory_configurations_configurationKey` | renamed by 095: `uidx_plugin_4d884285b095f80ebda4215a23325f71`, `uidx_plugin_617097d8d729e8d8e08ce1625dcdba23`, `uidx_plugin_61baf318eaf8ee1716420445e5206326`, `uidx_plugin_914b72f01aa99dfb3ae69e5c4bb3e9d8`, `uidx_plugin_e1b0467f56d2039613b8029b063979a0` |
| Everything recorded, compared field by field | | **equal** |

Product pages, as an anonymous shopper (both stores answered the same):

| Page | Status |
|---|---|
| `grow-guide` | 404 |
| `sized-hoodie` | 404 |
| `card-desktop-family` | 404 |
| `card-desktop-simple` | 404 |
| `ribbed-beanie-preview` | 200 |
| `canvas-cap` | 404 |
| `pullover-hoodie-preview` | 200 |
| `boxy-tee-preview` | 200 |
| `everyday-tee` | 404 |

Drafts answer 404, as do the two published seed pages that also answer 404 on main.

After the writes on 1.5.0: Commerce storage catalog_items 14, checkout_carts 4, checkout_guest_capabilities 4, product_pages 16; new pages `grow-guide-phone`, `sized-hoodie-phone`, `card-phone-family`, `card-phone-simple`.
The duplicate SKU was refused with 400 and Commerce's own message, "sku is already assigned to
another catalog item". This is the check that needs Commerce to know 1.5's index names: an older Commerce
did not recognize the renamed index on 1.5 and refused new products (dinkuskit/commerce#290).

Pictures of the upgraded store, taken after step 4:

- [`upgraded-admin-products.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/e26bb525a013f2447437478ae932da3a9cc3a8df/template-store/pr-255-f4489a0/upgraded-admin-products.png): Content > Products, all 14 pages (the 9 from 1.4, the 4 made on 1.5 and
  the duplicate-SKU page, which got no product). The footer reads EmDash v1.5.0.
- [`upgraded-product-page.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/e26bb525a013f2447437478ae932da3a9cc3a8df/template-store/pr-255-f4489a0/upgraded-product-page.png): a seed product page from the 1.4 database, as a shopper sees it on 1.5.

Run on its own, the Registry path is also covered by `pnpm verify:paired-product-on-sale` on a fresh
1.5.0 store (12 passed, see `PROOF.md`).
