# Commerce holds the page link; product pages have no Commerce product box

Covers `template-no-commerce-box-20261029`, the template half of Commerce
`catalog-page-link-in-commerce-20261029` (dinkuskit/commerce#208). Ronald locked
option B on 29 Oct 2026 at 16:01 UTC: "An editable field on a product page that
isn't meant to be touched is bad UI/UX".

## What changed

- **Publish check** (`src/features/product-on-sale/`). It asks Commerce's private
  `catalog` route, as the person, for the page's product (`get` by `entryId`) and
  sends `catalog-items/set-on-sale` the page alone. A publish of a page Commerce
  links to no product is refused with 422 `PUBLISH_REJECTED`: "This page has no
  product yet. Add price and stock in the Dinkus Commerce panel, then publish."
  An older store's Commerce product box counts, and is sent as `catalogItemId`,
  only while Commerce links that page to nothing or cannot say. A Commerce without
  the `catalog` route is never asked. The seed's demonstration pages are known by
  slug (`src/features/store-shell/seeded-page-products.ts`). Scheduled publishes
  work the same way: a schedule grant no longer names a product, and the sweep
  sells whatever Commerce links to the page.
- **Storefront reads**. The shop, categories, search, feeds and `/proof` map each
  page to its product through the public catalog's `page`. A product page asks
  `catalog/public/item?pageId=`. A published page Commerce lists no product for is
  left out like an invalid one, and on a shipping store its address says the
  product is no longer available. The shop lists only priced products, as before,
  so an unpriced product's page is left out too. An older store's box counts
  only for a product Commerce sells on no other page: when Commerce links a
  product to one page and another page's box still names it, the product is
  the linked page's, and the other page sells nothing (two boxes naming one
  product are still both refused).
- **Seed and schema**. The seed drops `commerce_item_id`. Storefront upgrade
  `005_commerce_box_off` (`src/features/store-shell/product-schema-upgrade.ts`)
  removes an older store's box only when both of these hold:
  - no page's box is the only record of its product. Every page counts, drafts,
    scheduled pages and pages in the trash as well as published ones, since
    publishing or restoring one later still needs its product. A box holds the
    upgrade back while it names a Commerce product that Commerce links to no page
    (no `e:` or `p:` row in `product_pages` for this page or naming that product,
    and no other page as the product's `pageId`), archived products included,
    since they can be restored. A typed "123" or a demonstration id sells
    nothing, and a copied page's box naming a product another page sells can't
    sell it, so neither holds it back;
  - no Registry install of Commerce is older than `0.7.0-beta.3`, the first
    Commerce that holds links. An older one still links pages only through the box.

  Until then it logs what it waits for, stays unrecorded, and is tried again
  15 minutes later, without holding back later steps.
- **Product URL plugin**. It no longer needs a product id to publish or schedule.
  It claims a box value, and names it in a schedule's grant, only while the box
  exists and Commerce links the page to nothing. Its publish and schedule hooks
  ask Commerce for the page's product as the signed-in person (the publish check
  hands them that lookup for the request), so a page whose box still names an
  older product while Commerce links a newer one claims nothing and refuses no
  other page. EmDash's scheduler publishes with nobody to ask as, so it keeps the
  claim the schedule made. The sweep that sells scheduled pages holds a grant to
  its box product only while the page still sells by its box.
- **Pins**. The playground's native Commerce and the paired proof run
  commerce#208's head (`8e788dd`) until the beta carrying it is cut, so the
  playground never runs a Commerce that cannot link a page. The feature audit
  allows a `vX.Y.Z-beta.N` tag. The playground updater never moves a beta pin
  back to an older stable release.

## Checks

All on Node 24.22.0 and EmDash 1.2.0, on this branch with main `414e5f3` (#169) merged in.

- **Unit, types, feature audit** (`bin/verify-web quick`): astro check 0 errors, 565 unit tests pass, workflow tests and the feature audit pass.
- **Browser** (`pnpm exec astro build && pnpm exec playwright test`): the full run
  passed 75 and skipped 7 of 88; the 6 misses were three specs written for
  Commerce 0.6.0 (the panel's "On sale" line for an unpriced published product,
  an unpriced product's page still showing, and the page's own placeholder where
  Commerce now shows its product's). Those specs now price their products and
  read Commerce 0.7.0's "Published: off the shop" line; rerun on desktop and
  phone, all pass.
- **Real Commerce** (`pnpm verify:paired-product-on-sale`, Registry build of
  commerce#208 `8e788dd`, `backend_bytes=130952`, `headroom_bytes=120`,
  `backend_sha256=a1e51872…`): 5 pass, 1 skipped (the older-store test runs on
  desktop only). Besides the publish, schedule, take-back and refusal steps:
  - a page whose product the panel added publishes with no box and sells, and a
    scheduled page sells whatever Commerce links to it (its schedule grant names
    no product);
  - **an older store**: the box is added back through EmDash's schema API, a page
    that names its product only in the box publishes, sells and shows $15.00 on
    the storefront. With its Commerce link rows removed, `pnpm search:upgrade`
    reports `waiting: ["005_commerce_box_off"]` and keeps the box; the page still
    unpublishes (off sale) and publishes (on sale) by its box, which records
    the link in Commerce. While a draft whose box is the only record of its
    product holds the upgrade back, the hat page's panel picks a newer product
    ($16.00) and its box still names the older one: a schedule of the page
    names no product, EmDash's scheduler publishes it, and the admin's next
    visit sells the newer product; a copy of the page whose box names the older
    product then publishes and sells it ($15.00), unrefused. Publishing the
    draft sells its product ($12.00) and records its link. The next upgrade
    removes the box and its column, and all three pages still show, the hat
    page unpublishing and publishing, now by Commerce's link.
