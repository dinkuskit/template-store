---
name: managed-product-verification
description: Prove the template-store Blocks, Commerce, and Inventory managed-product availability vertical.
---

# Managed product verification

Use this project-local skill when changing the store shell, CMS block
composition, Commerce catalog/managed-SKU wiring, Inventory adapter, stock
presentation, or proof route.

## Commands

```bash
bin/verify-web quick
bin/verify-web full
```

`quick` runs Astro type checking, unit behavior, workflow tests, the feature
boundary audit, and tracked-plus-untracked worktree text checks. `full`
additionally builds the real Astro server and runs desktop and mobile Chromium
acceptance.

## Expected proof

The full verifier must show:

- real `dinkus.page-hero` and `dinkus.fact-rail` block roots;
- Commerce SKU `DINKUS-DEMO-001` linked to Inventory identity
  `dinkus-inventory-sku-demo`;
- availability sequence `8 -> 5 -> 8` with monotonically increasing Inventory
  versions;
- readable hero-action contrast and no page or fact-rail horizontal overflow
  in desktop or mobile Chromium;
- initial, changed, restored screenshots and JSON assertions under ignored
  `runs/managed-product-availability-20260829/browser/`.

The `/api/proof/stock` endpoint must return `404` unless
`DINKUS_PROOF_MODE=1`. It is not a production mutation surface.

## Failure handling

Treat a missing CMS seed, package-pin drift, unregistered SKU, stale Inventory
version, non-idempotent command, or missing block root as a real failure. Do not
replace Inventory with a storefront quantity or relax the proof sequence.
