# Managed product availability proof

Date: 2026-08-29
Track: `gt-20260829172956-305950`
Baseline: `93c6991af4b433877d5bf252e059822e45562662`
Source identity: assigned by the authorized delivery commit containing this packet; terminal review is recorded against that immutable SHA after it exists

## Accepted decisions

- `template-store-role-001`: `dinkuskit/template-store` is the clean generic
  integration surface; SmokyClub remained untouched and reference-only.
- `managed-product-vertical-002`: the first vertical is one neutral EmDash page
  using real Blocks, Commerce catalog and managed-SKU identity, and Inventory
  registration, opening balance, read, adjustment, and restore.
- `xapi568-proof-003`: the starter carries `FEATURE_MAP.md`, feature co-location,
  `bin/verify-web`, a repo-local verification skill, exact source pins, typed
  fail-closed behavior, and desktop/mobile browser evidence.

## Exact upstream inputs

- Blocks: `82a31183cc06ae0fc5b4829f5a8875753ecde10a`
- Commerce: `9fd24c6a13a4a4d332109e2d4541b05ec5f83786`
- Inventory: `d735b180b3f4ed911667586f5131ff1727e46546`
- EmDash: `0.35.0`

Commerce is prepared as an ignored detached checkout because its current
package manifest exposes only an absent `dist/`. Inventory is pinned to the
provisional PR #14 source head needed for ordinary adjustment. Neither adapter
is represented as a production release or persistence layer.

## Implementation references

- `src/features/store-shell/`
- `src/features/managed-product-availability/`
- `src/pages/index.astro`
- `src/pages/api/proof/stock.ts`
- `src/live.config.ts`
- `seed/seed.json`
- `tests/unit/managed-product-availability.test.ts`
- `tests/e2e/managed-product-availability.spec.ts`
- `FEATURE_MAP.md`
- `bin/verify-web`
- `skills/managed-product-verification/SKILL.md`

## Verification

Command:

```text
mise x node@22.23.2 -- corepack pnpm@11.9.0 run verify:full
```

Result: pass.

- Astro check: 26 files, 0 errors, 0 warnings, 0 hints.
- Unit behavior: 3 tests passed, including idempotent command replay,
  conflicting-command rejection, and proof-route `404` outside proof mode.
- Preserved workflow tests: 6 passed.
- Feature/source-pin audit: passed.
- Astro server build: passed. Vite reported one non-fatal chunk-size warning.
- Playwright: desktop Chromium and Pixel 7 viewport both passed.
- Both render real `dinkus.page-hero` and `dinkus.fact-rail` roots, Commerce SKU
  `DINKUS-DEMO-001`, Inventory identity `dinkus-inventory-sku-demo`, and the
  Inventory sequence `8 -> 5 -> 8` with monotonically increasing versions.
- Both assert readable hero-action colors, no document horizontal overflow,
  and no fact-rail overflow.
- A clean-source preparation check removed the ignored Commerce checkout and
  proved `pnpm verify:quick` recreates the exact pinned commit before checks.

Renderer: Astro 7.1.3 development server with EmDash 0.35.0, Playwright 1.61.1,
headless Chromium desktop and emulated Pixel 7. This proves those browser
surfaces only; it is not physical-device or cross-browser proof.

## Direct visual inspection

The initial, changed, and restored captures were inspected directly. The first
green browser run exposed a clipped third fact on mobile and a dark-on-dark hero
action. The store theme was repaired, the fact rail was made responsive, and
both viewport sets were regenerated and re-inspected. The accepted captures
show a readable action, all three composition facts, the managed product panel,
and stock states without clipping.

Ignored working captures and assertion JSON live under
`runs/managed-product-availability-20260829/browser/`. Their exact hashes are
recorded in `artifact-sha256.txt`; the media is not added to the product Git
history.

## Gates and remaining risk

- No cart, checkout, price, payment, shipping, deployment, publication, merge,
  production mutation, or persistent production adapter was added or claimed.
- `/api/proof/stock` returns `404` outside explicit proof mode.
- Exact-source review follows the separately authorized local delivery commit
  and is recorded in a dedicated review artifact.
- The template's final visual language remains intentionally unresolved in
  `design.md`.
