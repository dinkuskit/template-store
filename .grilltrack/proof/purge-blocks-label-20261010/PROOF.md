# Purge the last dinkuskit/blocks labels

Follows the locked `retire-blocks-008` decision ("retire @dinkuskit/blocks
entirely"). The archived `dinkuskit/blocks` repository is reference only, but
the storefront still printed its retired commit `fe03bfac…` as a "Blocks" line
under "Exact package provenance" on demo.dinkuskit.com.

Changes:

- Managed and unmanaged product provenance lists, their types, their page
  sections and their two unit tests drop the `blocks` entry. Commerce and
  Inventory lines are unchanged and still match the installed pins.
- The copied presentation CSS layer is renamed `dinkus-blocks` to
  `store-blocks` in `global.css` and the three Portable Text components (same
  layer order, so the cascade is unchanged).
- `docs/implementation/managed-product-availability.md` and
  `docs/implementation/unmanaged-product-sellability.md` show the provenance
  contract as Commerce and Inventory only (ClawSweeper P2 on PR #54).
- `docs/v1-pairing.md` no longer calls the retired commit "historical style
  provenance"; it states the archived repository is not used anywhere.
- `scripts/check-features.mjs` keeps its guard that refuses
  `@dinkuskit/blocks` as a dependency.

Checks on this branch (Node 22.22.0, `pnpm install --engine-strict=false`):

- `node scripts/check-features.mjs`: feature audit ok
- `npx astro check`: 0 errors, 0 warnings
- `npx vitest run`: 172 passed, 1 failed. The failure is
  `tests/unit/seed-demo-repeat.test.ts`, which fails identically on main
  dd807e4 in this sandbox (no network to fonts.google.com); it does not touch
  provenance.
- `git grep -nIiE "dinkuskit/blocks|dinkus-blocks|fe03bfac" -- ':!.grilltrack'`
  leaves only the pairing doc's "not used" statements and the dependency guard.

GrillTrack history (ledger, lineage, earlier proof folders) is left as written.
