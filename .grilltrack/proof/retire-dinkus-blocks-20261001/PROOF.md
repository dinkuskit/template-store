# Retire @dinkuskit/blocks

Public product and test facts only. Routine screenshot media stays ignored
under `runs/` until separately selected for approved release-asset hosting.

## Scope

Repository: `dinkuskit/template-store`.
Branch: `codex/template-store-retire-dinkus-blocks-20261001`.
Base: `690783f8ef368bf18c5dc8afc57c90f19f9809ee`.
Track: `gt-20260930163954-43d0a5`.
Decision: `retire-blocks-008`.
Frozen source identity:
`78a1b8743dd43bcd518579a275b29700feec20dcb83b23348cd9db034e7bd7f4`.
That digest identifies the unchanged 31-path working-tree freeze, not a Git
commit and not a released artifact.

EmDash remains package `1.0.1`. Commerce remains
`d3f7e591ef64c63d7748fe75e746dcfe39bbb4ca`. Inventory remains
`5889c7d59398376da51ac400d5c1f1214aba2c6b`. `@dinkuskit/blocks` is absent
from active `package.json` dependencies, lockfile, runtime aliases, and
feature audit. Starting point is the merged PR18 upstream-blocks transition
at `97d4ebfa6b31bcc00f3a3b8e72055fc4bc9e03d9`.

## Accepted lock

EmDash owns blocks. Retire `@dinkuskit/blocks` from the active Template
dependency, runtime, build, audit, and lockfile. Reuse the merged PR18
transition. Preserve current appearance and content behavior with local
presentation components for retained Portable Text. Keep fail-closed
migration with concrete backup verification. Keep Commerce and EmDash pins
unchanged.

## Exact acceptance

FEATURE_MAP first-class page composition:

- Home opener and published Query Card render from ordered block data.
- Drafts stay absent.
- An independently copied Home opener is page-owned.
- Original Portable Text survives edits and renders when layout is absent.
- History retains both shapes.
- Production `dist/server` renders registered unknown native and nested
  Portable Text fallbacks.

Desktop Chromium and mobile viewport proof covered native admin insert,
edit, publish, public signed-out rendering, authenticated public Edit-mode
toolbar, original Portable Text preservation, revision restore, and
guarded migration backup/idempotence/restore. A separate built-server
fixture proved registered missing-native and nested Portable Text
fallbacks. The first-class cards remain admin-edited; public Edit mode
does not claim inline field editing.

## Legacy CSS provenance

Local page-hero, fact-rail, and query-card presentation uses `@layer
dinkus-blocks` styles copied from the public retired `@dinkuskit/blocks`
pin `fe03bfac91798ac0b411b952fe23c26afefbf570`. Store-shell keeps the
existing composition overrides: three fact-rail columns on desktop, one
column below `44rem`, visible overflow, and `min-width: 0`.

## Skip rationale

`tests/e2e/query-card.spec.ts` is deleted. Its supported-API contract now
lives in `tests/e2e/upstream-blocks.spec.ts` beside native Query Card
admin insertion: published records only, draft exclusion, unsafe
href/image rejection, empty and missing collections, and bounded limits.

`tests/e2e/home-opener-section.spec.ts` skips when the retired plugin
editor is absent (`legacy plugin editor retired; use native Blocks
coverage`). Native Home opener copy, independent edit, publish, and
revision restore are covered by `tests/e2e/upstream-blocks.spec.ts` on
desktop and mobile.

`tests/e2e/built-unknown-fallback.spec.ts` skips non-desktop projects
(`bounded desktop production built-server proof`). Those two Home opener
skips plus the mobile built-server skip are the three expected browser
skips.

## Unsafe URL and unknown warning behavior

Legacy Query Card and nested rich-text Query Card strip `javascript:`
image and link values. Unsafe titles remain visible without those
attributes. Empty or missing collection sources keep the stored source and
limit and render no cards.

Unknown native blocks render `role="alert"` with
`data-emdash-missing-block` and the warning that the block type is not
available in this storefront release. Unknown Portable Text nodes render
`role="status"` with `data-emdash-unsupported-content` and the warning
that the editorial node was preserved but cannot be rendered. The raw
node remains in stored content.

## Backup, idempotence, and restore

Guarded apply requires loopback, exact Home ID confirmation, and a new
SQLite snapshot path. An existing snapshot is refused with no write.
A first apply writes layout, retains original `content`, and records
backup SHA-256 plus `PRAGMA integrity_check=ok`. A restored snapshot copy
keeps original empty layout, original Portable Text, and page revisions.
A second apply returns `skip` and does not overwrite layout. Preview
mode writes nothing. Rejected apply does not replace an original backup.

## Parent verification

Independent `pnpm verify` / `bin/verify-web full` after the 31-path
source freeze: exit 0. Astro check 104 files, 0 errors, 0 warnings, 1
hint (`scripts/cloudflare-workers-hook.mjs` reports deprecated
`node:module` `register`). Unit 66 passed. Workflow 9 passed. Browser 17
passed and 3 expected skips across desktop Chromium and a mobile
viewport. Commerce source prep remained
`d3f7e591ef64c63d7748fe75e746dcfe39bbb4ca`.

After each suite deleted its own synthetic Query Card collection, EmDash
1.0.1 logged an asynchronous revision-prune warning because the fixture
collection table was already gone. Tests still passed. No operator or
deployed data was used.

## Unknown production versus anonymous coverage

The production built-server proof registers the missing local renderer
and publishes nested fallbacks through an authenticated admin context,
then renders `/` from that same browser context against `dist/server`.
Separate main-suite coverage uses an anonymous public page for signed-out
Home, Query Card, legacy fallback, and unknown warnings. Authenticated
public Edit-mode toolbar coverage is also separate and does not substitute
for the anonymous page.

## Limitations

Deployed databases and revisions were not inventoried. This record does
not attest a live-site or production migration, a deployment, a Stripe
purchase, or a new registry release. Exact-source review, owner approval,
inspection closeout, and release readiness are not claimed here.
