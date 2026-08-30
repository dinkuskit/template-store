# Agent Contract

This public repository owns the generic DinkusKit store starter for EmDash.
Assume every committed byte is immediately public.

## Source priority

1. This file.
2. `design.md` for the current product-wide visual contract.
3. `FEATURE_MAP.md` for feature ownership and verification.
4. `.grilltrack/ledger.json`, changed only through the GrillTrack CLI.
5. Current source, tests, and committed proof.

## Product boundary

- The starter proves how EmDash, DinkusKit Blocks, Commerce, and Inventory fit
  together in a neutral storefront. It does not own those packages' domain
  rules.
- EmDash owns human-authored composition and merchandising content. Commerce
  owns catalog identity and managed-stock state. Inventory owns stock identity,
  quantities, locations, mutations, and receipts.
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
- `proof/` owns curated text proof. Routine screenshot media stays ignored
  under `runs/` until separately selected for immutable release-asset hosting.
- Generated databases, uploads, browser output, and temporary package material
  stay ignored under `.artifacts/`, `test-results/`, and `runs/`.

## Required checks

Run `pnpm verify` before closeout. Browser proof must exercise desktop Chromium
and a mobile viewport, observe the initial stock value, apply one Inventory
adjustment, observe the changed value, restore it, and observe the restored
value.

## Gates

Publishing packages, deployment, production mutation, secrets or permissions
changes, pull-request creation, and merges require separate authorization.
