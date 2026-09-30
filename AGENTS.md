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

Run `pnpm verify` before closeout. Browser proof must exercise desktop Chromium
and a mobile viewport. The explicit development integration profile observes the managed `8 -> 5 -> 8` Inventory sequence,
and observe unmanaged manual availability cycle through in-stock, out-of-stock,
and available-on-backorder without showing a quantity. The default shipping
profile must prove the persisted Products admin-to-storefront journey without
Inventory configuration/network or proof adapter bootstrap. Source-pilot checks
do not establish released artifact, registry, checkout, or Cloudflare readiness.

## Gates

Publishing packages, deployment, production mutation, secrets or permissions
changes, pull-request creation, and merges require separate authorization.
