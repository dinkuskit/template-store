---
name: managed-product-verification
description: Verify shipping storefront, guest cart/checkout boundaries, and the separate managed-stock development profile.
---

# Template Store verification

Use this project-local skill when changing the store shell, CMS block
composition, Commerce catalog/managed-SKU wiring, unmanaged manual
availability, Inventory adapter, stock presentation, or proof routes.

Use Node `>=22.16.0 <23` and the package-pinned pnpm version. Install with
`pnpm install --frozen-lockfile`. Source preparation fetches the exact public
Commerce commit in `package.json` into ignored `.artifacts/source-deps/`; it
must not be replaced with a sibling checkout or a floating branch.

## Commands

```bash
bin/verify-web quick
bin/verify-web full
```

`quick` runs Astro type checking, unit behavior, workflow tests, the feature
boundary audit, and tracked-plus-untracked worktree text checks. `full`
additionally builds the real Astro server and runs desktop and mobile Chromium
acceptance.

The default mode is `quick`; success exits 0 and prints
`verify-web: <mode> passed`. Unsupported modes exit 2. Child failures stop the
gate. Keep command output and inspect the first failure before rerunning.

## Shipping profile proof

The full gate runs shipping desktop and mobile Chromium separately from the
managed development profile. It must prove the persisted Products admin to
storefront journey with Inventory off, guest cart intent persistence, and
fail-closed guest checkout/return states. Synthetic controller recovery is
fixture proof. A forged browser success claim cannot establish a paid order.

The package, paired, and Registry checkout scripts in `package.json` are
additional artifact-specific gates with their own prerequisites. The canonical
source gate does not establish an immutable paired release, signed Registry
installation, live Stripe readiness, or EmDash 1.2 migration for this template.

## Development integration proof

The explicit proof profile must show:

- supported upstream opener blocks and preserved legacy
  `dinkus.page-hero` / `dinkus.fact-rail` Portable Text rendering;
- EmDash-backed collection navigation and responsive product presentation;
- Commerce SKU `DINKUS-DEMO-001` linked to Inventory identity
  `dinkus-inventory-sku-demo`;
- availability sequence `8 -> 5 -> 8` with monotonically increasing Inventory
  versions;
- Commerce SKU `DINKUS-DEMO-UNMANAGED` with manual availability
  `in-stock -> out-of-stock -> available-on-backorder -> in-stock` and no
  quantity;
- readable hero-action contrast and no page or fact-rail horizontal overflow
  in desktop or mobile Chromium;
- managed screenshots under ignored
  `runs/managed-product-availability-20260829/browser/`;
- unmanaged admin and public screenshots under ignored
  `runs/unmanaged-product-sellability-20260925/browser/`.

The `/api/proof/stock` and `/api/proof/unmanaged-availability` endpoints must
return `404` unless `DINKUS_PROOF_MODE=1`. They are not production mutation
surfaces.

Browser screenshots also live under ignored `runs/v1-release/browser/`,
`runs/guest-cart/browser/`, and `runs/checkout-integration-runs/20261007/browser/`.
Playwright diagnostics live under `test-results/playwright/`. The retired legacy
plugin-editor scenario skips on desktop/mobile; built-server fallback proof is
desktop-only and skips on mobile. Record skips separately from passing tests.

## Failure handling

Treat a missing CMS seed, package-pin drift, unregistered SKU, stale Inventory
version, non-idempotent command, or missing block root as a real failure. Do not
replace Inventory with a storefront quantity or relax the proof sequence.
