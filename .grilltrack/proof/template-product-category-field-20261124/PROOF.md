# Standard product category field: proof

Builds the template part of `template-product-category-list-20261124`,
`template-product-category-field-20261124` and
`template-product-category-feeds-20261124`, which the owner approved on
24 Nov 2026.

| Requirement | Source | Passing case | Refused case | Where | Evidence |
| --- | --- | --- | --- | --- | --- |
| One field `product_category` on products, a bare Shopify id, empty = Uncategorized | field ledger entry | `aa-2-17` saves and reads back after a reload | `Hats` is refused: "does not match the required format" | local store, desktop and phone | `editor-desktop*.jpg`, `editor-phone*.jpg`; `tests/unit/product-schema-upgrade.test.ts` |
| An older store gains the field with no re-seed | template self-upgrade rule (`template-store-self-upgrade-20261028`) | a store made from `tests/fixtures/seed-before-product-categories.json` records `001`..`008` on its first request and shows the field empty | re-running keeps the owner's label and saved pick | local store; unit tests | `tests/unit/storefront-upgrades.test.ts`, `tests/unit/emdash-theme-composition.test.ts` |
| Shopify's list pinned at 2026-11 | list ledger entry | all 14,606 categories, each full name equal to Shopify's `categories.txt` line | unknown, malformed, empty and `__proto__` values read as Uncategorized | Node 24.22.0 | full check below; `tests/unit/product-category.test.ts` |
| Google id via Shopify's own map | feeds ledger entry | every one of the 14,528 Shopify rules gives the same Google id through the table (Hats `aa-2-17` -> 173, T-Shirts `aa-1-13-8` -> 212) | the 78 categories Shopify maps to nothing (Bundles, Cannabis Products) get no Google id, never their parent's | Node 24.22.0 | full check below |

## Full check against Shopify's files

Inputs, from tag `v2026-11` (commit `0b9ed7a4bdd4325aa7761c54ca25955fa70fc9db`):

- `dist/en/categories.txt`, sha256 `d856f85cd51803c0ffc3d70a45761055b8169e00d271ee0adbfc2248d106c7cb`
- `dist/en/integrations/all_mappings.json`, sha256 `301ad7c6a116589b1aab81234b061f7140c40288025491c21479fe35c87c6dde`

`node scripts/build-product-taxonomy.mjs categories.txt all_mappings.json`:

```
14606 categories, 14528 Google mappings (5612 kept), wrote src/features/product-category/taxonomy.json
```

Each line of `categories.txt` looked up with `lookupStandardCategory`, its
full name and Google id compared with the files:

```
{ checked: 14606, mismatches: 0, withoutGoogle: 78 }
```

## Screens

On a local store set up from the older seed and then started on this branch,
the Canvas Cap editor shows the new field last (`editor-desktop.jpg`,
`editor-phone.jpg`). Typing `Hats` is refused on save (`editor-desktop-refused.jpg`,
`editor-phone-refused.jpg`); `aa-2-17` saves and is still there after a reload
(`editor-desktop-saved.jpg`).

## Not in this change

The Commerce panel's box that suggests and searches categories, and the feeds
sending the category, need a Commerce release; they follow in a Commerce pull
request and a template pin bump.
