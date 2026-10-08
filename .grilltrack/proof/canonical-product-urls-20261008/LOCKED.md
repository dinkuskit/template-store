# Template Store #34 locked decisions

Ryan locked these decisions in [issue #34 comment 6067384558](https://github.com/dinkuskit/template-store/issues/34#issuecomment-6067384558) on 2026-10-08. The append-only ledger records successors `template-product-url-migration-023` through `template-product-url-pages-030`; the earlier `template-*-018` through `022` entries are superseded in history.

- `products` link through `commerce_item_id`; publication requires a non-empty value no longer than 1,024 characters. This implementation documents that installed hook lookup is not reachable and uses format plus atomic claim, with Commerce state enforced at render.
- Native `dinkus-commerce` is the canonical Commerce plugin ID for this catalog consumer; the registry ID is legacy.
- `content:beforePublish` atomically claims `itemId → entryId` in plugin storage with a unique `itemId` index. Duplicate publishes are cancelled with the live URL; unpublish/delete release only the holder. Seeded unclaimed duplicates are excluded and flagged.
- `categories` is a content type at `/categories/{slug}` with multi-select product references, empty-category support, a seed-created-if-missing EmDash menu, and first-category breadcrumbs. `pages` is unchanged.
- `/shop` and old collection-digest routes are removed and return 404. Astro slash and EmDash slug-edit 301s, plus `/home` 302, are accepted upstream exceptions.
- Sites are noindex by default and require explicit launch opt-in; Node and Cloudflare emit `X-Robots-Tag`.
- Commerce null drift is 404 and verifier-failing, lookup errors are 503, and out-of-stock remains 200 with purchasing disabled.
- Existing `merchandise` databases intentionally fail closed. No template-store sites accept real orders; the manual path is reseed or re-bootstrap, as documented in the upgrade docs.

The attached decision text includes the EmDash 1.2.0 source citations for schema slugs, SEO sitemap behavior, hook cancellation/concurrency, seed hook bypass, built-in redirects, unique-index behavior, and taxonomy limitations.
