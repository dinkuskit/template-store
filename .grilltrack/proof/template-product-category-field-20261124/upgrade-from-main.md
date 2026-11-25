# A filled store from main, upgraded to this field

Before: template-store main `484f875` (EmDash 1.6.0, Commerce `v0.9.0-beta.5` Registry build, storefront
upgrades 001 to 007). After: this PR at `c2af3af`, on the same database. Run 25 Nov 2026 in a cloud
container, Node 24.22.0, local SQLite stores, Commerce under the beta runtime id `r_fjzjvld3ssb4j63o`.

## Steps

1. On main, a fresh store was filled by main's own paired specs, desktop: `catalog-card-availability`
   and `variant-cart` (3 passed). They made products with Sizes, a sold-out Size, a digital and a printed
   product, published pages, two carts and their checkouts.
2. A recorder (a throwaway script, not committed) read the store from its database: migrations, the
   storefront upgrades done, the products collection's fields and table columns, every product row with
   every column, pages, categories, revisions, Commerce's plugin state, every Commerce storage row, plugin
   indexes, options, users, menu items and SEO rows. Main also served each product page to an anonymous
   shopper.
3. That database (checkpointed, sha256 `72deb539…50ee`) started on this PR, which ran upgrade
   `008_product_category` on its first request, and the recorder read the same things.
4. On the upgraded store, the editor was used on a product made before the upgrade, and the same specs ran
   on the phone project (3 passed): new products, pages, carts with a chosen Size and checkouts.

## Results

| Check | Store on main `484f875` | Same database on this PR |
|---|---|---|
| Starts on the existing database | yes | yes |
| Core migrations | 97 | identical |
| Storefront upgrades | 001 to 007 | adds only `008_product_category` |
| Products collection fields | title, categories, description, summary, details, visual_label | adds only `product_category` (string, empty or a Shopify id, up to 64 characters) |
| `ec_products` columns | | adds only `product_category` |
| Product rows (9), every earlier column | | identical; `product_category` empty on all 9 |
| Pages, categories, revisions, menu items, SEO, users, options | | identical |
| Commerce plugin state | active, 0.9.0-beta.5 | identical |
| Commerce storage (catalog_items 7, checkout_carts 2, checkout_guest_capabilities 2, product_pages 8), every row's data | | identical |
| Plugin indexes | | identical |

Product pages as an anonymous shopper, the same on both: `boxy-tee-preview`, `pullover-hoodie-preview`
and `ribbed-beanie-preview` answer 200; the drafts `card-desktop-simple`, `card-desktop-family`,
`sized-hoodie` and `grow-guide`, and the two seed pages `everyday-tee` and `canvas-cap`, answer 404 on
both, as on main.

On the upgraded store, Ribbed Beanie (made on main) opened with the new field empty. Typing `Beanies` was
refused on save ("does not match the required format"); `aa-2-17-2` (Shopify's Beanies) saved to the
page's draft and was still there after a reload. After the phone run: catalog_items 14, checkout_carts 4,
checkout_guest_capabilities 4, product_pages 16.

## Screenshots

Hosted in dinkuskit/dinkus-pr-assets, with sizes and SHA-256 digests in its
[`README.md`](https://github.com/dinkuskit/dinkus-pr-assets/blob/1e5a7a2de364cb6e0198f46004b5bd4c452971c6/template-store/pr-275-c2af3af/README.md):

- [`upgraded-products-list.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/1e5a7a2de364cb6e0198f46004b5bd4c452971c6/template-store/pr-275-c2af3af/upgraded-products-list.png): Content > Products after the upgrade, the same 9 pages.
- [`editor-desktop-empty.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/1e5a7a2de364cb6e0198f46004b5bd4c452971c6/template-store/pr-275-c2af3af/editor-desktop-empty.png): the field, empty, on a product made before the upgrade.
- [`editor-desktop-refused.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/1e5a7a2de364cb6e0198f46004b5bd4c452971c6/template-store/pr-275-c2af3af/editor-desktop-refused.png), [`editor-phone-refused.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/1e5a7a2de364cb6e0198f46004b5bd4c452971c6/template-store/pr-275-c2af3af/editor-phone-refused.png): a category name refused on desktop and on a phone.
- [`editor-desktop-saved.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/1e5a7a2de364cb6e0198f46004b5bd4c452971c6/template-store/pr-275-c2af3af/editor-desktop-saved.png), [`editor-phone.png`](https://github.com/dinkuskit/dinkus-pr-assets/blob/1e5a7a2de364cb6e0198f46004b5bd4c452971c6/template-store/pr-275-c2af3af/editor-phone.png): `aa-2-17-2` kept after a reload, on desktop and on a phone.

## For each store's own upgrade

Nothing to do by hand: a store gains the empty field on its first request after the deploy, and every
product stays Uncategorized until the owner fills it.
