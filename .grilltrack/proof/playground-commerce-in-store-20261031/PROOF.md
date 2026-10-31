# The playground runs Commerce's Registry build in-store

Covers `playground-commerce-in-store-20261031`. Ronald agreed on 31 Oct 2026:
"Commerce goes in the same way as a third in-store plugin under
r_gshdrqaldna3r7sn — Agreed." It completes `template-one-build-registry-20261031`
for the playground, and is the step `playground-commerce-until-part-2-20261022`
and `playground-commerce-050-source-first-20261023` planned: the playground's
admin is now a real store's.

## What changed

- **Install.** `scripts/prepare-playground-plugins.mjs` copies the paired
  Commerce build (the `package.json` pin, `v0.7.0`) beside Payments and Ship;
  `playgroundRegistryPlugins()` installs all three in-store under their Registry
  ids, Commerce as `r_gshdrqaldna3r7sn`. The native `dinkusCommerce()` mount, the
  playground's native Commerce entry and checkout host, and
  `DINKUS_CATALOG_PROFILE=native-development` are gone.
- **Seed.** Each visitor's store is seeded through Commerce's own routes: the
  storage indexes EmDash builds on a scheduler tick are built first (Commerce
  proves its `commandId` and `skuKey` unique indexes before every create), the
  merchant settings are saved once, the demo catalog is created, Commerce is
  connected to the pretend DinkusKit.com, and the two sample orders are made.
- **Pretend DinkusKit.com.** It answers Commerce's checkout settings and its
  checkout pass only when the playground's checkout is fully configured (the
  same test the middleware admits checkout by), and every Payments call Commerce
  makes passes the playground's checkout guard: session and lookup only, the
  binding check answered locally, the visitor's IP forwarded, each attempt bound
  to the visitor session that started it.
- **Routes.** Checkout, status recovery and shopper-account routes target the
  Registry id only; unconfigured playground checkout routes are refused before
  Commerce; `/api/checkout/status` dispatches to the in-store Commerce, which has
  no Registry manifest (`canDispatchInstalledGuestCheckout` `inStore`).
- **Banners.** Every storefront page judges the playground's checkout on the
  environment the checkout routes are gated on, not on the Site URL the Worker
  derives for EmDash (`playgroundEnvOf`); a local proof's process environment
  never supplies that derived URL.
- **Mail.** A playground mail provider delivers shopper email through EmDash's
  email pipeline.

## Proof (31 Oct 2026, Node 24.22.0, branch `claude/adoring-clarke-m3xl6u`)

| Check | Result |
| --- | --- |
| `pnpm verify` (`bin/verify-web full`: type check, unit, workflow and audit checks, build, desktop and phone browser tests, site verifier) | `verify-web: full passed`; Playwright 81 passed, 9 skipped |
| `pnpm exec vitest run` | 60 files, 562 tests passed |
| `pnpm exec astro check` | 0 errors, 0 warnings |
| `node --test tests/workflows/*.test.mjs` | 0 failed |
| `node scripts/check-features.mjs`, `node scripts/check-worktree-text.mjs`, `git diff --check` | clean |
| `node scripts/verify-playground-config.mjs` | passed |
| `pnpm verify:playground-http` (built Worker under `wrangler dev`, local Payments stand-in) | `PASS_PLAYGROUND_HTTP_PAID_ORDER`: a configured visitor's paid TEST order is confirmed through `/api/checkout/status` and Commerce's own status route, also after a restart; foreign, reset, unbound and expired visitors are refused before any Payments call; without the trusted origin the cart shows checkout unavailable and prepare and start are refused with 0 Payments calls |
| `pnpm verify:playground-account-http` (built Worker) | `PASS_PLAYGROUND_HTTP_SHOPPER_ACCOUNT`, 26 cases: instant demo account, profile save, verified OTP sign-in with opt-in and durable lead capture (a second verification after a restart), sign-out; foreign, reset, cross-origin and signed-out sessions refused with nothing disclosed; a missing account origin closes the instant demo account |
| Built-Worker smoke (fresh visitor) | home `data-catalog-guidance-state="ready"`; Commerce Settings "Connected to DinkusKit.com, store playground."; Commerce Orders lists the two TEST sample orders; the tour widget shows its next step; Ship opens on Connect |

Commerce's Registry routes refuse in-band (`{ ok: false, error }`, HTTP 200),
as in every store, and the account page reads the profile with the orders;
the account proof checks exactly that. Commerce keeps its own clock: its
30-second sign-in code cooldown is waited out in real time, and its 30-day
session expiry is Commerce's to prove.

## Not proved here

- Checkout against the real Payments service and Stripe TEST: it needs the
  playground's provisioned key, so it is proved on the deployed preview.
- The Worker Preview browser proof, which CI runs once the PR is open.
