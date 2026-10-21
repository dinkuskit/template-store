# US delivery region checkout companion

Base: `b80a5306844a9bea7a9504542a1878e91d28a2e8`.

The assigned Commerce policy requires a region for US physical delivery and
keeps it optional for non-US delivery. The template now labels that condition
and refuses a blank US region through the existing cart alert path before
checkout starts. Commerce remains the authority for accepted region values.
The internal client reader is exported for direct unit testing; the public
guest-cart entry and checkout DTO are unchanged.

| Requirement | Expected case | Evidence |
| --- | --- | --- |
| Clear US requirement | Physical delivery field identifies the US requirement | Updated `GuestCart.astro`; desktop/mobile label assertion passed |
| Missing US region refused | Otherwise populated US address has empty or whitespace region | Two direct client cases pass; desktop/mobile browser alert and zero-start assertion passed |
| Region forwarded | Populated US address uses `NY` | Direct client case passes; desktop/mobile browser start-payload assertion passed |
| Non-US optionality retained | Non-US contact omits region | Direct client case passes; no country option enabled |
| Digital checkout unchanged | Digital cart has email and stale delivery fields | Direct client case proves delivery is never read; physical-to-digital desktop/mobile browser payload assertion passed |

## Observed checks

Node `24.22.0`, pnpm `11.9.0`, Python `3.12.9`.

- `./scripts/agent-skills`: installed the repository-pinned skills.
- `./scripts/grilltrack --project . validate`: `valid`.
- `pnpm exec vitest run tests/unit/guest-checkout-contact.test.ts tests/unit/guest-checkout-recovery.test.ts tests/unit/guest-cart.test.ts`: 3 files, 32 tests passed.
- `pnpm exec astro check`: 228 files, 0 errors, 0 warnings, 2 pre-existing deprecation hints.
- `pnpm exec vitest run --exclude tests/unit/seed-demo-repeat.test.ts`: 48 files, 399 tests passed.
- `pnpm exec vitest run`: complete suite passed, 49 files and 401 tests, including the local seed refusal/repeat cases.
- `pnpm build` with the Node adapter: passed; existing large-chunk notice remains informational.
- Feature audit, worktree text audit and `git diff --check`: passed.

The local seed runtime's Wrangler HTTP/inspector ports are chosen through loopback port 0;
the local-only platform proxy also uses Miniflare's port-0 default.

## Completed full verification

`pnpm verify` exited 0 on source `e6411addb5e2b1e3a3b393209f0572f969a5a10e`. It passed all 401 unit tests, typecheck, the Node build, repository audits, 97 workflow tests and 66 browser tests across the configured desktop/mobile projects. The checkout-start test passed in both shipping desktop and shipping mobile: the visible US requirement, missing-region message with zero start calls, valid region forwarding and physical-to-digital omission were observed.

Existing exclusions remain explicit: 2 optional workflow tests did not run in the default environment. The browser runner reported 8 skips: two Cloudflare-only cases without `CLOUDFLARE_E2E=1`, two retired legacy polling cases, two retired plugin-editor cases, one duplicate mobile built-server proof and one duplicate mobile screenshot proof. The changed checkout-start behavior ran on both viewports. No skip or forced-exit was added to repair a failure.

The final built-site smoke checked 29 URLs with zero failures and two sitemap skips because this disposable origin exposed no usable same-origin sitemap entries. Its product/feed checks included expected fail-closed output with no installed catalog; this is not evidence of a populated released catalog. Populated catalog behavior is covered separately by the browser suite.

These are local Node-adapter and synthetic offline-checkout proofs. They do not prove a new released Commerce artifact pairing, a real Stripe transaction, Registry publication or deployment. Dependency/source pins, enabled country options, account/category code and deployment configuration are unchanged. The local screenshot proof remains under ignored `runs/`; routine screenshots are not committed into the product repository.
