# Native ClawSweeper adjudication

Public product and review facts only. This record adjudicates one native
review of a historical head. It is not merge approval, release readiness,
or review clearance for a later head.

## Tuple

- Repository: `dinkuskit/template-store`
- PR: [26](https://github.com/dinkuskit/template-store/pull/26)
- Branch: `codex/template-store-retire-dinkus-blocks-20261001`
- Base: `690783f8ef368bf18c5dc8afc57c90f19f9809ee`
- Reviewed head: `24b3ca6c81b26d98c5d6e2735d0d56d0aed319f6`
- Native run: `36868690192`
- Final review comment: [5932511580](https://github.com/dinkuskit/template-store/pull/26#issuecomment-5932511580)
- Native verdict on that head: needs changes

## Accepted finding

One actionable root issue is accepted: `docs/v1-pairing.md` still described
an active Blocks pin, native `@dinkuskit/blocks` dependency, Dinkus block
registration, and EmDash `0.41.0`. Current source uses EmDash package
`1.0.1` public native Blocks, local legacy Portable Text presentation, and
Unknown fallbacks, with no `@dinkuskit/blocks` dependency or registration.
The retired pin `fe03bfac91798ac0b411b952fe23c26afefbf570` is historical
style provenance only, not a shipping requirement.

The published P3 finding and the P2 "Complete next step" item are the same
docs issue, not two findings. Added labels (`P2`, `proof: sufficient`,
rating, and maintainer-look status) are review metadata, not separate
defects.

Classification: `required_fix` on historical head
`24b3ca6c81b26d98c5d6e2735d0d56d0aed319f6`.

## Repair boundary

The accepted repair is docs-only: correct the pairing table Blocks and
EmDash current-identity rows, the Blocks runtime gate, and the composition
paragraphs so they match current source. Other owners' unresolved gates
remain explicit. No new artifact, mounted pair, purchase, deploy, or
registry-qualification attestation is added. Unrelated historical proof is
not retouched. Runtime, tests, config, dependencies, ledger, and events
are unchanged.

## Reused runtime verification

Parent `pnpm verify` / `bin/verify-web full` on the frozen runtime already
passed: unit 66, workflow 9, browser 17, and 3 expected skips across
desktop Chromium and a mobile viewport. That runtime evidence is reused
because this repair does not change runtime. Feature and worktree-text
audits plus `git diff --check` are the docs-only checks for the repair.

## Fresh review required

This historical review still needs changes at
`24b3ca6c81b26d98c5d6e2735d0d56d0aed319f6`. A later docs-only head is a
new source identity and needs a fresh native review. Clearance is not
claimed here.

CI run `36868649365` and OpenClaw request
`req-20261001T132729Z-161270514959` were still attached to the historical
head when this adjudication was written. Those in-flight jobs are
preserved; this record does not dispatch a duplicate worker or cancel
another process.
