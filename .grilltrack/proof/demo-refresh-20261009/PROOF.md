# Demo storefront refresh proof, 2026-10-09

## Scope

TemplateStore source refinement from main
`50e7ec686db119e43a8b3921cd94f5227903160d`. The Commerce source pin remains
`938cb06cc6c0a1e7f457e514076d608219e38c65`; EmDash remains `1.2.0`.
CMS-owned composition and catalog authority are unchanged. The public demo
banner remains explicit about synthetic data and unavailable purchases.

The candidate adds catalog-state guidance, improves warm-neutral card/media
hierarchy and long-name wrapping, and replaces the misleading local-proof
header label. No new product/media/price/stock fallback, checkout activation,
provider traffic, production write, deployment or permissions change occurs.

## Baseline

Read-only inspection of `https://demo.dinkuskit.com` observed three synthetic
products, old `/shop/id` links, a closed cart checkout and the stale header.
HTTP returned 200 from Cloudflare. No deployed revision marker was observed;
source host configuration is not proof of the installed live artifact.
Current site-verifier baseline failed `/home` redirection and `/sitemap.xml`
availability. Do not call a source merge a deployment.

## Verification

- Node `22.23.2`; frozen dependency install: passed. The initial environment
  resolved Node24 and was repaired with a verified workspace-local official
  Node archive; no engine bypass.
- Final `pnpm verify`: passed. Astro check: zero errors/warnings; 173 unit tests
  in 25 files; 28 workflow tests; source/feature/text audits; Astro build;
  25 browser tests and 3 explicit skips. The skips cover desktop-only built
  fallback and the retired legacy editor; native Blocks have their own proof.
- Local public-route verifier: zero failures, four explicit skips on the empty
  preview database. Product data/feeds remain scoped to #35. A preview/live
  database with published content still needs full sitemap and route evidence.
- Cloudflare compile using shipping profile and ignored local D1 config into
  a fresh output directory: passed, with the existing large-chunk warning.
  This is compile proof only, not an installed or hosted artifact claim.
- GrillTrack CLI validation and `git diff --check`: passed. Existing ledger
  locks were retained; no ledger closure or new product decision was asserted.

The first full browser run had one invalid added test assumption that the
shared catalog was globally empty. Earlier tests left a priced product there;
the storefront correctly showed ready. That assertion was removed, and the
entire final verifier passed. No product behavior was changed to satisfy it.

## Browser evidence and boundaries

Parent verification exercised desktop Chromium and Pixel7 mobile, persisted
Commerce Regular/Sale and manual availability, cart add/quantity/reload/remove,
recoverable errors, disabled checkout, forged returns, CMS/native Blocks,
managed `8 -> 5 -> 8` regression and no-quantity unmanaged status cycles.

Independent browser interaction also added a real local Commerce product,
changed quantity to two, reloaded, removed it and observed disabled checkout.
Empty guidance showed zero products/add controls. Shipping without an installed
catalog showed unavailable guidance and zero invented products/add controls.
The shared in-app browser's viewport override did not reliably match requested
CSS widths; those captures are not mobile acceptance. Pixel7 acceptance and
screenshots come from the isolated canonical Chromium test contexts.

Sanitized desktop/mobile shopper screenshots, baseline captures, command logs,
and hashes stay ignored under `runs/`; no credential or customer data is
included. Catalog/media proof is local native-development. The shipping tests
prove fail-closed behavior when installation is absent, not installation.
Synthetic controller tests are not a payment or order qualification.

## Review and cutover gates

The PR requires current CI, comprehensive exact-source OpenClaw and native
ClawSweeper findings adjudication. Review receipts belong to the exact PR head.
The deployment/rollback plan is `docs/deployment/demo-refresh-plan.md`.

WAITING_FOR_HUMAN for merge/deploy. Deployment also requires the current live
Worker revision/rollback target, compatible immutable installed Commerce
identity/digest, real shipping preview, protected admin, preserved CMS/catalog
state and public route checks. The committed Wrangler proof profile needs
explicit shipping qualification; no flag or source alias may bypass it.
Payments and Ship are not represented as available public capabilities.
