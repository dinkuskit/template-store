import assert from "node:assert/strict";
import test from "node:test";
import { registryBuildEnv, registryConfig } from "../../scripts/build-registry.mjs";

const env = {
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), DINKUS_WORKER_NAME: "test-registry-store",
  DINKUS_D1_DATABASE_NAME: "test-registry-content", DINKUS_D1_DATABASE_ID: "11111111-1111-1111-1111-111111111111",
  DINKUS_R2_BUCKET_NAME: "test-registry-media", DINKUS_SESSION_KV_ID: "b".repeat(32),
  DINKUS_RATE_LIMIT_NAMESPACE_ID: "12345", EMDASH_SITE_URL: "https://store.example.test",
};

test("requires preprovisioned identities instead of inheriting demo defaults", () => {
  for (const name of Object.keys(env)) {
    const missing = { ...env }; delete missing[name];
    assert.throws(() => registryConfig(missing), new RegExp(name));
  }
  assert.throws(() => registryConfig({ ...env, EMDASH_SITE_URL: "https://user:password@store.example.test/path" }), /HTTPS origin/);
  assert.throws(() => registryConfig({ ...env, DINKUS_D1_DATABASE_ID: "not-an-id" }), /DINKUS_D1_DATABASE_ID/);
  assert.throws(() => registryConfig({ ...env, DINKUS_RATE_LIMIT_NAMESPACE_ID: "4294967296" }), /DINKUS_RATE_LIMIT_NAMESPACE_ID/);
});

test("build and runtime stay shipping with a loader and closed bootstrap", () => {
  const config = registryConfig(env);
  assert.equal(config.vars.DINKUS_CATALOG_PROFILE, "shipping");
  assert.equal(config.vars.DINKUS_EMDASH_ADMIN_ENABLED, "0");
  assert.equal(config.workers_dev, false); assert.equal(config.preview_urls, false);
  assert.equal(config.routes, undefined);
  assert.equal(config.d1_databases[0].database_id, env.DINKUS_D1_DATABASE_ID);
  assert.deepEqual(config.worker_loaders, [{ binding: "LOADER" }]);
  const child = registryBuildEnv({ ...env, CLOUDFLARE_ENV: "production", DINKUS_PROOF_MODE: "1", DINKUS_CATALOG_PROFILE: "native-development" }, config);
  assert.equal(child.CLOUDFLARE_ENV, undefined);
  assert.equal(child.DINKUS_PROOF_MODE, "0"); assert.equal(child.DINKUS_CATALOG_PROFILE, "shipping");
  assert.equal(child.DINKUS_HOSTING_PROFILE, "cloudflare");
  assert.equal(child.DINKUS_WRANGLER_CONFIG, "runs/registry/wrangler.jsonc");
});
