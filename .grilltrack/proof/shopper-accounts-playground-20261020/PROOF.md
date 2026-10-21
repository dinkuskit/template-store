# Shopper Accounts & Playground Dual-Path Sign-In Proof — 2026-10-20

Repository: `dinkuskit/template-store`
Branch: `codex/shopper-accounts-playground-20261020`
Commerce pin: `c42597bddd35d949f4e69f8ca97cc26206200da0` (`dinkuskit/commerce#152`)

## Contract Verified

1. **Commerce Source Pin & Account Routes**:
   - `@dinkuskit/commerce` pinned to `c42597bddd35d949f4e69f8ca97cc26206200da0`.
   - Registry runtime routes `/_emdash/api/plugins/r_gshdrqaldna3r7sn/account/sign-in/request`, `/account/sign-in/verify`, `/account/orders`, `/account/profile`, and `/account/sign-out` are wired across both the proof runtime and the Cloudflare Worker playground runtime (`src/playground-worker.ts`, `src/features/shopper-account/playground-runtime.ts`).
2. **Storefront Header & `/account` Surface (`dinkus.shopper-account`)**:
   - `Account` link placed next to `Cart` in `src/features/store-shell/StoreHeader.astro`, fitting 320px narrow mobile viewports without horizontal overflow.
   - `/account/` canonicalizes to `/account` (301 redirect).
   - `/account` exposes:
     - **Path 1 — Verified Email Sign-In + Updates Opt-In**: Sends a 6-digit OTP via Cloudflare `send_email` (`EMAIL`, from `accounts@dinkuskit.com`) when `optInUpdates: true` is checked on playground, verifies the 6-digit code, and records the verified opt-in lead (`email`, `first_verified_at`, `last_verified_at`, `opt_in_source = 'playground-account-otp'`, `verification_count`) to `PLAYGROUND_LEADS_DB` (`playground_email_leads`).
     - **Path 2 — Instant Demo Sign-In (Opt-Out)**: `POST /api/account/demo-session` mints a store-local shopper session for `shopper@example.com` with pre-seeded paid order `#1001` (`ord_demo_shopper_1001`, `$48.00`) and delivery address in the visitor's sandbox DB while recording zero rows to `PLAYGROUND_LEADS_DB`.
     - **Signed-In Dashboard**: Displays order history (`account/orders`), edits and persists the saved shipping address and optional phone (`account/profile`), and supports sign-out (`account/sign-out`).
3. **Cart Checkout Prefill (`dinkus.guest-cart`)**:
   - Visiting `/cart` with an active shopper session automatically prefills empty contact email and shipping address fields from the shopper profile while keeping them editable before checkout.

## Verification Executed

1. **Unit & Workflow Checks (`bin/verify-web quick`)**:
   - `astro check`: `0 errors`, `0 warnings`.
   - `vitest run`: `47 passed (47)` test files, including `tests/unit/shopper-account.test.ts` (7 tests covering OTP request/verify, `PLAYGROUND_LEADS_DB` upsert only after verified opt-in, instant demo session seeding `#1001` with zero lead capture, and `send_email` payload generation).
   - `node --test tests/workflows/*.test.mjs`: `97 passed, 0 failed`.
   - `scripts/check-features.mjs`: `feature audit: ok`.
   - `scripts/audit-worktree-text.mjs`: `worktree text audit: ok`.
2. **Browser E2E & Full Verification (`pnpm verify` / `bin/verify-web full`)**:
   - Playwright (`chromium-desktop` and `chromium-mobile`): `65 passed, 9 skipped`.
   - `tests/e2e/shopper-account.spec.ts` verified on both desktop and mobile viewports:
     - Path 2 instant demo shopper sign-in (`shopper@example.com`, order `#1001` `$48.00`, saved address edit + reload persistence, zero leads recorded, `/cart` contact + address prefill).
     - Path 1 verified 6-digit email OTP sign-in (`optInUpdates: true`, 6-digit code verification, lead capture in `playground_email_leads`, profile save, `/cart` prefill).
   - `tests/e2e/store-header-nav.spec.ts` verified `Shop`, `Account`, and `Cart` links remain on one header row at 320px width with zero horizontal overflow.
   - `bin/verify-site http://127.0.0.1:4640`: `passed (0 failure(s), 2 skip(s), 29 URL(s) checked)`.
