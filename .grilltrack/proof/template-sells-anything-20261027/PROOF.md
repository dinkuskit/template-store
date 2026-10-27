# Template sells anything (Grow Funky Beans migration issues)

Covers three locked ledger entries from the 27 Oct 2026 grill with Ronald:
`template-sells-anything-20261027` (#161), `template-rich-product-page-20261027`
(#163) and `template-cms-pages-and-redirects-20261027` (#162).

## What changed

- Products of any kind are published. `visual_label` is optional placeholder
  art for editorial previews only; an unknown value gives no art, never a
  dropped product. A product with no Commerce image and no art says "No image".
  Hard-coded apparel copy (footer and search shortcuts, the garment-care note)
  is now neutral; the playground's apparel stays as seed content.
- Product pages show Commerce's image and gallery as thumbnails, an optional
  rich `summary` in the buy box (the plain `description` stays the meta
  description and JSON-LD), and optional `details` sections below
  (`collapsible_section`, `spec_table`, `rich_text`).
- Existing stores: a skip re-seed never changes existing fields, so
  `ensureStorefrontProductFields` drops `visual_label`'s required flag, swaps
  only the old label, and adds `summary` and `details`;
  `ensureStorefrontPageAddresses` gives Pages `/{slug}` unless the owner set
  one. The field upgrade first makes the missing `collapsible_section` and
  `spec_table` block types (skip on conflict), so `pnpm search:upgrade` needs
  no re-seed. Search support runs before the new fields, so a store that never
  had search still gets its default searchable fields and the new `summary`
  joins the index.
- The public boundary lets plain GET/HEAD addresses reach the site and drops
  the "admin"/"setup" word bans; EmDash's real admin, setup, auth and schema
  paths, dev-bypass, /api/proof, traversal and encoding checks, the /_emdash
  and /api allowlists and the method rules are unchanged. A `/[slug]` page
  shows published Pages entries. The seed adds 301 pattern redirects
  `/product/[slug]` -> `/products/[slug]` and `/product-category/[slug]` ->
  `/categories/[slug]`; the Worker drops a trailing slash first.

## Executed verification (cloud container, Node 24.22.0)

- `pnpm -s typecheck`: 0 errors.
- `pnpm -s test`: 58 files, 535 tests passed.
- `bin/verify-web browser` (build + Playwright, desktop and mobile): 79 passed,
  7 skipped (opt-in), 0 failed. Includes the new
  `product-page-content.spec.ts` (summary, sections, spec rows, three Commerce
  pictures as thumbnails, "No image") and `cms-pages-and-redirects.spec.ts`
  (draft page 404, published page at `/<slug>`, "Page not found",
  `/product/everyday-tee` and `/product-category/tees` redirects).
- `ASTRO_ADAPTER=cloudflare astro build` then `CLOUDFLARE_E2E=1` real Wrangler
  `cloudflare-checkout-return.spec.ts`: passed, including the new
  `/product/everyday-tee/` and `/about-us/` 301s.
- `./scripts/grilltrack validate`: valid.

## Review fixes (second head)

- `pnpm -s test`: 58 files, 536 tests passed. The upgrade tests now run on the
  older fixture with no re-seed and compare every saved product column; a new
  test runs `scripts/upgrade-storefront-search.ts` alone on an on-disk older
  store and checks fields, block types, saved values and search, including a
  new `summary`.
- The product frame styles reach `ProductGallery`'s stage; the gallery
  browser test checks its border, clipping and shadow (it fails on the old
  scoped rules). `product-page-content.spec.ts` and
  `cms-pages-and-redirects.spec.ts`, desktop and mobile: 10 passed.
- `pnpm audit:features`: ok (CI's "explicit any" came from the word in a comment).
