# Registry merchant TEST checkout

Template admission reads `GET checkout/guest/readiness` through the same
`r_gshdrqaldna3r7sn` public dispatcher used by the installed catalog. Only the
exact `dinkuskit.commerce.checkout-readiness/v1` supported response with
`mode: test` enables new cart checkout and the prepare route. Existing capabilities reach
start/status without consulting the cached readiness answer; Commerce validates
those requests against current configuration and payment binding.
Unknown responses, missing plugins, rejected dispatch, and native-development
catalogs stay closed. Anonymous EmDash pages use their public-only dispatcher;
optional full-runtime route metadata is checked when available.

Readiness is advisory. Commerce retains catalog prices, merchant settings,
store-key exchange, payment binding checks, attempts, reconciliation and orders.
Template forwards no browser credentials to the readiness request and adds no
price or order writer. Start/status revalidate inside Commerce independently of readiness.
The cart response is not cached. Existing recovery keeps the original attempt.

## Candidate and deployment boundary

The source pin is merged Commerce 0.2.0 release commit
`f37c9d83a102f7219cd8406986d01d001668c29c`. The frozen local package has the
same source tree as reviewed PR107 head `2b6fe113746db3a5ff7e4345860c5ebadd466c48`.
Package and backend identities are recorded in the
[pairing proof](../../.grilltrack/proof/commerce-020-pairing-20261012/PROOF.md).
These are local qualification artifacts; their digests do not establish a
published Registry release.
This source pin does not install a Registry plugin. A deployment needs the
reviewed matching Registry artifact, the supported merchant TEST configuration
and store key inside Commerce, approved service grants and an operating
reconciliation scheduler. Old installed plugins without readiness remain closed.
No template environment variable or browser flag grants readiness.

Publication, deployment, account/service changes and real provider operations
remain separate human gates. Hosted Stripe purchase and Commerce admin/order
proof are still required; local fixtures do not establish either.

## Local verification

`pnpm verify` exercises the standard local suites. Set
`COMMERCE_READINESS_ARTIFACT_DIR` to the frozen owner-supplied artifact directory
and run `pnpm verify:merchant-checkout` for the required compiled candidate check.
The dedicated command refuses absent input; ordinary workflow tests report an
explicit skip when no candidate directory is supplied. Every archive digest is
checked before execution. The fixture uses disposable SDK storage, process-only
synthetic signing material and intercepted service/DNS transport, permitting
only the local workerd communication. It reads the real compiled catalog and
readiness handlers, then prepares, retries and settles one canonical order.

### Verification-only pull requests

Apply the `verification-only` label before pushing a PR that must run checks
without Cloudflare changes. CI still runs workflow validation, store verification,
and the playground build. Both playground deployment and closed-PR preview
cleanup skip labeled PRs. Keep the label on PR81 through review; removing it
allows the existing preview policy on a subsequent PR event. The label does not
change the main-branch deployment policy.
