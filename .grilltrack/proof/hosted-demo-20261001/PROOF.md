# Hosted demo public worker slice

Development-pilot source alias. Not a registry release and not a deployment.

## Profile

EmDash `1.0.1`. Commerce public commit `d3f7e591ef64c63d7748fe75e746dcfe39bbb4ca`, fetched by `pnpm prepare:sources`. The private 0.0.0 tarball is not this pin. Rate namespace `2026100101` and `run_worker_first` stay in place. No sandbox loader and no new Cron Trigger.

The Worker fetch guard is unchanged. `scheduled` is `createScheduledHandler()` from `@emdash-cms/cloudflare/worker`, and `PluginBridge` is exported. `/__scheduled` is denied on the public fetch path. Local `wrangler dev --test-scheduled` is the only caller, on loopback.

The seeder uses the D1 proxy and canonical Commerce writes plus EmDash `runMigrations` and `applySeed`. It requires physical index `uidx_plugin_dinkus-commerce_catalogItems_skuKey` first. If that index is missing, the command exits `INDEX_INIT_REQUIRED` and writes nothing.

## Commands

```text
node scripts/scheduled-index-harness.mjs --persist .wrangler/state/v3
pnpm seed:bundle
node --import ./scripts/cloudflare-workers-hook.mjs .artifacts/seed/seed-synthetic-demo.mjs
```

Remote seed still requires the ignored fresh-demo manifest, matching remote Wrangler config, and `--confirm` SHA-256 fingerprint. That path was not executed.

## Outcomes

Local fresh D1: scheduled harness created the Commerce skuKey unique index. Seed created `DEMO-HOSTED-SHIRT` at 3200, `DEMO-HOSTED-CAP` at 2800/2400, and `DEMO-HOSTED-MUG` at 1800. Home was published. Repeat kept the non-demo sentinel unchanged. A database without the harness refused with `INDEX_INIT_REQUIRED`. `--remote` without a manifest refused with `REMOTE_SEED_UNPROVED`. Focused typecheck reported 0 errors. Focused unit tests passed.

## Still open

Exact source review, deployment, registry publication, and payment gates. Remote initialization and remote seed are unproved. The known sandbox disabled-slider gap is unchanged.
