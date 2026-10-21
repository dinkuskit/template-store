# Issue 35 proof

Commerce source is prepared from the public repository at exact commit
`288199275f61aec084c0e1e72b370ec74ea35369` (`@dinkuskit/commerce` `0.3.0`).
The source-preparation log is retained in
`runs/structured-data-policy-feed-035-runs/pin-label-prepare-sources.log`.

Commerce’s catalog-backed `buildProductJsonLd` already emits SKU, optional GTIN/MPN/brand, authoritative price/availability, and an Offer when a Commerce price is present; the page-facts-only limitation applies solely to the editorial preview helper.

## Verified contract

- Linked products use Commerce `buildProductJsonLd`, preserving Commerce SKU,
  identifiers, price, availability, Offer URL, and policy facts.
- Valid published editorial/unlinked pages use
  `buildProductPreviewJsonLd` and emit exactly one Product containing the
  canonical URL and visible title/description/image only; they emit no SKU or
  Offer.
- 404, removed, and 503 unavailable product routes emit no Product.
- Installed public feed parsing carries real `feedChannels`; missing and empty
  channel arrays remain excluded. Native-development storage eligibility stays
  explicitly isolated.
- Shipping and returns retain revision metadata for proof while hiding the
  technical revision row. All three known return categories, return methods, and fee enums render as
  shopper language without inventing policy facts. Category data attributes
  retain the original Commerce enums.

## Earlier full-suite baseline

These results belong to Template Store source
`db5601dce3456ee228153264a4acad1a74fe199b`, using Commerce
`c61d63647b3eb7f990d935f170dd93eb6d1c56dd`. They are retained as historical
verification, not reported as a full-suite run of the current follow-up.

### Commands and logs

- `corepack pnpm typecheck` — pass, log:
  `runs/issue35-runs/finish-typecheck.log`
- Focused structured-data, feed, and policy units — pass, log:
  `runs/issue35-runs/finish-focused-unit.log`
- `node --test tests/workflows/verify-site-crawl.test.mjs` — 6 passed, log:
  `runs/issue35-runs/finish-verify-site-crawl.log`
- Desktop/mobile structured-data/policy/feed browser proof — 2 passed, log:
  `runs/issue35-runs/finish-playwright-structured.log`
- Desktop/mobile shipping browser proof — initial run exposed and fixed the
  editorial-preview/catalog-unavailable condition; the passing rerun had 2
  passed, log: `runs/issue35-runs/finish-playwright-shipping-rerun.log`.
  Initial failure is retained at
  `runs/issue35-runs/finish-playwright-shipping.log`.
- Baseline `pnpm verify` (`bin/verify-web full`) — 356 unit tests, 72 workflow
  tests, 63 browser tests, 9 explicit skips; `verify-site` passed with 2
  intentional sitemap skips. Log:
  `runs/issue35-runs/finish-pnpm-verify-final.log`.
- The first final-gate attempt is retained at
  `runs/issue35-runs/finish-pnpm-verify.log`; it failed only on the stale
  expected source pin, which was updated before the passing final run.

## Prior targeted follow-up: `7e278d7fcd8434eceb9685ca0d0a33bf92291572`

That follow-up updated the active Commerce pin/provenance, explicitly
labels all three return categories, and gates Product JSON-LD on a successful
HTTP response. It preserves the native eligibility fallback and response-status
assignments. [COMMERCE-EQUIVALENCE.md](COMMERCE-EQUIVALENCE.md) records the empty
runtime/package source diff between the old and new Commerce pins.
[STATUS-GATE-REPAIR.md](STATUS-GATE-REPAIR.md) records the accepted 404 metadata
finding and bounded fix. `source-manifest.sha256` identifies the current changed
source content.

- Source preparation checked out Commerce
  `288199275f61aec084c0e1e72b370ec74ea35369` exactly.
- `pnpm typecheck` passed: 0 errors, 0 warnings, 2 existing deprecation hints.
  Log: `runs/structured-data-policy-feed-035-runs/final-typecheck.log`.
- `pnpm exec vitest run tests/unit/structured-data-policy.test.ts tests/unit/commerce-policies.test.ts tests/unit/commerce-feeds.test.ts tests/unit/managed-product-availability.test.ts tests/unit/unmanaged-product-sellability.test.ts`
  passed 16 tests in 5 files. Includes the 200/redirect/404/410/500/503 metadata
  status policy. Log: `runs/structured-data-policy-feed-035-runs/final-units.log`.
- `node scripts/check-features.mjs`, `node scripts/check-worktree-text.mjs`, and
  `git diff --check` passed. Log:
  `runs/structured-data-policy-feed-035-runs/final-source-checks.log`.
- `pnpm exec playwright test tests/e2e/structured-data-policy-feed.spec.ts tests/e2e/shipping-storefront-profile.spec.ts --project=chromium-desktop --project=chromium-mobile --project=shipping-chromium-desktop --project=shipping-chromium-mobile`
  passed all 4 tests. The checks exercise the three category labels and their
  unchanged data attributes, successful editorial previews, and missing/error
  routes with no Product metadata. Log:
  `runs/structured-data-policy-feed-035-runs/final-browser.log`.
- Visually inspected all three category screenshots on desktop and mobile.
  Text remains legible and within the page. Images stay ignored at
  `runs/structured-data-policy-feed-035-runs/final-browser/`; shipping captures
  stay at `runs/structured-data-policy-feed-035-runs/final-shipping-browser/`.

The initial status-gate typecheck found that Astro's unset response status is
optional; the gate now treats it as the default HTTP 200. That failed log is
retained at `runs/structured-data-policy-feed-035-runs/status-gate-initial-typecheck.log`.
The earlier label-only browser run also passed both viewport tests before the
metadata finding; it is superseded by the four-test run above.

The full suite was not rerun for this follow-up. Fresh PR CI must cover the final
head; the historical full-suite result above is not substituted for that gate.

## Prior policy validation repair: `16d0b201ee0f4f17c0167538e9eac8e03350675e`

[POLICY-VALIDATION-REPAIR.md](POLICY-VALIDATION-REPAIR.md) accepts the optional-field
validation finding against `7e278d7fcd8434eceb9685ca0d0a33bf92291572` and explains
the bounded fix. The malformed-projection reproduction failed 23 cases before
the fix. The consumer now reuses Commerce money validation and checks the
remaining public policy field shapes before either page text or JSON-LD can
consume them. Null policies and valid omitted optionals remain supported.
The native fallback is retained and validated through the same decoder.

Verification for that policy repair:

- Before repair, `pnpm exec vitest run tests/unit/commerce-policies.test.ts`
  reproduced 23 failures. Log:
  `runs/structured-data-policy-feed-035-runs/policy-validation-before.log`.
- After repair, `pnpm exec vitest run tests/unit/commerce-policies.test.ts tests/unit/structured-data-policy.test.ts tests/unit/commerce-feeds.test.ts`
  passed 35 tests in 3 files. Log:
  `runs/structured-data-policy-feed-035-runs/policy-validation-after.log`.
- `pnpm typecheck` passed with 0 errors, 0 warnings, and 2 existing hints.
  Log: `runs/structured-data-policy-feed-035-runs/policy-validation-typecheck.log`.
- Feature/text audits and `git diff --check` passed. Log:
  `runs/structured-data-policy-feed-035-runs/policy-validation-source-checks.log`.
- The structured-data/policy/feed and shipping-profile Playwright specs passed
  all 4 desktop/mobile tests on the repaired source. Log:
  `runs/structured-data-policy-feed-035-runs/policy-validation-browser.log`.
  Command: `pnpm exec playwright test tests/e2e/structured-data-policy-feed.spec.ts tests/e2e/shipping-storefront-profile.spec.ts --project=chromium-desktop --project=chromium-mobile --project=shipping-chromium-desktop --project=shipping-chromium-mobile`.

The prior full-suite and targeted results above remain attributed to their
own source revisions. They are not substituted for final-head CI/review.

## Final automatic repair cycle: feed media and empty catalogs

[FEED-REPAIR-2.md](FEED-REPAIR-2.md) accepts the two distinct feed findings
against `16d0b201ee0f4f17c0167538e9eac8e03350675e`. The source manifest binds
this repair to Commerce `288199275f61aec084c0e1e72b370ec74ea35369`.
Primary/gallery media now enter the existing Commerce XML/CSV builders through
`content.imageUrls`, after the same approved media resolution used by product
images. The verifier accepts the exact empty XML/CSV documents emitted by the
pinned builders for healthy empty or editorial-only catalogs. It retains the
503 unavailable path, MIME/canonical checks, and slash-twin rejection; corrupt
empty responses and server errors fail.

Focused verification on this repair:

- `pnpm exec vitest run tests/unit/commerce-feeds.test.ts` reproduced both new
  image regressions before the fix: 2 failed, 2 passed. Log:
  `runs/structured-data-policy-feed-035-runs/feed-images-before.log`.
- `pnpm exec vitest run tests/unit/commerce-feeds.test.ts tests/unit/commerce-catalog-media.test.ts`
  passed 6 tests. These use the real resolver and feed builders to prove
  primary/gallery XML and CSV fields, canonical origin, approved CDN origin,
  deduplication, and unsafe/unapproved omissions. Log:
  `runs/structured-data-policy-feed-035-runs/feed-images-after.log`.
- `node --test tests/workflows/verify-site-crawl.test.mjs` passed all 15 tests,
  including 9 new real-HTTP verifier scenarios. Log:
  `runs/structured-data-policy-feed-035-runs/empty-feeds-after.log`.
  The initial workflow run had 3 failures and an incomplete sitemap fixture;
  that fixture was corrected before the passing run. Its output is retained
  at `runs/structured-data-policy-feed-035-runs/empty-feeds-before.log` and is
  not treated as an isolated reproduction of the product bug.
- `pnpm typecheck` passed with 0 errors, 0 warnings, and 2 existing hints. Log:
  `runs/structured-data-policy-feed-035-runs/feed-repair-typecheck.log`.
- `pnpm exec playwright test tests/e2e/structured-data-policy-feed.spec.ts tests/e2e/shipping-storefront-profile.spec.ts --project=chromium-desktop --project=chromium-mobile --project=shipping-chromium-desktop --project=shipping-chromium-mobile`
  passed all 4 tests. Log:
  `runs/structured-data-policy-feed-035-runs/feed-repair-browser.log`.

The required full `pnpm verify` (`bin/verify-web full`) then passed on the
same repair source: 384 unit tests, 81 workflow tests (2 explicit skips), 63
browser tests (9 explicit skips), typecheck, feature/text audits, and the build.
The final `verify-site` checked 26 URLs with no failures and 2 intentional
sitemap skips; its absent-Commerce feeds returned 503 as expected. Log:
`runs/structured-data-policy-feed-035-runs/feed-repair-pnpm-verify.log`.
Both desktop and mobile profiles ran. The source manifest identifies the
runtime and test bytes used for this full run; later changes are proof and
CLI ledger records only.

Final feature/text audits and `git diff --check` also passed after proof
updates. Log:
`runs/structured-data-policy-feed-035-runs/feed-repair-final-source-checks.log`.

Further findings require coordinator adjudication after this second automatic
repair cycle. Fresh CI and both required reviews must cover the final commit;
local verification does not replace those promotion gates.

This is exact source/local proof. It does not establish a Registry install,
deployment, publication, checkout, or Google/Meta channel-account connection.
