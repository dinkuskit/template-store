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

## Expiry and token replay (observed live, short TTL)

Second run, same day, on the review-fix head (adds the Content-Length fix).
EmDash hard-codes the playground TTL at 3600 seconds, so for this run only the
built `dist/server/virtual_astro_middleware.mjs` was edited from
`DEFAULT_TTL = 3600` to `DEFAULT_TTL = 20`, then restored. Nothing else changed
and nothing was committed from that edit. `.wrangler/state` was cleared first.

| Step | Result |
| --- | --- |
| Visitor A opens `/playground` | cookie `Max-Age=20`; init 200 |
| A creates page `expiry-marker` | 201 |
| A lists pages before the TTL | `expiry-marker`, `home` |
| 35 s later, same Worker process: A lists pages with the same token | 404 `COLLECTION_NOT_FOUND`; the log shows `no such table` for `ec_pages`, `_emdash_collections`, `options` |
| Same: A tries to write a page | 500, nothing written (the tables no longer exist) |
| Same: A opens `/_emdash/admin` | 200 admin shell only; every data call behind it fails as above |
| Worker restarted, A replays the expired token | 200, pages `home` only: a freshly seeded store, `expiry-marker` gone |
| Same: A writes `after-expiry` | 201 in that fresh store |
| 30 s later: A lists pages again | 404 `COLLECTION_NOT_FOUND`: the re-created store expired on its own alarm |

What this shows: when the TTL alarm fires, EmDash drops every table in that
visitor's Durable Object, so nothing a visitor wrote survives expiry. Replaying
an expired token never reaches earlier data: it either fails against the empty
store or, on a fresh Worker, gets a new seeded sandbox with a new TTL, which is
exactly what any new visitor gets. The token is a random server-minted ULID in
an HttpOnly cookie, not an account, so there is nothing to reassign: a stolen
or guessed token only ever reaches that one throwaway store (see the guessed
token row above), and it is still blocked from the escape routes listed above.

Upstream code behind this (EmDash 1.2.0): `dist/db/playground-middleware.mjs`
calls `setTtlAlarm(ttl)` before seeding; `dist/do-class-*.mjs` `alarm()` calls
`dropAllTables()`.

## Limits of this proof

Local `wrangler dev` only. The expiry run used a 20-second TTL; production uses EmDash's 3600 seconds. It does not prove the Cloudflare deployment, the
`playground.dinkuskit.com` route, the live rate limits or preview links; those
wait for the owner's Cloudflare setup approval (template-store #57).
No product decision or GrillTrack ledger entry was changed.
