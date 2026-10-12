# Registry merchant TEST checkout integration

## Source and boundary

Template consumes Commerce PR106 candidate `c3fdf5749993d044829c6571c09565ba95199f74`
on template base `47f78977eb35db1cdcf05c85a1778ce3a49b7393`.
This is local candidate integration, not Registry publication or hosted payment proof.
The source pin does not install a plugin. A promoted deployment still needs the
matching reviewed Registry package, merchant TEST configuration, service grants,
and operating reconciliation scheduler. No deployment or provider call occurred.

The cart and both middleware branches query `checkout/guest/readiness` through
the original installed `r_gshdrqaldna3r7sn` public dispatcher used by catalog reads.
Only the exact supported TEST schema admits checkout. Missing or rejected
configuration stays closed. Native-development catalogs cannot pair with Registry
checkout. Anonymous pages need only EmDash's public dispatcher; optional full-runtime
metadata is also validated when available. Browser credentials are not forwarded.
Commerce retains pricing, store-key exchange, binding validation and order writes.

## Immutable local package inputs

- npm archive SHA256: `13e0531ea36cf67267f7aa98782a644e2ee1d231886e16be4cec252cd01636ba`.
- Registry archive SHA256: `f870b1eafc868ccfa832cb682d3bbeeee8027696cdad7fc02d8ab33de2bf9339`.
- Route manifest SHA256: `50b51ecc45896e4caa7bd74564c93a61ff6a1f90e91a9e81b0de5b7fa6f226e5`.
- Compiled backend SHA256: `8f3f771cb713044f1d6e638df1363bbe91e8da36ac4d778741ee8cf157752f81`, 129442 bytes.

The focused fixture checks all input hashes before loading the compiled backend
into EmDash's workerd runner. The same anonymous dispatcher serves the template
catalog reader and readiness acquisition. SDK storage holds disposable catalog
and configuration fixtures. Guest prepare/start/status create the canonical
order; repeated start uses one payment session and status replay retains one
order. No paid orders are seeded. All service/DNS traffic is intercepted; only
local runner communication is permitted. Process-only signing material is synthetic.
This does not establish a signed Registry installation or a real merchant purchase.

## Verification

Node `22.23.2`, EmDash `1.2.0`.

- `pnpm verify`: passed. 243 Vitest tests, 39 Node workflow tests; production build;
  desktop/mobile Playwright: 33 passed, 9 existing scoped skips. The site crawler
  passed with 0 failures and 4 expected skips (empty local sitemap and separately
  owned product-data/feed checks).
- `pnpm verify:merchant-checkout` with `COMMERCE_READINESS_ARTIFACT_DIR` supplied:
  required compiled local candidate check; digest and canonical settlement tests pass.
  Without that input the dedicated command fails; ordinary CI workflow tests report
  a real skip rather than claiming that absent artifacts passed.
- Focused parent tests cover anonymous dispatcher-only admission, native catalog
  rejection, metadata failure, strict response shapes and both middleware branches.
- Desktop/mobile default closed-cart screenshots were inspected. Enabled hosted
  checkout and live admin/order presentation remain parent-owned proof.

Raw local logs: `runs/registry-merchant-checkout-20261012/verify-parent.log`,
`compiled-parent.log`, `focused-parent.log`, and `typecheck-parent.log`.

## Review dispositions

Parent review accepted and fixed:

1. Anonymous EmDash runtime lacks metadata methods: remove the unconditional method
   call while retaining the original public dispatcher and optional metadata checks.
2. Native-development catalog could pair with Registry readiness: reject that
   profile before dispatch.
3. Fixture used a machine-specific path and false pass on missing input: require
   an explicit artifact directory for the dedicated check and report scoped skips.

PR80's seven owned files and all Ship PR27 files remain untouched. Source changes
use the existing guest cart component's admission prop. External exact-head
OpenClaw/native ClawSweeper review is a separate delivery gate, recorded on the PR
and in the local run proof; local checks do not imply that clearance.

## PR81 verification-only CI follow-up

The owner requested checks without deployment or merge. CI now excludes PRs
labeled `verification-only` from playground deployment and closed-PR preview
cleanup while retaining workflow validation, store verification, and playground
build. PR81 received that label before this follow-up was pushed.

Local checks: three workflow policy tests passed, including labeled open/sync/
reopen/close events, fork and disabled-variable boundaries, and unchanged main
push behavior. Actionlint and `git diff --check` passed. Remote terminal results
are recorded in the ignored run proof after the pushed revision completes.
