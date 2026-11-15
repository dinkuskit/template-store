# template-drop-older-store-box-20261101

Ronald picked "Land 196 now, drop it next" on 1 Nov 2026. The template moved to Commerce 0.8.0 with its older-store box support still in place (template-store#199, merged ff99ad0). This change then removes that support. No real stores exist yet, only the beta store and the template.

## What the code does

- `src/features/product-on-sale/index.ts`: the publish check finds a page's product only through Commerce's private `catalog` route, falling back to the seed's demonstration slug. It never reads `commerce_item_id`. Schedule grants name no product, so the sweep sells whatever Commerce links to the page. It no longer hands the product-url plugin a Commerce lookup.
- `src/features/product-url-plugin/index.ts`: the `claims` storage and the field claims are gone, along with `withCommerceLinks` and the `itemId` on proposals and grants. The plugin keeps only the schedule records (`pending_sales`).
- `src/features/store-shell/product-routes.ts`: a page's product is Commerce's link, else the seed's demonstration slug. A product page and the shop never read the field.
- `src/features/store-shell/product-schema-upgrade.ts`: `005_commerce_box_off` drops the field whenever it is still there. `LINK_HOLDING_COMMERCE`, `olderVersion`, `commerceNeedingTheBox` and `pagesWithoutCommerceLink` are removed.
- `src/features/store-shell/storefront-upgrades.ts`: the "wait" result and its retry timer had no other user and are removed. `pnpm search:upgrade` no longer prints `waiting`.
- `tests/paired/product-on-sale.spec.ts`: the older-store test, old steps 17-21, is removed.

## Evidence

| Check | Result |
|---|---|
| `bin/verify-web quick` (Node 24.22.0, EmDash 1.4.0) | passed: 556 unit tests, 0 Astro errors, workflow tests and the feature audit |
| `pnpm verify:paired-product-on-sale` (Commerce v0.8.0 35f80f21, plugin.mjs e24ac8e7 verified) | 8 passed (4 specs on desktop and phone; the older-store spec and its phone skip are gone), 20.2 min |

Limits: this is a source integration test against the pinned Commerce Registry build. It does not prove a Registry install, a payment or a deployment.
