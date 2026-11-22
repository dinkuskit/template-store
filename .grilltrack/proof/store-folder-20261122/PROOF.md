# Store sidebar folder (admin-one-store-folder-128)

Decision: `admin-one-store-folder-128` in dinkuskit/dinkuskit (step (a) of
`store-connect-order-135`). One **Store** folder in the EmDash sidebar holds the
template store's Products and Product categories plus the Commerce, Payments and
Ship pages.

Screenshots are not kept in this repository (AGENTS.md: `.grilltrack/proof/` is
text proof). They are committed with the companion Commerce PR, together with
how they were taken:
https://github.com/dinkuskit/commerce/blob/2a534a217a4e5b201362d3d5c05405025dbfc6f1/proof/store-folder-20261122/PROOF.md

## A fresh store (22 Nov 2026)

A store made from this branch's seed on EmDash 1.4.0 under `astro dev` (Node,
SQLite), with the companion Commerce Registry build mounted through
`sandboxed: [...]` and the Payments and Ship branches packed with the official
Registry packager. `shot.cjs` here signed in and took the pictures.

- [fresh-store-folder.png](https://github.com/dinkuskit/commerce/blob/2a534a217a4e5b201362d3d5c05405025dbfc6f1/proof/store-folder-20261122/fresh-store-folder.png): one Store folder with
  Product categories, Products, Payment settings, Shipments, Orders and Commerce
  settings. No Dinkus Commerce, Dinkus Payments or Dinkus Ship folder.
- [fresh-payment-settings.png](https://github.com/dinkuskit/commerce/blob/2a534a217a4e5b201362d3d5c05405025dbfc6f1/proof/store-folder-20261122/fresh-payment-settings.png): Payment settings
  opens from that folder at its usual address.

## An existing store upgrading (22 Nov 2026)

1. A store made and set up on main 84dfaf8: its seed and self-upgrade steps 001
   to 005, 5 products and 3 product categories. The owner had put Product
   categories in a folder of their own, "Catalog" (`_emdash_collections.nav_group`).
2. [upgrade-1-before.png](https://github.com/dinkuskit/commerce/blob/2a534a217a4e5b201362d3d5c05405025dbfc6f1/proof/store-folder-20261122/upgrade-1-before.png): on main, Catalog holds
   Product categories and Products sits loose under Content.
3. The same database run on this branch (3ef68df). The first storefront request
   ran `006_store_folder`; `dinkus:storefront-upgrades` now ends
   `005_commerce_box_off`, `006_store_folder`.
4. Read from the database afterwards: `products` group `Store`, `categories`
   still `Catalog`, `pages` none; still 5 products and 3 product categories.
   `/`, `/categories/hats`, `/categories/tees`,
   `/products/ribbed-beanie-preview` and `/products/boxy-tee-preview` answer 200.
5. [upgrade-2-after.png](https://github.com/dinkuskit/commerce/blob/2a534a217a4e5b201362d3d5c05405025dbfc6f1/proof/store-folder-20261122/upgrade-2-after.png) (desktop) and
   [upgrade-3-after-phone.png](https://github.com/dinkuskit/commerce/blob/2a534a217a4e5b201362d3d5c05405025dbfc6f1/proof/store-folder-20261122/upgrade-3-after-phone.png) (phone, menu open):
   Products joined the Store folder; the owner's Catalog folder is untouched.

The same cases are in `tests/unit/storefront-upgrades.test.ts` (6 pass): the
upgrade, an owner's own folder left alone, and a fresh store from the seed.
