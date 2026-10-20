# Issue 35 proof

Commerce source is prepared from the public repository at exact commit
`c61d63647b3eb7f990d935f170dd93eb6d1c56dd` (`@dinkuskit/commerce` `0.3.0`).
The source-preparation log is retained in
`runs/issue35-runs/finish-prepare-sources.log`.

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
  technical revision row. Known return methods and fee enums render as shopper
  language without inventing policy facts.

## Commands and logs

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
- Final `pnpm verify` (`bin/verify-web full`) — 356 unit tests, 72 workflow
  tests, 63 browser tests, 9 explicit skips; `verify-site` passed with 2
  intentional sitemap skips. Log:
  `runs/issue35-runs/finish-pnpm-verify-final.log`.
- The first final-gate attempt is retained at
  `runs/issue35-runs/finish-pnpm-verify.log`; it failed only on the stale
  expected source pin, which was updated before the passing final run.

This is exact source/local proof. It does not establish a Registry install,
deployment, publication, checkout, or Google/Meta channel-account connection.
