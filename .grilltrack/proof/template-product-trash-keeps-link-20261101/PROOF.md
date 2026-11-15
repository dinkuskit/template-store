# template-product-trash-keeps-link-20261101

Implemented by dinkuskit/template-store#191 (saarius), merged as 146f3128dd67d50d74c59028e3e5c854a5214bfb from head d2f2a0cf16039339f4016c2b59d24c742c25b3ca.

## What the code does

- `src/features/product-on-sale/index.ts`: moving a product page to the trash sends set-on-sale with `onSale: false` and no `deleted` flag, so Commerce keeps the page link. A restored page is a draft and stays off sale until it is published.
- A successful `DELETE /_emdash/api/content/products/:id/permanent` sends set-on-sale with `deleted: true` for the canonical page id EmDash returns, after re-reading the caller's permission. A refused or failed permanent delete releases nothing.

## Evidence

| Check | Head | Result |
|---|---|---|
| `pnpm verify:paired-product-on-sale` (Commerce v0.7.0 4c975824, plugin.mjs a630ca23 verified) | 8ec945a7075a695463e1661bcef6cbb483388598 | 9 passed, 1 skipped by design (phone run of the upgrade spec), 22.7 min; step 8 restores, republishes, trashes and permanently deletes |
| CI "Store verification" desktop and phone (`pnpm verify`), run 41279176554 | d2f2a0cf16039339f4016c2b59d24c742c25b3ca | success |
| ClawSweeper review | d2f2a0cf16039339f4016c2b59d24c742c25b3ca | ready, no findings |
| `tests/unit/product-trash-restore.test.ts` (10 cases) | d2f2a0cf16039339f4016c2b59d24c742c25b3ca | pass in CI |

`git diff 8ec945a d2f2a0c` is empty for `src/features/product-on-sale`, `tests/paired`, both unit test files and `scripts`, so the paired run covers the merged runtime.

Limits: source integration against the pinned Commerce Registry build, not a Registry installation, payment or deployment proof.
