# Synthetic Demo Seeding and Reset Plan

## Scope and Principles

This document defines the seeding and reset procedure for the hosted DinkusKit Template Store public demonstration profile.

### Safety Rules

1. **Strictly Isolated SKUs**: Seeding and reset operations operate strictly on explicit namespaced SKUs (`DEMO-HOSTED-*`). Non-demo data is never touched or scanned for deletion.
2. **No Raw Database Uploads**: Operators must never upload raw local SQLite databases (`content.db`) to remote D1. Local databases contain development artifacts, temporary credentials, and local path references.
3. **No Broad Deletions**: Destructive operations like table drops, table truncations, or unbounded `DELETE` queries are prohibited. Resetting consists of idempotent state updates to baseline catalog parameters.
4. **No Public Reset Endpoints**: The public boundary gate explicitly denies administrative, setup, schema, auth, and proof mutation endpoints. All seeding and reset operations are executed out-of-band by authorized operators via protected CLI tooling.

---

## Synthetic Demo Catalog Items

| Item Name | SKU | Baseline Price | Sale Price | Initial Availability |
| --- | --- | --- | --- | --- |
| Dinkus Demo Heavyweight T-Shirt | `DEMO-HOSTED-SHIRT` | $32.00 USD | None | In stock |
| Dinkus Demo Structured Cap | `DEMO-HOSTED-CAP` | $28.00 USD | $24.00 USD | In stock |
| Dinkus Demo Ceramic Mug | `DEMO-HOSTED-MUG` | $18.00 USD | None | In stock |

---

## Seeding Procedure

Catalog writes stay on Commerce `createCatalogItem`, `setCatalogItemRegularPrice`, `setCatalogItemSalePrice`, `clearCatalogItemSalePrice`, and `setCatalogItemManualAvailability`. EmDash content setup stays on `runMigrations` and `applySeed`. The seeder does not construct `EmDashRuntime`, does not import `api-BBZlif0y.mjs` or `emdash/internal/plugin-test-runtime`, and does not author index SQL.

`emdash@1.0.1` root exports `definePlugin` and `PluginStorageRepository`. It does not export `EmDashRuntime`. Canonical plugin indexes, including `uidx_plugin_dinkus-commerce_catalogItems_skuKey`, are created inside the Astro-built Cloudflare Worker. `src/worker.ts` keeps the guarded Astro `fetch` and adds `scheduled: createScheduledHandler()` from `@emdash-cms/cloudflare/worker`, plus the `PluginBridge` export. No `LOADER` binding and no Cron Trigger are added. `createScheduledHandler()` calls public `emdash/middleware` `runScheduledTasks` in that built context, and runtime maintenance calls `syncPluginStorageIndexesOnce()`.

`wrangler dev --help` documents `--test-scheduled` as local-only: visit `/__scheduled`. The public fetch guard still denies that path. The harness is not a production endpoint.

1. **Local index bootstrap** (required once per fresh D1 persist, before Commerce writes):
   ```bash
   node scripts/scheduled-index-harness.mjs --persist .wrangler/state/v3
   ```
   The harness builds the Cloudflare Worker when `dist/server/entry.mjs` has no `scheduled` export, then runs `wrangler dev --local --ip 127.0.0.1 --test-scheduled --persist-to .wrangler/state` against that built entry. It requests loopback `/__scheduled`, checks the physical `skuKey` unique index read-only, and stops that child process. Normal local default state remains `.wrangler/state/v3`.

2. **Local seed** (default, `remoteBindings: false`):
   ```bash
   pnpm seed:bundle
   node --import ./scripts/cloudflare-workers-hook.mjs .artifacts/seed/seed-synthetic-demo.mjs
   ```
   Refuses `D1_DB_PATH`. Writes use ignored `.artifacts/wrangler.local.jsonc` and `getPlatformProxy` with `remoteBindings: false`. Before any seed write, a read-only `sqlite_master` lookup must find `uidx_plugin_dinkus-commerce_catalogItems_skuKey`. If it is missing, the command exits 2 with `INDEX_INIT_REQUIRED` and does not write. `--prove-sentinel --persist <isolated>/v3` is the non-demo preservation run and cannot target `.wrangler/state/v3`.

3. **Remote execution** (opt-in, not run, still unproved):
   ```bash
   node --import ./scripts/cloudflare-workers-hook.mjs .artifacts/seed/seed-synthetic-demo.mjs --remote --confirm <fingerprint>
   ```
   `--remote` without the ignored manifest `.artifacts/remote-operator-target.json` exits 2 with `REMOTE_SEED_UNPROVED` before any proxy. A present manifest still has to match ignored `.artifacts/wrangler.remote.jsonc`: worker `dinkuskit-template-demo`, database name `dinkuskit-template-demo`, exactly one D1 binding `DB` with `remote: true`, materialized `account_id` and `database_id`, `run_worker_first`, and rate namespace `2026100101`. The manifest scope must be `fresh-demo-only`. `--confirm` must equal the manifest confirmation and the SHA-256 hex of these lines, lowercased ids, with no trailing newline on the last line:

   ```text
   <account id>
   <database id>
   dinkuskit-template-demo
   dinkuskit-template-demo
   DB
   ```

   The passing proxy call, which this slice does not invoke, is `getPlatformProxy({ configPath: <repo>/.artifacts/wrangler.remote.jsonc, remoteBindings: true, envFiles: [], persist: false })`. The command rejects preview ids, a local UUID presented as remote, a database file path, any other worker or database name, `--prove-sentinel`, a missing or wrong confirmation, and committed `account_id` / `database_id` / `remote` in `wrangler.jsonc`. Account and database ids stay in those ignored files only. A remote database also needs the same built-Worker scheduled initialization against that approved remote binding before Commerce writes. That remote initialization has not been run. Actual remote seeding remains unproved.

4. **Verification**:
   After the local scheduled harness and seed, the three `DEMO-HOSTED-*` rows are the baseline prices and availability. The repeat run reports the non-demo sentinel unchanged and the neutral home page published. Remote verification is not claimed.

---

## Reset Procedure

If the demo storefront requires resetting to its baseline state:

1. Re-run the local seed command (`pnpm seed:demo` runs that bundled script) against a database whose scheduled harness already created the Commerce `skuKey` index. Remote reset has not been proved.
2. The script identifies existing `DEMO-HOSTED-*` items by SKU and re-applies baseline regular prices, sale prices, and manual availability statuses idempotently.
3. Any guest cart sessions in client storage expire or can be cleared by end users; no server-side order or checkout records are created because checkout is disabled on the public demo.
