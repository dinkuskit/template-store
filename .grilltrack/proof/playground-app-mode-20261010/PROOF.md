# Playground app mode proof — 2026-10-10

Repository: `dinkuskit/template-store`. Branch: `cursor/playground-app-mode-83fc`.
Head under test: `c1e7d83` (Fix playground checkout assertion). Node 22.23.2.
EmDash `@emdash-cms/cloudflare` 1.2.0 (from the lockfile).

## What was run

1. `pnpm install --frozen-lockfile` and `pnpm prepare:sources`.
2. `pnpm exec astro build --config astro.playground.config.mjs`.
3. `pnpm exec wrangler dev --config dist/server/wrangler.json --port 8799`
   (local Durable Object, KV and rate limits; nothing deployed to Cloudflare).
4. A request script drove two separate anonymous visitors against
   `http://127.0.0.1:8799`. Each step and its observed response is below.
   Cookie token values are replaced with `<ULID-A>`, `<ULID-B>` and `<GUESS>`.

## Observed results

Before any session exists (no cookie), storage is never touched:

| Request | Result |
| --- | --- |
| `GET /_emdash/admin` | 302 to `/playground` |
| `GET /_emdash/api/content/pages` | 302 to `/playground` |

Two visitors get their own store:

| Step | Result |
| --- | --- |
| Visitor A `GET /playground` | `emdash_playground=<ULID-A>; Max-Age=3600; Path=/; HttpOnly; SameSite=Lax`; init 200 |
| Visitor B `GET /playground` | `emdash_playground=<ULID-B>` with the same attributes; init 200 |
| A and B tokens differ | true |
| A `POST /_emdash/api/content/pages` slug `visitor-a-marker` | 201, authorId `playground-admin` |
| A lists pages | `home`, `visitor-a-marker` |
| B lists pages | `home` only |
| Guessed token (A's token with its last character changed) lists pages | `home` only: a guess gets a fresh seeded store, never A's |
| A `GET /_playground/reset` | 302 to `/playground`, cookie deleted (`Expires=Thu, 01 Jan 1970`) |

Admin powers that would leave the sandbox are refused for visitor B, each with
403 `{"error":{"code":"PLAYGROUND_MODE","message":"Not available in playground mode"}}`:

- `POST /_emdash/api/users/invite`
- `GET /_emdash/api/setup/status`
- `POST /_emdash/api/plugins/install`
- `POST /_emdash/api/media/upload`
- `GET /_emdash/api/snapshot`
- `GET /_emdash/api/tokens/`

Storefront and checkout for visitor B:

| Request | Result |
| --- | --- |
| `GET /` | 200, `X-Robots-Tag: noindex, nofollow`, robots meta `noindex, nofollow` |
| `GET /checkout` | 404, `X-Robots-Tag: noindex, nofollow` |
| `GET /cart` | 200, noindex, shows checkout unavailable, `data-guest-checkout-admitted="false"` |
| `POST /_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare` | 405 "Native or source-alias checkout is not a supported install." |
| `POST /_emdash/api/plugins/r_gshdrqaldna3r7sn/checkout/guest/prepare` | 503 "Checkout is not available yet." |

No payment, coupon or Stripe binding exists in the playground build, and no
checkout path admits an order on either Commerce mount.

## Expiry (from upstream source, not observed live)

A one-hour wait was not run. The expiry comes from EmDash 1.2.0:

- `dist/db/playground-middleware.mjs`: `ensurePlaygroundInitialized` calls
  `setTtlAlarm(ttl)` on the visitor's Durable Object before seeding; the cookie
  carries the same `Max-Age=3600` seen above.
- `dist/do-class-*.mjs`: `setTtlAlarm` sets `ctx.storage.setAlarm(now + ttl)`, and
  `alarm()` calls `dropAllTables()`, which drops every user table in that store.

## Limits of this proof

Local `wrangler dev` only. It does not prove the Cloudflare deployment, the
`playground.dinkuskit.com` route, the live rate limits or preview links; those
wait for the owner's Cloudflare setup approval (template-store #57).
No product decision or GrillTrack ledger entry was changed.
