# Proof: nine-product demo seed (template-store #62)

## Full repository verification (CI)

- Head: `51f47397dd20d73dc06fbaac72f0d8d9a144d3d5` (the seed changes plus main at `0ecc900`)
- Run: https://github.com/dinkuskit/template-store/actions/runs/38084471827 (`pull_request`, conclusion `success`)
- Store verification job `114307965925` ran `pnpm verify` (`bin/verify-web full`), including the desktop and mobile Chromium browser projects:
  - Playwright: `27 passed`, `5 skipped` (8.6m), across `shipping-chromium-desktop` and `shipping-chromium-mobile`
  - `verify-site: passed (0 failure(s), 4 skip(s), 7 URL(s) checked)`
  - `verify-web: full passed`
- Workflow validation job `114307965750`: success.
- Playground build job `114310111742`: success.

This replaces the PR body's earlier local note that `pnpm verify` could not finish browser tests in the authoring VM. The repository-required full verification passes in CI.

## Scope note

The commit that adds this file also updates `docs/deployment/demo-reset-plan.md` for the nine-product baseline (ten SKUs, counting both hoodie sizes). Those are docs and proof only; the seed code verified above is unchanged.
