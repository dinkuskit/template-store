# Registry builds from Git

Use a dedicated Worker for this branch. Plain `pnpm build` selects the default
Node shipping profile; it does not select Cloudflare. A Cloudflare build using
the default `wrangler.jsonc` selects the separate native demo. Neither is this
dedicated Registry deployment path. Keep automatic builds disabled until the
target resources, build inputs and commands are configured.

## Cloudflare Workers Builds settings

- Root directory: repository root.
- Production branch: the explicitly selected test-store branch, on its own Worker.
- Build command: `pnpm install --frozen-lockfile && pnpm run build:registry`.
- Deploy command: `pnpm exec wrangler deploy --config dist/server/wrangler.json`.
- Disable builds for other branches. Do not enable preview URLs or use a
  production store's Worker for this test branch.
- Use Node 22.23.2 and pnpm 11.9.0, matching `.nvmrc` and `packageManager`.

Do not assume a Git setup form selects the intended branch. Workers Builds
provides `WORKERS_CI_BRANCH` and `WORKERS_CI_COMMIT_SHA`; this command requires
them to match private `DINKUS_EXPECTED_BRANCH` and `DINKUS_EXPECTED_COMMIT`
inputs before writing a config or building. Set the expected commit to the
reviewed full SHA. An absent branch selector is a setup blocker, not permission
to deploy the default branch. A subsequent source change deliberately fails
until the expected SHA is updated after review.

`build:registry` prepares the pinned source dependency, validates the inputs
below, writes ignored `runs/registry/wrangler.jsonc`, and builds with that exact
config. It forces the shipping profile, Inventory/proof mode off, LOADER on,
and a shared build/runtime site origin. Missing inputs fail before a build;
there is no fallback to the demo config. The command does not provision,
deploy, install plugins, or contact a credential manager.

Cloudflare build variables are distinct from runtime variables. These
non-secret inputs are serialized into the generated deployment config:

| Build variable | Required value |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | Exact target account's 32-character hexadecimal ID |
| `DINKUS_WORKER_NAME` | Dedicated Worker name, matching the connected Worker |
| `DINKUS_D1_DATABASE_NAME` | Dedicated precreated D1 database name |
| `DINKUS_D1_DATABASE_ID` | That D1 database's UUID |
| `DINKUS_R2_BUCKET_NAME` | Dedicated precreated R2 bucket name |
| `DINKUS_SESSION_KV_ID` | Dedicated precreated KV namespace's 32-character hexadecimal ID |
| `DINKUS_RATE_LIMIT_NAMESPACE_ID` | Dedicated numeric rate-limit namespace ID |
| `EMDASH_SITE_URL` | Exact HTTPS origin, without path, query, fragment or credentials |
| `DINKUS_EMDASH_ADMIN_ENABLED` | Optional: defaults to `0`; only set `1` after the outer admin/setup guard is verified |
| `DINKUS_EXPECTED_BRANCH` | Required on Workers Builds: exact intended branch |
| `DINKUS_EXPECTED_COMMIT` | Required on Workers Builds: reviewed full 40-character source SHA |

Keep real account/resource identifiers in private build settings. Do not add
secret values to these inputs. In particular, `EMDASH_ENCRYPTION_KEY` belongs in
the Worker's runtime secret settings through the approved secret process; it
is required for Commerce/Payments secret settings but is never emitted by this
generator.

## Resource and activation order

1. Verify the exact account, paid Worker Loader entitlement and collisions.
2. Create dedicated D1, R2 and KV resources; record their identities for cleanup.
   Supply actual IDs so deployment cannot silently provision or reuse storage.
3. Configure the build settings above with admin disabled and no hostname route.
4. Inspect the selected build and run its dry-run before activating it. The
   generated Worker includes DB, MEDIA, SESSION, LOADER, RATE_LIMITER, ASSETS,
   the adapter's IMAGES binding, PluginBridge and the minutely scheduler.
5. Protect admin/setup on the intended hostname before routing traffic and
   enabling admin. Workers.dev and preview URLs remain disabled.
6. Use normal EmDash authentication, then install the actual signed Registry
   plugins. Check installed identities and manifests before adding exact public
   endpoint exceptions. Never use a broad plugin/API bypass.

GitHub App installation is repository access, not proof that the Cloudflare
build deployment identity has the required D1/R2/KV/Workers permissions. Any
new token, permission or account prompt retains the owner's gate.

## Command contract

`node scripts/build-registry.mjs --dry-run --json` validates without writing or
building. `--config-only --json` writes only the ignored configuration. With no
mode flag it writes and builds. `--help` always succeeds. Unknown or conflicting
flags and invalid inputs exit 2; build failures retain the build's nonzero exit.
JSON mode emits only the receipt on stdout and routes build diagnostics to
stderr. No interactive prompts or remote mutations are implemented.

After building, use `pnpm exec wrangler deploy --dry-run --config
dist/server/wrangler.json` for a credential-free bundle check. A build or dry-run
does not establish deployment, Registry installation, or a successful payment.

Configuration follows the installed EmDash 1.2.0 / Cloudflare adapter and
Wrangler 4.145.0 schemas. Cloudflare's [Workers Builds settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
describe build/deploy commands and the separation of build and runtime variables.


## Opt-in Cloudflare Access authentication

Only the generated Registry configuration supports this opt-in. Set build
variables `DINKUS_REGISTRY_ACCESS_ENABLED=1` and
`DINKUS_REGISTRY_ACCESS_TEAM_DOMAIN=<team>.cloudflareaccess.com`. The generated
config carries that selection into the build and runtime; default Node and
native demo builds keep their existing authentication. Leave the flag unset
or `0` to retain passkeys.

Provision `CF_ACCESS_AUDIENCE` as a runtime secret using the approved process.
Its value is never needed by this generator or serialized into the config.
Retain the existing `EMDASH_ENCRYPTION_KEY`, storage bindings and test hostname
on redeploy; do not recreate resources or keys. Keep the existing hostname
mapping and verified Access app/policy when deploying the updated bundle.

The version-matched `access()` adapter verifies JWT signature, issuer and
application audience, then fetches the Access email identity. EmDash 1.2.0 does
not map service-token `common_name` identities to users. A service token that
passes the outer guard is not proof of an authenticated EmDash user.

Keep the outer Access application restricted to the intended bootstrap email
until its first login is proved. EmDash promotes the **first stored user** to
Admin regardless of the adapter default. Subsequent users receive Subscriber
(role 10); role and name synchronization are disabled. Existing users retain
their roles and disabled-user checks. This is not an email-to-Admin mapping.
After login, verify the exact email and role through the authenticated admin
user interface before any privileged action.

A half-finished passkey wizard does not prove a user exists. In external mode,
complete the supported site setup if still requested; that marks setup complete,
then the first authenticated admin request provisions the user. Do not insert
user/options rows or inject sessions to skip this flow.

EmDash checks public Registry route metadata before demanding external auth.
Outer Access still covers those paths unless a separately reviewed exact-path
exception exists. Verify the installed plugin ID and declared public routes
before changing that policy; never add a wildcard bypass. Test anonymous admin
denial, authorized email/role, and intended public catalog behavior separately.

Sources: [EmDash authentication](https://docs.emdashcms.com/guides/authentication/)
and the resolved 1.2.0 `@emdash-cms/cloudflare/src/auth/cloudflare-access.ts`,
`emdash/src/astro/middleware/auth.ts`, `setup.ts`, and setup API routes.

## Registry sandbox request budget

The Registry Cloudflare profile uses the stock EmDash Cloudflare runner with a
32-subrequest limit for every installed sandbox plugin. A catalog admin write
followed by its list render needs 19 bridge calls; the observed choice-edit flow
needs 31. The default limit of 10 can allow a write to persist before its response
render fails. This cap supports those measured flows, not arbitrary catalog size.

The wrapper changes only `limits.subrequests`. The stock 50ms CPU and 30-second
wall-time defaults, capability checks, blocked direct outbound access, storage
and callbacks remain intact. Node and other Cloudflare profiles keep their
existing runners. A reported failure after a write is not proof of rollback;
inspect and reuse the persisted record before retrying creation.

## Checkout status proxy origin

The browser-facing `/api/checkout/status` endpoint requires an Origin matching
the explicit `EMDASH_SITE_URL` and request URL. It forwards only that validated
canonical origin and the existing checkout capability to Commerce's fixed
status endpoint, without browser cookies, authorization, or redirect following.
Missing/foreign origin and contradictory Fetch Metadata fail closed. This
preserves Commerce's same-origin admission; status does not start a payment.
