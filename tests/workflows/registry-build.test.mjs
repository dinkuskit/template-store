import assert from "node:assert/strict";
import test from "node:test";
import { assertBuildSource, registryBuildEnv, registryConfig } from "../../scripts/build-registry.mjs";

const env = {
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), DINKUS_WORKER_NAME: "test-registry-store",
  DINKUS_D1_DATABASE_NAME: "test-registry-content", DINKUS_D1_DATABASE_ID: "11111111-1111-1111-1111-111111111111",
  DINKUS_R2_BUCKET_NAME: "test-registry-media", DINKUS_SESSION_KV_ID: "b".repeat(32),
  DINKUS_RATE_LIMIT_NAMESPACE_ID: "12345", EMDASH_SITE_URL: "https://store.example.test",
};

test("Workers Builds refuses an unselected branch or unexpected commit", () => {
  assert.doesNotThrow(() => assertBuildSource({}));
  assert.throws(() => assertBuildSource({ WORKERS_CI: "1" }), /DINKUS_EXPECTED_BRANCH/);
  const source = { WORKERS_CI: "1", DINKUS_EXPECTED_BRANCH: "codex/test-store", DINKUS_EXPECTED_COMMIT: "a".repeat(40),
    WORKERS_CI_BRANCH: "codex/test-store", WORKERS_CI_COMMIT_SHA: "a".repeat(40) };
  assert.doesNotThrow(() => assertBuildSource(source));
  assert.throws(() => assertBuildSource({ ...source, WORKERS_CI_BRANCH: "main" }), /branch does not match/);
  assert.throws(() => assertBuildSource({ ...source, WORKERS_CI_COMMIT_SHA: "b".repeat(40) }), /commit does not match/);
});

test("requires preprovisioned identities instead of inheriting demo defaults", () => {
  for (const name of Object.keys(env)) {
    const missing = { ...env }; delete missing[name];
    assert.throws(() => registryConfig(missing), new RegExp(name));
  }
  const u = new URL("https://store.example.test/path"); u.username = "user"; u.password = "pass" + "word";
  assert.throws(() => registryConfig({ ...env, EMDASH_SITE_URL: u.href }), /HTTPS origin/);
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


test("Registry Access is opt-in and never serializes runtime secrets", () => {
  assert.equal(registryConfig(env).vars.DINKUS_REGISTRY_ACCESS_ENABLED, "0");
  const opted = { ...env, DINKUS_REGISTRY_ACCESS_ENABLED: "1", DINKUS_REGISTRY_ACCESS_TEAM_DOMAIN: "test-team.cloudflareaccess.com" };
  const config = registryConfig(opted);
  assert.equal(config.vars.DINKUS_REGISTRY_ACCESS_ENABLED, "1");
  assert.equal(config.vars.DINKUS_REGISTRY_ACCESS_TEAM_DOMAIN, opted.DINKUS_REGISTRY_ACCESS_TEAM_DOMAIN);
  assert.equal(Object.hasOwn(config.vars, "CF_ACCESS_AUDIENCE"), false);
  assert.equal(Object.hasOwn(config.vars, "EMDASH_ENCRYPTION_KEY"), false);
  assert.throws(() => registryConfig({ ...env, DINKUS_REGISTRY_ACCESS_ENABLED: "true" }), /DINKUS_REGISTRY_ACCESS_ENABLED/);
  for (const domain of [undefined, "https://test-team.cloudflareaccess.com", "test-team.cloudflareaccess.com/path", "test.example.com"]) {
    assert.throws(() => registryConfig({ ...opted, DINKUS_REGISTRY_ACCESS_TEAM_DOMAIN: domain }), /DINKUS_REGISTRY_ACCESS_TEAM_DOMAIN/);
  }
  assert.equal(registryBuildEnv(opted, registryConfig(env)).DINKUS_REGISTRY_ACCESS_ENABLED, "0");
});


test("only known Commerce profiles enter both build and runtime configuration", () => {
  assert.equal(registryConfig(env).vars.DINKUS_COMMERCE_PROFILE, "stable");
  const config = registryConfig({ ...env, DINKUS_COMMERCE_PROFILE: "beta" });
  assert.equal(config.vars.DINKUS_COMMERCE_PROFILE, "beta");
  assert.equal(registryBuildEnv({ ...env, DINKUS_COMMERCE_PROFILE: "stable" }, config).DINKUS_COMMERCE_PROFILE, "beta");
  for (const profile of ["", "other", "r_fjzjvld3ssb4j63o", "https://foreign.test"]) {
    assert.throws(() => registryConfig({ ...env, DINKUS_COMMERCE_PROFILE: profile }), /DINKUS_COMMERCE_PROFILE/);
  }
});
