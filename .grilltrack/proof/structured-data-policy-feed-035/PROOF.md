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

## Prior final automatic repair cycle: `a2138c73cfe9f6016c700186f093bc0c6af6d6e6`

[FEED-REPAIR-2.md](FEED-REPAIR-2.md) accepts the two distinct feed findings
against `16d0b201ee0f4f17c0167538e9eac8e03350675e`. That committed repair used
Commerce `288199275f61aec084c0e1e72b370ec74ea35369`.
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
Both desktop and mobile profiles ran. These results belong to commit
`a2138c73cfe9f6016c700186f093bc0c6af6d6e6`; they are retained as historical
evidence after the owner-approved verifier follow-up below.

Final feature/text audits and `git diff --check` also passed after proof
updates. Log:
`runs/structured-data-policy-feed-035-runs/feed-repair-final-source-checks.log`.

Further findings require coordinator adjudication after this second automatic
repair cycle. Fresh CI and both required reviews must cover the final commit;
local verification does not replace those promotion gates.

## Prior owner-approved verifier follow-up: d05e4adb47032b3d621258919022f10ba6bf4352

[VERIFIER-OWNER-REPAIR.md](VERIFIER-OWNER-REPAIR.md) records the two accepted
findings on `a2138c73cfe9f6016c700186f093bc0c6af6d6e6` and the owner-approved
exception for one additional bounded pass. This does not reset the automatic
repair cap. Changes are limited to the public verifier, focused HTTP tests,
and its development parser dependencies.

- `sax` 1.6.1 performs strict XML parsing and the verifier checks the expected
  RSS/channel/item envelope. `csv-parse` 6.1.0 parses quoting/newlines and rejects
  inconsistent row lengths; the verifier checks the exact Commerce header.
  The same document check runs with and without discovered linked products,
  including empty opted-out feeds. Discovery does not imply channel eligibility.
- `entities` 6.0.1 decodes the HTML attribute value before SKU comparison.
  Named, decimal/hex numeric, quoted, and apostrophe-containing values match
  their JSON-LD value. A genuine mismatch still fails.
- SAX and entities were already in the dependency tree; all three are now
  direct exact-pinned development dependencies used by the verifier only.
  Commerce and storefront runtime source are unchanged.
- `node --test tests/workflows/verify-site-crawl.test.mjs` recorded 18 passed
  and 13 failed before repair. Log:
  `runs/structured-data-policy-feed-035-runs/owner-pass-before.log`.
  These include malformed linked feeds, escaped SKU values, valid undiscovered
  feeds, and the expected decoded text in the true-mismatch diagnostic.
- The same command passed all 31 tests after repair. Sixteen new HTTP scenarios
  use the actual prepared Commerce builders for valid populated/empty output,
  including quotes, commas, newlines, and XML-escaped text. Existing absent
  Commerce, wrong MIME, server error, slash twin, and route checks still pass.
  Log: `runs/structured-data-policy-feed-035-runs/owner-pass-after.log`.

The single required full `pnpm verify` (`bin/verify-web full`) passed on the
frozen runtime/test source: 384 unit tests, 97 workflow tests (2 explicit skips),
63 browser tests (9 explicit skips), typecheck (0 errors, 0 warnings, 2 existing
hints), feature/text audits, and the build. Both desktop and mobile profiles
ran. The final `verify-site` passed with 0 failures, 2 intentional sitemap
skips, and 26 URLs checked; the absent-Commerce feeds remained 503. Log:
`runs/structured-data-policy-feed-035-runs/owner-pass-pnpm-verify.log`.

`source-manifest.sha256` identifies 21 source/test/package files for this
follow-up, including the exact dependency lockfile. Final feature/text audits,
manifest verification, GrillTrack validation, and `git diff --check` passed.
Final source-check log:
`runs/structured-data-policy-feed-035-runs/owner-pass-final-source-checks.log`.

Runtime and tests stayed frozen for the full run; subsequent edits are proof
and CLI ledger records. Fresh final-head CI and required reviews remain with
the coordinator. This owner-approved pass is complete; any further finding
returns for adjudication instead of another automatic repair.

## Selected variant metadata repair

VARIANT-REPAIR.md accepts the selected-member contradiction on
d05e4adb47032b3d621258919022f10ba6bf4352. The prior tests deliberately retained
56.00 metadata after the visible price became $60; they now require agreement.
The server prepares each public member's Product with Commerce's builder.
The picker replaces the sole Product script via textContent and updates the
visible availability attribute. The initial SSR block, published/2xx gating,
canonical URL, supplied public identity, and policy facts remain intact.
The extra application/json lookup uses the existing script-safe serializer;
the browser selects a prepared block rather than assembling an Offer.

Targeted verification:

- The updated product-page test failed before repair on the expected
  60.00 versus actual 56.00 Offer. Log:
  runs/structured-data-policy-feed-035-runs/variant-before.log.
  Its trace and error context remain under variant-before-artifacts/.
- The first post-fix run passed both product-page viewport checks but failed
  both policy/feed tests before variant selection: the test tried to locate a
  child SKU through the parent-only admin list. It now reads the actual public
  member id from the Medium control. The failure log remains at
  runs/structured-data-policy-feed-035-runs/variant-after.log, with traces under
  variant-fixture-failure/. This was a fixture issue, not a passing behavior claim.
- The corrected command, pnpm exec playwright test tests/e2e/product-pages.spec.ts
  tests/e2e/structured-data-policy-feed.spec.ts --project=chromium-desktop
  --project=chromium-mobile, passed all 4 tests. Log:
  runs/structured-data-policy-feed-035-runs/variant-after-rerun.log.
  It proves the selected $60 OutOfStock Offer, visible availability, public SKU
  and canonical agreement, one Product script, Small reset, and reload default.
  The temporary Medium availability mutation is restored in finally.
- pnpm typecheck passed with 0 errors, 0 warnings, and 2 existing hints. Log:
  runs/structured-data-policy-feed-035-runs/variant-typecheck.log.

The single full pnpm verify run passed on the frozen runtime/test source:
384 unit tests, 97 workflow tests (2 explicit skips), 63 browser tests
(9 explicit skips), typecheck, build, and feature/text audits. Final verify-site
passed with 0 failures, 2 intentional sitemap skips, and 26 URLs checked; absent
Commerce feeds still returned 503. Log:
runs/structured-data-policy-feed-035-runs/variant-pnpm-verify.log.

The current source-manifest.sha256 covers 22 source/test/package files.
Final hash verification, source/text audits, git diff --check, and GrillTrack
validation passed. Log:
runs/structured-data-policy-feed-035-runs/variant-final-source-checks.log.
Runtime and tests were unchanged throughout the full run; only proof and CLI
ledger records followed it. Fresh exact-head reviews remain with the coordinator.

This is exact source/local proof. It does not establish a Registry install,
deployment, publication, checkout, or Google/Meta channel-account connection.
