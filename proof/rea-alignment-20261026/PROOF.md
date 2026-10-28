# Documentation and agent-entrypoint alignment proof

Date: 2026-10-26. Repository: `dinkuskit/template-store`. Branch:
`codex/rea-alignment-20261026`. Implementation commit: `b1c17d5261a86f26c38439e191de11a76c65a30f`. Freshly fetched base: `1b8e998804432c05dc2c628974509c5ec6e764a4`.

This source-only alignment follows the public [organization vision](https://github.com/dinkuskit/.github/blob/36aab690a7ef66dc119aab70e258ea979c54841a/VISION.md),
[planning boundaries](https://github.com/dinkuskit/.github/blob/36aab690a7ef66dc119aab70e258ea979c54841a/ROADMAP.md), and
[canonical research guidance](https://github.com/saariuslystoned/SaariusSkills/blob/23f2bb1208b3baa7aedaa87faec00395f9bdd061/skills/emdash-commerce/SKILL.md). It implements no new product architecture.

## Acceptance and evidence

| Requirement | Evidence and limit |
| --- | --- |
| Optional features | `docs/v1-pairing.md` makes Coupons optional for v1 and keeps Inventory off in the shipping profile. No runtime or dependency pin changes. |
| Source identity | The current Commerce, EmDash, Payments, Ship and Inventory source identities in the document match `package.json`; the October 6 table is historical proof, not current install/release evidence. |
| Draft preview refusal | The existing condition-evaluation suite proves draft opened/synchronize/reopened events refuse deployment before a label exists, the verification-only label refuses deployment, and ordinary non-draft/main-push behavior remains unchanged. |
| Publication boundary | The PR stays draft and receives `verification-only`; no preview or main deployment is requested. The added draft guard is inside the pull-request branch only. |
| Selective research bootstrap | [bootstrap.json](bootstrap.json) records each installed skill's immutable source and file count. Full installed trees match `git ls-tree` blob hashes; canonical Markdown references resolve. Cached reinstallation is byte-identical and preserves an unrelated sentinel. Existing bundle pins are unchanged. Only `emdash-commerce` uses the newer pin. |
| Public-safe changes | Local Markdown links resolve; changed text introduces no private workspace or research references. Published baseline links resolve at their pinned public revisions. |

## Checks

- `bash -n scripts/agent-skills`: passed.
- Isolated bootstrap with temporary cache and skill destination: passed; no user-level installation.
- `git diff --check`: passed.
- `actionlint -shellcheck='' -pyflakes='' .github/workflows/ci.yml`: passed.
- `node --test tests/workflows/verification-only-ci.test.mjs`: 6 passed.
- `pnpm verify`: **in progress at this source handoff**, not a full-suite pass. Astro check, 57 Vitest files / 528 unit tests, workflow tests, feature audit, and build pass. The desktop/mobile Playwright run is still in progress (27 of 76 cases reached without a failed assertion at handoff). Final exact-head result belongs in the PR body and CI, avoiding proof-only source churn.

## Scope and gates

No hosted CMS publication, deployment, release, merge, account/permission change, or
live store action was performed. Local fixtures and source verification do not
establish current hosted availability, a released package pair, or production
readiness. Review evidence must be bound to the PR's exact head; future source
changes require fresh relevant checks.
