# Exact-source review

Source identity: `git:f132dfb712351ef7a956d0d13b1379d136d67b2d`
Review date: 2026-08-30
Result: findings

## Standards axis

- `required_fix`: `AGENTS.md` assigns curated proof to `proof/`, while the
  active GrillTrack contract and ledger correctly use `.grilltrack/proof/`.
  The repository contract must name the actual durable proof owner.
- All other inspected repository boundaries, exact source pins, feature
  ownership, public/private data constraints, and delivery exclusions match
  the local contract.

## Source-intent axis

- `required_fix`: the documented fresh-clone path is `pnpm install` followed by
  `pnpm verify`, but `bin/verify-web` does not run `prepare:sources`. The exact
  Commerce checkout happens to exist in the current ignored workspace, so the
  verified command does not prove the documented clean-start behavior.
- `required_fix`: source visibly gates `/api/proof/stock` behind
  `DINKUS_PROOF_MODE=1`, but the repo-local verification contract explicitly
  requires `404` outside proof mode and no test asserts it.
- The implementation otherwise faithfully preserves the confirmed slice:
  SmokyClub remains untouched; Blocks, Commerce, and Inventory retain separate
  authority; browser proof uses Inventory for `8 -> 5 -> 8`; excluded price,
  cart, checkout, payment, shipping, deploy, merge, and production behavior was
  not added.

## Classification

The three findings are `required_fix`. They return the managed-product and
XAPI-568 proof decisions to implementation and re-verification before a clean
terminal review.
