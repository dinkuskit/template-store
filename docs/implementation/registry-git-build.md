# Registry builds from Git

Use a dedicated Worker for this branch. The repository's default `pnpm build`
and `wrangler.jsonc` remain the separate native demo; they are not the Registry
deployment path. Keep automatic builds disabled until the target resources,
build inputs and commands are configured.

## Cloudflare Workers Builds settings

- Root directory: repository root.
- Production branch: the explicitly selected test-store branch, on its own Worker.
- Build command: `pnpm install --frozen-lockfile && pnpm run build:registry`.
- Deploy command: `pnpm exec wrangler deploy --config dist/server/wrangler.json`.
- Disable builds for other branches. Do not enable preview URLs or use a
  production store's Worker for this test branch.
- Use Node 22.23.2 and pnpm 11.9.0, matching `.nvmrc` and `packageManager`.

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
