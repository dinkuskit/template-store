# Agent Contract

This public repository owns the generic DinkusKit store starter for EmDash.
Assume every committed byte is immediately public.

## Running GrillTrack

Run `./scripts/agent-skills` first; it installs the pinned SaariusSkills
skills into ignored `.cursor/skills/`. Use
`./scripts/grilltrack --project . validate` or `show` for ledger reads.
The CLI-only ledger rule remains in force. SmokySkills is enabled only after
maintainer access and an immutable commit pin are supplied.

## Organization direction and research

The [organization vision](https://github.com/dinkuskit/.github/blob/36aab690a7ef66dc119aab70e258ea979c54841a/VISION.md) and
[planning boundaries](https://github.com/dinkuskit/.github/blob/36aab690a7ef66dc119aab70e258ea979c54841a/ROADMAP.md) describe the shared direction: independently
useful connected tools for one accountable business operator, optional first-party
or merchant-selected assistants, and adoption in useful stages. They do not
replace this repository's current runtime contracts or establish new capability,
release, deployment, or action authority.

For a material product, architecture, implementation, or verification question,
use the pinned `emdash-commerce` skill and its
[selective REA guidance](https://github.com/saariuslystoned/SaariusSkills/blob/23f2bb1208b3baa7aedaa87faec00395f9bdd061/skills/emdash-commerce/SKILL.md). Research the actual question; routine fixes do
not require a new research cycle. Keep research findings, accepted designs, and
active work distinct, and reuse the owning issue or decision record. Public
outputs must be original and public-safe.

## Source priority

1. This file.
2. The linked organization vision and planning boundaries for shared direction.
3. `design.md` for this repository's visual contract.
4. `FEATURE_MAP.md` for feature ownership and verification.
5. `.grilltrack/ledger.json`, changed only through the GrillTrack CLI.
6. Current source, tests, and committed proof for implemented behavior.

## Product boundary

- The shipping v1 profile is a neutral Commerce storefront with Inventory off.
  Managed-stock integration remains a separate development/proof profile. The
  starter does not own those packages' domain rules.
- Fresh shipping products use Commerce authoritative prices and manual
  availability. Stock management is Coming soon and unavailable in the paired
  Commerce release. Preserve existing managed data and fail-closed behavior;
  never auto-convert it or invent a fallback ledger.
- TemplateStore ships alongside its matching exact Commerce release/artifact.
  Require the owner's immutable artifact identity and digest before claiming
  a paired clean install; source aliases prove only development integration.
- All DinkusKit plugins must be registry-enabled. Shipping template defaults
  consume actual registry-installed Commerce through supported public surfaces;
  native registration or direct storage access is not equivalent without proof
  of matching plugin identity, storage and route authority.
- Commerce runs one build here, the Registry (sandboxed) one, everywhere
  (GrillTrack `template-one-build-registry-20261031`): local dev, the hosted
  demo and the browser tests mount the pinned Commerce's Registry bundle through
  EmDash's `sandboxed: [...]` (`scripts/lib/paired-commerce.mjs`,
  `DINKUS_PAIRED_COMMERCE_DIR`). Commerce's native copy and
  `DINKUS_CATALOG_PROFILE=native-development` are retired. The playground runs
  the same Registry build in each visitor's store, as it runs Payments and Ship
  (`playground-commerce-in-store-20261031`).
- The authorized guest-cart extension consumes Commerce authority. Browser
  identity/quantity persistence is untrusted intent/cache, never a price, stock,
  checkout or order backend. Guest checkout and return states depend on the
  exact supported Commerce public mount/artifact.
- EmDash owns human-authored composition and merchandising content. Commerce
  owns catalog identity, managed-stock state, and unmanaged manual availability.
  Inventory owns stock identity, quantities, locations, mutations, and receipts.
- Pre-release Dinkus dependencies stay pinned to exact commits. Source-entry
  aliases are temporary dogfood mechanics, not release compatibility claims.
- The local proof adapter supplies disposable storage mechanics only. It is not
  a production stock ledger, Cloudflare adapter, or fallback inventory system.
- SmokyClub is reference-only. Do not import brand content, production
  configuration, credentials, databases, private rationale, or unrelated
  history.

## Layout

- `src/features/` owns co-located storefront features.
- `seed/` owns neutral EmDash review content.
- `tests/` owns deterministic and browser acceptance.
- `bin/verify-web` is the canonical verification entry.
- `skills/managed-product-verification/` documents the project-local verifier.
- `.grilltrack/proof/` owns curated track text proof. Routine screenshot media
  stays ignored under `runs/` until separately selected for immutable
  release-asset hosting.
- Generated databases, uploads, browser output, and temporary package material
  stay ignored under `.artifacts/`, `test-results/`, and `runs/`.

## Required checks

Establish a fast baseline and iterate with `bin/verify-web quick` (~15s) plus
targeted Playwright specs (`pnpm exec playwright test <spec> --project=chromium-desktop`)
before running the full suite. Run `pnpm verify` (`bin/verify-web full`, ~10m)
once before closeout after targeted checks pass. Browser proof must exercise desktop Chromium
and a mobile viewport. The proof store runs the pinned Commerce's Registry
build (`pnpm prepare:commerce` first; `bin/verify-web` does it): its product
checks go through Commerce's own routes (the product panel, the private
`catalog` route, `catalog-items/set-on-sale`, the public reads). The explicit
development integration profile observes the managed `8 -> 5 -> 8` Inventory
sequence, and observe unmanaged manual availability cycle through in-stock,
out-of-stock, and available-on-backorder without showing a quantity. The
default shipping profile must prove the installed Commerce public catalog path
with no Commerce mounted at all, no Inventory configuration/network, and no
proof adapter bootstrap. Without a paired installed artifact the catalog
fail-closes and invents no products. Source-pilot checks do not establish
released artifact, registry, checkout, or Cloudflare readiness.

## Gates

An assigned source task, including implementation of locked or approved
GrillTrack decisions, authorizes required checks/proof, commits, non-force
pushes to its assigned branch, pull-request creation/updates, review requests,
and bounded in-scope repairs without separate permission questions. Keep one
writer in an isolated branch/worktree and bind review evidence to the exact
head; a changed head requires current review evidence.

Publishing packages, deployment, production mutation, secrets or permissions
changes, and merges require separate authorization.

Use Node 24.22.0 per `.nvmrc` and verify `node -v`. In Cursor cloud agents put
nvm's Node ahead of `/exec-daemon` on `PATH` with
`export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH"`. In Claude Code
cloud sessions the environment supplies that Node and pnpm, and
`.claude/hooks/session-start.sh` installs dependencies from the lockfile, the
pinned Commerce source, the pinned agent skills and the Playwright browser,
then reports anything missing; read that report before running project
scripts. A checkout last installed under Node 22 needs `pnpm rebuild` after switching
to Node 24, because `pnpm install --frozen-lockfile` leaves better-sqlite3 built
for Node 22; the session hook rebuilds it automatically. Attach `dinkuskit/inventory` to the session too: the cloud proxy
serves `github:` dependency tarballs only for attached repositories.

## Reusable proof method

For implementation and verification work orders, produce a compact acceptance-to-proof TABLE in the task response without changing requested artifacts. Map every material requirement to the authoritative specification’s supporting passage, independently sourced expected facts, a known-good populated passing case, an adverse/refusal case with expected outcome, the exact capable environment, and planned evidence. Trace each expectation to its source; implementation behavior cannot establish its own correctness.

Reconcile sources before selecting assertions. Explain why each case exercises its requirement, how it distinguishes success from failure, and how planned evidence will compare observed results against those expectations, including ownership, consistency across representations, and permitted effects where relevant. Empty or unreachable cases cannot prove populated behavior.

Keep missing facts, cases, sources, and environment capabilities as explicit discovery dependencies, identifying what must establish them. Distinguish planned evidence from observed results; skips are not passes. Planning-only work claims no execution. Check complete coverage and resolve conflicts using existing source priority. Preserve all non-goals, mandatory checks, ownership, and authority. Continue already authorized work without routine permission questions.

## Delegated audits

- `api-oracle` ([saari-co/api-oracle](https://github.com/saari-co/api-oracle)) runs
  delegated background audits, CI triage, and architecture checkpoints on API
  credits. Prefer `oracle ask <lane>` for work a brief can carry, and read and
  rate the briefs it announces. It gates nothing and does not replace
  ClawSweeper review.
