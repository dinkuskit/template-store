# Registry Access opt-in — local proof

Base: `e27bde26968cab83b636e3044bf8371acd345cd3`.
Branch: `codex/sm0ky-registry-access-20261012`.
The containing commit identifies this candidate. No deployment or live identity claim.

## Change

Only the explicit Registry Cloudflare build can opt into the supported EmDash
`access()` adapter. Defaults remain passkey mode. The audience stays a runtime
secret reference, first-user provisioning stays upstream, later users receive
Subscriber (10), and role/name synchronization is disabled. No public-route
exception, user insertion, token mapping or session injection was added.

## Results

Node 22.23.2, pnpm 11.9.0, EmDash / Cloudflare adapter 1.2.0.

- `DINKUS_E2E_PORT=4747 DINKUS_SHIPPING_E2E_PORT=4748 VERIFY_SITE_PORT=4749 pnpm verify`: passed.
- Astro check: 163 files, zero errors/warnings, two existing deprecation hints.
- Unit tests: 219 passed. Workflow tests: 37 passed, including the selected
  profile, invalid configuration, least-privilege descriptor and installed
  adapter anonymous-request rejection checks.
- Browser tests: 33 passed, nine existing skipped cases; desktop and mobile.
  Site crawl: zero failures, four declared skips, seven URLs checked.
- Access-enabled `build:registry`: passed using synthetic non-secret resource
  identifiers and no audience/encryption secrets. Generated config asserts
  shipping mode, admin disabled, LOADER present, workers.dev/previews disabled,
  and no serialized audience/encryption secret.
- Built descriptor inspected: selected team, runtime audience reference,
  defaultRole 10 and syncRoles false present.
- `pnpm exec wrangler deploy --dry-run --config dist/server/wrangler.json`:
  passed, 18322.98 KiB upload / 4706.94 KiB gzip. No remote deployment.
- `git diff --check`: passed.

Raw local logs: `runs/access-auth-proof/verify.log`, `access-build.log`,
`access-dry-run.log`, `bundle-check.json`. The ignored build driver
`runs/access-auth-proof/build-access.mjs` records synthetic inputs.

## Source fidelity

Resolved upstream source SHA-256:

- Cloudflare `src/auth/cloudflare-access.ts`:
  `71800e4ab33f300469f5b22adab25f3ba29b462a4cd11e945e6e40311c73c833`
- EmDash `src/astro/middleware/auth.ts`:
  `30b5afef2de77bf9c6b8226cb0b2645cb91e8b8dc4fe9b938796c1a909293af2`
- EmDash `src/astro/middleware/setup.ts`:
  `2691d43d71007b4c2150b8c70c69c5a2c4c12cce6f75a28a9ba7019cfbdea7ac`
- EmDash `src/astro/routes/api/setup/index.ts`:
  `ebcdd481c998ff4067999333606ea29882245bbd0ef4aaeaa6c672a5905d001d`

The adapter uses an email-bearing Access identity; service-token common_name
mapping is absent. Auth middleware delegates public routes by installed
metadata. The outer Access gate is a separate runtime policy.

## Remaining gates

Exact-head CI, OpenClaw and native ClawSweeper review; owner-approved merge and
deployment. Live browser proof must establish the intended email, first-user
Admin role (or inspect an existing user's role), anonymous admin denial and
installed Registry public-route behavior. This local evidence does not establish
those outcomes. Preserve the existing runtime encryption secret and hostname.
