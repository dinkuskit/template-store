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
| Clear US requirement | Physical delivery field identifies the US requirement | Updated `GuestCart.astro`; desktop/mobile label assertion prepared |
| Missing US region refused | Otherwise populated US address has empty or whitespace region | Two direct client cases pass; browser alert and zero-start assertion prepared |
| Region forwarded | Populated US address uses `NY` | Direct client case passes; browser start-payload assertion prepared |
| Non-US optionality retained | Non-US contact omits region | Direct client case passes; no country option enabled |
| Digital checkout unchanged | Digital cart has email and stale delivery fields | Direct client case proves delivery is never read; physical-to-digital browser payload assertion retained |

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

## Remaining proof

`pnpm verify` is required before final closeout. Browser/SDK runtime is reserved
by the parent task; no browser result is claimed here. The prepared focused
browser command is:

```sh
pnpm exec playwright test tests/e2e/guest-checkout-feasibility.spec.ts \
  --grep 'checkout start sends delivery only while the cart needs it' \
  --project shipping-chromium-desktop --project shipping-chromium-mobile
```

The browser cases use the existing synthetic offline checkout harness. They
do not prove a new released Commerce artifact pairing, a Stripe transaction,
Registry publication or deployment. Dependency/source pins, enabled country
options, account/category code and deployment configuration are unchanged.
