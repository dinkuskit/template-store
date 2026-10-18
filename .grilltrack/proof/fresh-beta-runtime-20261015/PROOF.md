# Known Commerce runtime profiles

The host defaults to stable `dinkus-commerce` / `r_gshdrqaldna3r7sn`.
Explicit trusted build profile `beta` selects `dinkus-commerce-beta` /
`r_fjzjvld3ssb4j63o` once for both server and browser. Catalog, readiness,
prepare/start, local status dispatch and exact guest POST boundary align.
Unknown profiles fail; no arbitrary runtime, host, client selector or fallback.
The AST Access preview uses that same selection without weakening its existing
static metadata checks. Its nine name/public/method triples match the actual
beta manifest; source preview remains non-authoritative for live Access.

## Executed local proof

- Both profile bundles: server + browser identity, three exact POSTs, other
  profile and private-adjacent denials, installed catalog/readiness admission,
  wrong namespace/metadata denial, browser prepare/start/status transport paths.
- Actual EmDash public dispatcher against the qualified beta manifest fixture.
- Native workerd status for both profiles, safe response projection, missing
  locals/private metadata failure, foreign-origin rejection, no status HTTP.
- Build-profile validation and generated config/child-environment alignment.
- Existing strict AST wrapper/method/duplicate tests remain required.

`packaged-composition.json` records a stronger actual beta backend composition:
reviewed Commerce release head `4d1adbfa96289a54fb5c702f2583fcc6cc94ceec`,
local candidate `0.3.0-beta.0` archive; backend SHA256
`7ab9cf5c17986dc6ff6b39a561b5a7f8c97dffdf2bd44b96cf0a3afe44164eb4`,
compiled manifest SHA256
`86cbba303b8780f7a1dfc74dfa7af3404215975f89a98aa4403596992de16e5e`.
The exact manifest is retained in `tests/fixtures/commerce-beta/manifest.json`
with a byte-hash regression. The MIT Commerce manifest is reused as public
package metadata only; no unrelated repository history or private data imported.

The Commerce owner's `tests/features/checkout/registry-runtime.mjs` supplied
original plugin storage/settings/CAS, actual WorkerdSandboxRunner, and an
intercepted synthetic issuer + Payments transport. Shipped grants were unchanged.
The actual EmDash public wrapper delegated through a fixture Request-to-
`invokeRoute` context adapter; this is not full EmDash middleware or a replayed
Registry installation. Template catalog/readiness, prepare, start and local
status association passed; wrong-profile/private, foreign-origin and malformed
capability denied. No live service/provider calls. Opaque fixture values were
kept in process and excluded from proof.

## Scope limits

Local candidate proof establishes host compatibility with these exact bytes.
It does not establish Registry publication, a fresh hosted installation, service
authentication or a completed live checkout. Existing stable stores require no
profile change. Source aliases/pins remain development-only and unchanged.
Full `pnpm verify`, actual beta Registry build/dry-run, exact-head CI, OpenClaw
and native review are retained in the task run packet before maintainer handoff.
No merge, deployment, Access mutation, resources, credentials, provider calls or
existing store/order mutations are part of this change.
