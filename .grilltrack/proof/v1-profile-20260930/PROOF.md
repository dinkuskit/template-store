# Inventory-off profile preparation proof

Status: local profile candidate verified; immutable source identity recorded at review.
This is EmDash 0.41.0 native source-pilot evidence, not a registry-installed,
released or purchasable store claim.

## Source and ownership

Repository: `dinkuskit/template-store`.
Branch: `codex/template-store-v1-release-20260930`.
Base: `97d4ebfa6b31bcc00f3a3b8e72055fc4bc9e03d9`.
Exact Commerce source: `81a6f571b5ad3dcc73ba6af9a89bdb438c6a8e06`.
Clean source archive SHA-256:
`c7b2c80c7db47e40316eebabd1e14e821bd4fa0c0648095ccabc9b3b1831f173`.
The digest identifies source, not a released bundle.

No other product repository or workflow rail is changed. The existing design
language and managed fail-closed contracts are preserved. Same-repository
GrillTrack predecessor inputs were recovered from
`6792992303b05918a15c475ac90316530a2f61d5`, retained unchanged and advanced only
through the CLI. Historical private-reference inputs remain locally retained
and excluded from fresh public commits; none is deleted or rewritten.

## Implementation and evidence

Cursor ACP implementation uses the advertised `grok-4.6[effort=high,fast=true]`
model. Exact workspace readiness and submission both confirmed `approve-all`.
The initial job completed with observed owned-worker termination and cleanup
ready; backend session discard is unsupported. Both follow-up jobs also completed with cleanup ready before replacement. All
implementation and code/test repairs used the native ACP lane; the parent
independently ran the full verifier and inspected source and browser images.
Local operational receipts retain genuine conversation/job identities.

The initial full verifier passed 16 browser tests: all earlier desktop/mobile
CMS, managed `8 -> 5 -> 8`, unmanaged status and catalog regressions, plus the
new default-profile persisted Products journey. The parent inspected desktop
and mobile images and required fresh-seed copy/link repair despite those passes.
This initial run is superseded for candidate acceptance.

Final `pnpm verify` on Node `22.23.2` passed Astro check, 19 unit tests, six
workflow tests, feature/text audits, build and 16 browser tests. The parent also
ran the full verifier after the seed repair with the same passing counts.
The final public-entry correction was followed by a complete passing run.
Sanitized desktop/mobile Home, admin, price/status and detail images are retained
in a separate local proof repository; none is committed as product media.
Operational logs, identity receipts and image digests are retained in ignored
`runs/v1-release/`. Existing EmDash admin React key warnings and large-bundle
warnings remain nonblocking observations, not claimed fixes.

## Adjudication

- Required, repaired: default seeded hero links targeted hidden demonstrations and the
  stock caption still named Inventory. Repair fresh seed only; preserve existing
  edited content without automatic migration.
- Required, repaired in initial job: proof routes must require both explicit
  proof profile and proof mutation mode before importing runtimes.
- Required, repaired in initial job: test resets must stay in the two disposable
  artifact roots and ignore inherited database/upload paths.
- Required, repaired: mocked module factory evaluation stays zero in shipping
  and reaches both demonstrations in proof; generated test-only declarations
  were restored to the baseline seed model before freeze.
- Required, repaired: a pure public `identity/index.ts` entry replaces cross-feature
  access to internal `types.ts`, without changing constants or domain behavior.
- Deferred: native source aliases, legacy Blocks registration, EmDash 1.0,
  registry-installed storage/route identity, exact final Commerce artifact and
  Coming soon control. See `docs/v1-pairing.md` for concrete owner handoffs.
- Human gate: deployment, DNS, secrets, publication, releases and merge.

The release track remains open. Checkout/orders/payments/shipping are upstream
release gates; there is no verified demo URL. `docs/v1-demo-plan.md` is a plan,
not delivery. The follow-up guest-cart scope belongs to issue 20 and depends on
Commerce issue 32 for a supported mounted contract.
