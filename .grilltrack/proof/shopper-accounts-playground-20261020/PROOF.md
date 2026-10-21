# Shopper Accounts & Playground Dual-Path Sign-In Proof — 2026-10-21

Repository: `dinkuskit/template-store`
Branch: `codex/shopper-accounts-playground-20261020`
Commerce pin: `c42597bddd35d949f4e69f8ca97cc26206200da0` (`dinkuskit/commerce#152`)

## Contract Verified

1. **Commerce Source Pin & Account Routes**:
   - `@dinkuskit/commerce` pinned to `c42597bddd35d949f4e69f8ca97cc26206200da0`.
   - Registry runtime routes `/_emdash/api/plugins/r_gshdrqaldna3r7sn/account/sign-in/start`, `/account/sign-in/verify`, `/account/orders`, `/account/profile`, and `/account/sign-out` are wired across both the proof runtime and the Cloudflare Worker playground runtime (`src/playground-worker.ts`, `src/features/shopper-account/playground-runtime.ts`, `src/features/playground-checkout/commerce-entry.ts`).
   - Dynamic per-request origin resolution (`withShopperAccountRequest` + `DINKUS_PLAYGROUND_ACCOUNT_ORIGIN`) admits `https://playground.dinkuskit.com` in production and loopback in local proof mode, keeps PR preview hosts (`https://pr-<N>.playground.dinkuskit.com`) closed with a clear `"Accounts aren't available in a PR preview"` notice (`isPlaygroundPreviewHost`), and fails closed (`503 UNAVAILABLE`) when unconfigured.
2. **Storefront Header & `/account` Surface (`dinkus.shopper-account`)**:
   - `Account` link placed next to `Cart` in `src/features/store-shell/StoreHeader.astro`, fitting 320px narrow mobile viewports without horizontal overflow.
   - `/account/` canonicalizes to `/account` (301 redirect).
   - `/account` exposes:
     - **Path 1 — Verified Email Sign-In + Updates Opt-In**: Sends a 6-digit OTP via Cloudflare `send_email` (`EMAIL`, from `accounts@dinkuskit.com`) only when `optInUpdates: true` is checked on playground, verifies the 6-digit code, and records the verified opt-in lead (`email`, `first_verified_at`, `last_verified_at`, `opt_in_source = 'playground-account-otp'`, `verification_count`) to durable `PLAYGROUND_LEADS_DB` (`EmDashPreviewDB` SQLite Durable Object key `"dinkuskit:playground:verified-leads"`, or D1). If durable lead persistence fails on `sign-in/verify`, the newly minted session is immediately revoked (`revokeShopperSessionById`) and `503 UNAVAILABLE` is returned without a capability token.
     - **Path 2 — Instant Demo Sign-In (Opt-Out)**: `POST /api/account/demo-session` mints a store-local shopper session for `shopper@example.com` with pre-seeded paid order `#1001` (`ord_demo_shopper_1001`, `$38.00`) and delivery address in the visitor's sandbox DB while recording zero rows to `PLAYGROUND_LEADS_DB` and preserving any pre-existing shopper orders (`ord_pre_upgrade_1000`, `#1002`).
     - **Signed-In Dashboard**: Focuses `"Welcome, <email>"` on sign-in, displays order history (`account/orders`), edits and persists the saved shipping address and optional phone (`account/profile`), preserves dashboard load error banners on `loadSignedInDashboard` failure, and supports sign-out (`account/sign-out`).
3. **Cart Checkout Prefill (`dinkus.guest-cart`)**:
   - Visiting `/cart` with an active shopper session automatically prefills empty contact email and shipping address fields from the shopper profile while keeping them editable before checkout.

## Live HTTP Authority-Chain & Existing-State Compatibility Proof (`pnpm verify:playground-account-http`)

Command: `node scripts/verify-playground-account-http.mjs` (`PASS_PLAYGROUND_HTTP_SHOPPER_ACCOUNT`, 47 HTTP cases across `live`, `restarted`, `expired`, and `missing-origin` phases):

```json
{
  "live:pre-upgrade-seed:visitorA": { "status": 200, "errorCode": null, "orderIds": ["ord_pre_upgrade_1000"], "profileLine1": null, "signedOut": null },
  "live:demo-session:visitorReset-before-reset": { "status": 200, "errorCode": null, "orderIds": null, "profileLine1": "742 Evergreen Terrace", "signedOut": null },
  "live:registry:orders:own-token-after-playground-reset": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "live:native:orders:own-token-after-playground-reset": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "live:demo-session:visitorA": { "status": 200, "errorCode": null, "orderIds": null, "profileLine1": "742 Evergreen Terrace", "signedOut": null },
  "live:registry:profile-write:visitorA": { "status": 200, "errorCode": null, "orderIds": null, "profileLine1": "900 Durable Ave", "signedOut": null },
  "live:registry:otp-start:without-optin-refused": { "status": 400, "errorCode": "OPT_IN_REQUIRED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "live:registry:otp-start:with-optin": { "status": 200, "errorCode": null, "orderIds": null, "profileLine1": null, "signedOut": null },
  "live:registry:otp-verify:with-optin": { "status": 200, "errorCode": null, "orderIds": null, "profileLine1": null, "signedOut": null },
  "live:leads-db:after-first-otp": { "status": 200, "errorCode": null, "orderIds": null, "profileLine1": null, "signedOut": null, "lead": { "email": "verified.lead@example.com", "firstVerifiedAt": "2026-10-21T13:42:25.026Z", "lastVerifiedAt": "2026-10-21T13:42:25.026Z", "optInSource": "playground-account-otp", "verificationCount": 1 } },
  "live:registry:orders:authorized": { "status": 200, "errorCode": null, "orderIds": ["ord_demo_shopper_1001", "ord_pre_upgrade_1000"], "profileLine1": "900 Durable Ave", "signedOut": null },
  "live:registry:profile:authorized": { "status": 200, "errorCode": null, "orderIds": null, "profileLine1": "900 Durable Ave", "signedOut": null },
  "live:registry:orders:foreign-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "live:registry:profile-read:foreign-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "live:registry:profile-write:foreign-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "live:registry:orders:reset-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "live:native:orders:authorized": { "status": 200, "errorCode": null, "orderIds": ["ord_demo_shopper_1001", "ord_pre_upgrade_1000"], "profileLine1": "900 Durable Ave", "signedOut": null },
  "live:native:profile:authorized": { "status": 200, "errorCode": null, "orderIds": null, "profileLine1": "900 Durable Ave", "signedOut": null },
  "live:native:orders:foreign-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "live:native:profile-read:foreign-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "live:native:profile-write:foreign-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "live:native:orders:reset-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "live:registry:profile-write:cross-origin": { "status": 403, "errorCode": "ORIGIN_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "live:registry:sign-out:otp-session": { "status": 200, "errorCode": null, "orderIds": null, "profileLine1": null, "signedOut": true },
  "live:registry:orders:after-sign-out": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "restarted:registry:orders:authorized": { "status": 200, "errorCode": null, "orderIds": ["ord_demo_shopper_1001", "ord_pre_upgrade_1000"], "profileLine1": "900 Durable Ave", "signedOut": null },
  "restarted:registry:profile:authorized": { "status": 200, "errorCode": null, "orderIds": null, "profileLine1": "900 Durable Ave", "signedOut": null },
  "restarted:registry:orders:foreign-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "restarted:registry:profile-read:foreign-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "restarted:registry:profile-write:foreign-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "restarted:registry:orders:reset-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "restarted:native:orders:authorized": { "status": 200, "errorCode": null, "orderIds": ["ord_demo_shopper_1001", "ord_pre_upgrade_1000"], "profileLine1": "900 Durable Ave", "signedOut": null },
  "restarted:native:profile:authorized": { "status": 200, "errorCode": null, "orderIds": null, "profileLine1": "900 Durable Ave", "signedOut": null },
  "restarted:native:orders:foreign-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "restarted:native:profile-read:foreign-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "restarted:native:profile-write:foreign-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "restarted:native:orders:reset-visitor": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "restarted:leads-db:before-second-otp": { "status": 200, "errorCode": null, "orderIds": null, "profileLine1": null, "signedOut": null, "lead": { "email": "verified.lead@example.com", "firstVerifiedAt": "2026-10-21T13:42:25.026Z", "lastVerifiedAt": "2026-10-21T13:42:25.026Z", "optInSource": "playground-account-otp", "verificationCount": 1 } },
  "restarted:registry:otp-start:with-optin": { "status": 200, "errorCode": null, "orderIds": null, "profileLine1": null, "signedOut": null },
  "restarted:registry:otp-verify:with-optin": { "status": 200, "errorCode": null, "orderIds": null, "profileLine1": null, "signedOut": null },
  "restarted:leads-db:after-second-otp": { "status": 200, "errorCode": null, "orderIds": null, "profileLine1": null, "signedOut": null, "lead": { "email": "verified.lead@example.com", "firstVerifiedAt": "2026-10-21T13:42:25.026Z", "lastVerifiedAt": "2026-10-21T13:43:25.026Z", "optInSource": "playground-account-otp", "verificationCount": 2 } },
  "expired:registry:orders:authorized": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "expired:registry:profile:authorized": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "expired:native:orders:authorized": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "expired:native:profile:authorized": { "status": 401, "errorCode": "SESSION_DENIED", "orderIds": null, "profileLine1": null, "signedOut": null },
  "missing-origin:demo-session": { "status": 503, "errorCode": "UNAVAILABLE", "orderIds": null, "profileLine1": null, "signedOut": null },
  "missing-origin:registry:orders": { "status": 503, "errorCode": "UNAVAILABLE", "orderIds": null, "profileLine1": null, "signedOut": null }
}
```

## Verification Executed

1. **Unit & Workflow Checks (`bin/verify-web quick` + `pnpm verify:playground-config`)**:
   - `astro check`: `0 errors`, `0 warnings`.
   - `vitest run`: `48 passed (48)` test files (`396 passed` tests), including `tests/unit/shopper-account.test.ts` (7 tests), `tests/unit/playground-account-preview.test.ts` (2 tests), and `tests/unit/playground-existing-state.test.ts` (4 tests covering pre-upgrade shopper order `#1002` + demo order `#1001` survival across repeat seeding & isolate restart, plus cross-visitor, sign-out, and expiry refusal).
   - `node --test tests/workflows/*.test.mjs`: `97 passed, 0 failed`.
   - `scripts/verify-playground-config.mjs`: `Playground Wrangler config passed binding and domain policy checks.`
   - `scripts/check-features.mjs`: `feature audit: ok`.
   - `scripts/check-worktree-text.mjs`: `worktree text audit: ok`.
2. **Browser E2E & Full Verification (`pnpm verify` / `bin/verify-web full`)**:
   - Playwright (`chromium-desktop` and `chromium-mobile`): `65 passed, 9 skipped`.
   - `tests/e2e/shopper-account.spec.ts` verified on both desktop and mobile viewports (including `"Welcome, <email>"` focus announcement).
   - `tests/e2e/store-header-nav.spec.ts` verified `Shop`, `Account`, and `Cart` links remain on one header row at 320px width with zero horizontal overflow.
   - `bin/verify-site http://127.0.0.1:4640`: `passed (0 failure(s), 2 skip(s), 29 URL(s) checked)`.
