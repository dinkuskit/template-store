# Template Store #34 GrillTrack proposal

This is a proposal record only. No decision in this file or in the ledger is
marked decided. The five proposed entries are `template-products-link-013`,
`template-products-collections-014`, `template-redirects-015`,
`template-seo-demo-016`, and `template-unlinked-017`.

Questions for Ryan:

1. Confirm `commerceItemId` as the exact required field and whether drafts may
   omit it.
2. Confirm whether duplicate published links are rejected at publish time or
   flagged/excluded, including concurrent publishes.
3. Confirm 404 behavior for unlinked, unpublished, unpriced, and non-listable
   Commerce items.
4. Confirm when legacy and slash redirects may change from 302 to 301 and who
   verifies them.
5. Confirm the demo-host noindex setting mechanism and default.
6. Confirm whether collections need a product-reference field shape beyond a
   required slug/title contract.

Conservative implementation assumptions used pending those answers:

- The host owns page selection and fails closed on duplicate or invalid
  published links; there is no draft fallback or invented URL.
- `products` owns a required `commerceItemId`; `collections` owns flat
  slashless slugs; product URLs remain flat.
- Legacy and slash redirects are `302` with `Cache-Control: no-store` until
  verified for a later `301`.
- The starter is indexable by default; demo noindex is explicit.

The requested issue comment could not be posted because the available GitHub
token returned HTTP 403 (`Resource not accessible by personal access token`).
The same questions are retained here and in the PR description.

