# Final automatic feed repair cycle

Reviewed source: `16d0b201ee0f4f17c0167538e9eac8e03350675e`.
The four review checklist entries repeat two root causes; both are accepted
as `required_fix`.

1. The host copied media metadata into the Commerce product but never filled
   `content.imageUrls`, the field consumed by the XML/CSV builders. It now
   resolves primary/gallery ids through the existing `resolveCommerceImage`
   and EmDash media lookup. The approved runtime URL is preserved; relative
   URLs use the same site origin as the canonical page. Unapproved payload
   URLs, unreadable/non-image/unsafe media, and duplicate URLs are omitted.
2. The verifier inferred unavailable Commerce from the absence of discovered
   SKUs. It now accepts a well-formed empty XML/CSV 200 response independently
   of page composition, while retaining the 503 unavailable result, MIME
   checks, slash-twin rejection, and the existing no-product/no-route case.
   Malformed empty documents and server errors fail.

The focused image regression calls the real resolver and Commerce builders
with approved media records. It checks primary and gallery XML elements and
CSV columns, the canonical origin, runtime-approved CDN URLs, and unsafe
omission. The HTTP workflow regression exercises the real verifier against
healthy empty feeds, editorial-only and no-product pages, malformed XML/CSV,
wrong MIME, server errors, unavailable Commerce, and duplicate slash routes.

The final focused and full-suite results are recorded in `PROOF.md`.
Further review findings require coordinator adjudication after this second
automatic repair cycle; this record does not grant merge authority.
