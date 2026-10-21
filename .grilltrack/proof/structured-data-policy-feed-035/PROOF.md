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

## Current policy validation repair

[POLICY-VALIDATION-REPAIR.md](POLICY-VALIDATION-REPAIR.md) accepts the optional-field
validation finding against `7e278d7fcd8434eceb9685ca0d0a33bf92291572` and explains
the bounded fix. The malformed-projection reproduction failed 23 cases before
the fix. The consumer now reuses Commerce money validation and checks the
remaining public policy field shapes before either page text or JSON-LD can
consume them. Null policies and valid omitted optionals remain supported.
The native fallback is retained and validated through the same decoder.

Current verification:

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

 The prior full-suite and targeted
results above remain attributed to their own source revisions; they are not
claimed as full-suite results for this repair. Fresh final-head CI/review is
still required.

This is exact source/local proof. It does not establish a Registry install,
deployment, publication, checkout, or Google/Meta channel-account connection.
