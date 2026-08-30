# Commerce #14 payment-foundation alignment proof

Date: 2026-08-30
Track: `gt-20260830190023-11b4b5`
Decision: `payment-foundation-alignment-004`
Baseline: `4bc9122b67f580b6ef7564bfbe81f8785aab52a0`
Upstream Commerce source: `530348c07769a010b0fa4ef24604292a4254eda0`
Source identity: assigned by the authorized delivery commit containing this
packet; terminal review is performed against that immutable pushed head

## Accepted boundary

Before checkout or payment-provider work, align template-store to Commerce
#14. The proof runtime must create Commerce's store-level Inventory
configuration and enter managed-SKU registration through
`configureCatalogItemInventory` with only `catalogItemId`. The disposable
memory layer may implement local storage and the Inventory provider port, but
the consumer must not call `startManagedSkuRegistration` directly. Preserve
the existing neutral Blocks, Commerce, and Inventory storefront and its
desktop/mobile `8 -> 5 -> 8` stock proof. Shipping remains deferred.

## TDD evidence

Red commands:

```text
node scripts/check-features.mjs
pnpm exec vitest run tests/unit/managed-product-availability.test.ts
```

The feature audit rejected the old Commerce pin, reported both missing official
action calls, and rejected the direct `startManagedSkuRegistration` bypass.
After preparing the old pinned source, the focused behavior test also failed
because it observed Commerce `9fd24c6...` instead of the required
`530348c...` provenance.

Green evidence:

```text
node scripts/check-features.mjs
pnpm exec vitest run tests/unit/managed-product-availability.test.ts
pnpm exec astro check
```

Result: feature audit passed, both focused behavior tests passed, and Astro
reported 26 files with zero errors, warnings, or hints.

## Implementation

- `package.json` and `scripts/prepare-source-deps.mjs` pin Commerce exactly to
  `530348c07769a010b0fa4ef24604292a4254eda0`.
- `src/features/managed-product-availability/runtime.ts` creates the store
  Inventory configuration, invokes `configureCatalogItemInventory` with only
  the catalog item ID, resolves the disposable Inventory provider through the
  configuration supplied by Commerce, refuses an unexpected provider
  reference, and uses the resulting Commerce-owned site, pool, and location
  binding for Inventory commands.
- `src/features/managed-product-availability/memory-catalog-storage.ts`
  supplies disposable catalog, store-configuration, and registration-claim
  storage with the exact unique-constraint identities expected by Commerce.
- `scripts/check-features.mjs` rejects a regression to the old source pin or
  lower-level registration bypass.
- `FEATURE_MAP.md`, the implementation plan, and the provenance assertion now
  describe the Commerce #14 consumer boundary.

## Full verification

Command:

```text
mise x node@22.23.2 -- corepack pnpm@11.9.0 run verify:full
```

The first browser attempt exposed an ignored-environment ABI mismatch because
`better-sqlite3` had been installed under Node 24 during a focused test. It was
rebuilt under the repository's required Node 22 runtime with:

```text
mise x node@22.23.2 -- corepack pnpm@11.9.0 rebuild better-sqlite3
```

The complete rerun passed:

- Commerce source preparation resolved exact head `530348c07769`.
- Astro check: 26 files, zero diagnostics.
- Vitest: 2 files and 3 tests passed.
- Preserved workflow suite: 6 tests passed.
- Feature and worktree-text audits passed.
- Astro server build passed with the pre-existing non-fatal chunk-size warning.
- Playwright desktop Chromium and mobile Chromium both passed.
- Desktop observed `8 -> 5 -> 8` at Inventory versions `1 -> 2 -> 3`.
- Mobile observed `8 -> 5 -> 8` at Inventory versions `3 -> 4 -> 5`.
- Both viewports rendered the real Blocks roots, Commerce SKU, Inventory SKU,
  and no horizontal or fact-rail overflow.

## Direct visual inspection

All six regenerated screenshots were inspected directly. Desktop and mobile
initial, changed, and restored states remain readable and unclipped. The stock
values visibly follow `8 -> 5 -> 8`, the mobile fact rail remains stacked
without overflow, and the accepted neutral visual contract is unchanged.

Ignored browser evidence remains under
`runs/managed-product-availability-20260829/browser/`:

| Capture | SHA-256 |
| --- | --- |
| desktop initial | `3537f0488bb40bc5f8850b4aaf5b708900f218578fddd9c6ad051f7604739f35` |
| desktop changed | `bdb8df6f811d6f671e4cce6bb9ed2a231aa3a3764f9c5cc026f57c3a11553fd0` |
| desktop restored | `eea4dce233a8507afcb2736f24e349470de549f25d66f81ade9ecc553947b62e` |
| mobile initial | `5fdcce090a27014232032ab6a1257dee2e8e4f024b1f57b780fad6d9f025cd5f` |
| mobile changed | `092772360cdd556a7b026dbb4d6864fc42da445675571d7cd29327d842957861` |
| mobile restored | `ccabe57075fa5cd1a5d365f099a26babfa52f818fcdca7c0bdc0d55df8981929` |

## Limits and gates

- This proves the official Commerce domain action and its `catalogItemId`-only
  input inside the local bootstrap. It does not add a visual Configure
  Inventory setup screen or exercise the authenticated Commerce HTTP route.
- The memory adapters remain local proof infrastructure, not production
  persistence or a fallback Inventory implementation.
- No price, cart, checkout, payment API, payment plugin, shipping code,
  deployment, publication, production mutation, or merge was added or
  performed.
- Bobby separately authorized the bounded local commit, push, and pull request
  on 2026-08-30. Exact-head review remains advisory and does not authorize a
  merge.
