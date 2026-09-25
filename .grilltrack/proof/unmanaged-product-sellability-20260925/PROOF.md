# Unmanaged product sellability proof

Date: 2026-09-25
Baseline: `35ac1f272476e3094cecaa30124a5699c53d5a8c`
Upstream Commerce source: `8ca3e5dd14264df6db21bf4bee778158b0357bd2`
Source identity: assigned by the authorized delivery commit containing this
packet; terminal review is performed against that immutable pushed head

## Accepted boundary

Catch template-store up to Commerce #16 unmanaged product sellability. Keep
FEATURE_MAP + `bin/verify-web`. Do not add a separate OpenClaw verify-skill.
Preserve managed Inventory `8 -> 5 -> 8`. Add an unmanaged storefront journey
that a human can still merchandise from the EmDash Pages editor without a code
change. Manual availability stays Commerce-owned. The persisted Manage Stock
toggle, visual Commerce admin UI, cart, checkout, payments, shipping,
deployment, and npm publish remain out of scope.

## Implementation

- Pin Commerce to `8ca3e5dd14264df6db21bf4bee778158b0357bd2`.
- Add `dinkus.unmanaged-product-sellability` with
  `createCatalogItem(manageStock: false)`,
  `resolveStorefrontAvailability`, and
  `setCatalogItemManualAvailability`.
- Proof route `/api/proof/unmanaged-availability` accepts the same
  `{ catalogItemId, status }` body as Commerce's authenticated action and
  returns 404 outside `DINKUS_PROOF_MODE=1`.
- FEATURE_MAP driver rows cover managed `8 -> 5 -> 8` and unmanaged
  `in-stock -> out-of-stock -> available-on-backorder -> in-stock`.

## Verification

Command:

```text
NO_PROXY=127.0.0.1,localhost,::1 mise x node@22.23.2 -- bin/verify-web full
```

Result: pass.

- Astro check: 36 files, 0 errors, 0 warnings, 0 hints.
- Unit behavior: 6 tests passed.
- Workflow tests: 6 passed.
- Feature/source-pin audit: passed.
- Astro server build: passed.
- Playwright: desktop Chromium and Pixel 7 viewport both passed for managed
  `8 -> 5 -> 8` and unmanaged manual availability, including admin Pages `home`
  before/after and public in-stock / out-of-stock / backorder / restored.

Ignored screenshot root:
`runs/unmanaged-product-sellability-20260925/browser/`.
