# Source delivery approval boundary

- Repository: `dinkuskit/template-store`.
- Branch: `codex/approval-boundary-template-20261020`.
- Base: `2c0bdf627ee6b6405e421387a856c31cdc5a357c`, including merged PR #113.
- Scope: [AGENTS.md](../../../AGENTS.md) and this public-safe proof only.

The contract now explicitly includes implementation of locked or approved
GrillTrack decisions within an assigned source task, required checks/proof,
commits, non-force pushes to the assigned branch, pull-request creation/updates,
review requests, and bounded in-scope repairs. These steps do not
need another permission question. One writer, an isolated branch/worktree,
and review evidence for the exact current head remain required.

The existing publishing, deployment, production mutation, secrets/permissions
and merge gates remain unchanged. This grants no standing merge authority. The
scoped active-policy check found no fixed-count repair cap to remove.

Validation:

- Node: `v24.22.0` using an existing runtime and command-local PATH.
- `node scripts/check-features.mjs`: `feature audit: ok`.
- Markdown links resolve; unchanged contract sections and preserved gates
  checked against the exact base.
- `git diff --check`: passed.
- PR #115 carries `verification-only`; CI/review coordination remains separate
  from source preparation and does not authorize deployment.

This is source-policy proof. No product code, decision ledger, dependency,
runtime, deployment, credential, installed skill, or global configuration
changed. `pnpm verify` and browser suites were not run for this
documentation-only change; no product behavior claim is made.
