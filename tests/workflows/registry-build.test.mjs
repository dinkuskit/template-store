import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertBuildSource, registryBuildEnv, registryConfig } from "../../scripts/build-registry.mjs";

const env = {
  CLOUDFLARE_ACCOUNT_ID: "a".repeat(32), DINKUS_WORKER_NAME: "test-registry-store",
  DINKUS_D1_DATABASE_NAME: "test-registry-content", DINKUS_D1_DATABASE_ID: "11111111-1111-1111-1111-111111111111",
  DINKUS_R2_BUCKET_NAME: "test-registry-media", DINKUS_SESSION_KV_ID: "b".repeat(32),
  DINKUS_RATE_LIMIT_NAMESPACE_ID: "12345", EMDASH_SITE_URL: "https://store.example.test",
};

// Copy the actual consumer into disposable Git checkouts, so CLI refusal and
// metadata assertions exercise real Git rather than a mocked reported HEAD.
function checkout() {
  mkdirSync("runs", { recursive: true });
  const directory = mkdtempSync(resolve("runs/source-guard-"));
  for (const file of ["scripts/build-registry.mjs", "scripts/registry-access.mjs", "src/features/commerce-profile/profiles.mjs"]) {
    mkdirSync(join(directory, file, ".."), { recursive: true });
    copyFileSync(resolve(file), join(directory, file));
  }
  writeFileSync(join(directory, "tracked.txt"), "committed source\n");
  const git = (...args) => execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "-C", directory, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", "main"); git("add", "."); git("commit", "-qm", "fixture source");
  const head = git("rev-parse", "HEAD"), tree = git("rev-parse", "HEAD^{tree}");
  const source = { ...env, WORKERS_CI: "1", DINKUS_EXPECTED_BRANCH: "main", DINKUS_EXPECTED_COMMIT: head,
    DINKUS_EXPECTED_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID, WORKERS_CI_BRANCH: "main", WORKERS_CI_COMMIT_SHA: head };
  return { directory, git, head, tree, source, close: () => rmSync(directory, { recursive: true, force: true }),
    cli: (overrides = {}) => spawnSync(process.execPath, [join(directory, "scripts/build-registry.mjs"), "--config-only", "--json"], {
      cwd: directory, encoding: "utf8", env: { PATH: process.env.PATH, ...source, ...overrides },
    }) };
}

test("non-CI builds need no Git checkout or source pins", () => {
  assert.equal(assertBuildSource({}, "/missing-checkout"), undefined);
});

test("actual clean Git source admits a short, wrong or missing observational stamp without changing it", () => {
  const fixture = checkout();
  try {
    fixture.git("checkout", "--detach", "-q", fixture.head);
    for (const stamp of ["x".repeat(4), undefined, fixture.head]) {
      const source = { ...fixture.source, WORKERS_CI_COMMIT_SHA: stamp };
      const before = { ...source };
      const result = assertBuildSource(source, fixture.directory);
      assert.deepEqual(result, { authority: "git-checkout", commit: fixture.head, tree: fixture.tree, trackedClean: true,
        providerCommitStamp: { role: "observational", length: stamp?.length ?? 0, matchesCheckout: stamp === fixture.head } });
      assert.deepEqual(source, before);
    }
  } finally { fixture.close(); }
});

test("a matching provider stamp cannot admit the wrong actual HEAD", () => {
  const fixture = checkout();
  try {
    const wrong = "a".repeat(40);
    assert.throws(() => assertBuildSource({ ...fixture.source, DINKUS_EXPECTED_COMMIT: wrong, WORKERS_CI_COMMIT_SHA: wrong }, fixture.directory), /Git HEAD does not match/);
    const result = fixture.cli({ DINKUS_EXPECTED_COMMIT: wrong, WORKERS_CI_COMMIT_SHA: wrong });
    assert.equal(result.status, 2); assert.equal(result.stdout, "");
    assert.match(result.stderr, /^Workers Builds Git HEAD does not match DINKUS_EXPECTED_COMMIT\n$/);
    assert.equal(existsSync(join(fixture.directory, "runs/registry/wrangler.jsonc")), false);
  } finally { fixture.close(); }
});

test("staged and unstaged tracked modifications refuse before configuration, while untracked output is allowed", () => {
  const fixture = checkout();
  try {
    writeFileSync(join(fixture.directory, "generated-output.txt"), "untracked output\n");
    assert.equal(assertBuildSource(fixture.source, fixture.directory).trackedClean, true);
    for (const stage of [false, true]) {
      writeFileSync(join(fixture.directory, "tracked.txt"), "changed source\n");
      if (stage) fixture.git("add", "tracked.txt");
      assert.throws(() => assertBuildSource(fixture.source, fixture.directory), /tracked source is not clean/);
      const result = fixture.cli(); assert.equal(result.status, 2); assert.equal(result.stdout, "");
      assert.equal(existsSync(join(fixture.directory, "runs/registry/wrangler.jsonc")), false);
    }
  } finally { fixture.close(); }
});

test("branch/account scope and missing or invalid expected pins refuse", () => {
  const fixture = checkout();
  try {
    for (const name of ["DINKUS_EXPECTED_BRANCH", "DINKUS_EXPECTED_COMMIT", "DINKUS_EXPECTED_ACCOUNT_ID"]) {
      for (const value of [undefined, "bad value"]) {
        assert.throws(() => assertBuildSource({ ...fixture.source, [name]: value }, fixture.directory), new RegExp(name));
      }
    }
    assert.throws(() => assertBuildSource({ ...fixture.source, WORKERS_CI_BRANCH: "other" }, fixture.directory), /branch does not match/);
    assert.throws(() => assertBuildSource({ ...fixture.source, CLOUDFLARE_ACCOUNT_ID: "b".repeat(32) }, fixture.directory), /account does not match/);
    assert.throws(() => assertBuildSource({ ...fixture.source, CLOUDFLARE_ACCOUNT_ID: undefined }, fixture.directory), /account does not match/);
  } finally { fixture.close(); }
});

test("wrong root, missing checkout and unavailable Git fail with sanitized diagnostics", () => {
  const fixture = checkout();
  try {
    assert.throws(() => assertBuildSource(fixture.source, join(fixture.directory, "scripts")), /Git root does not match/);
    assert.throws(() => assertBuildSource(fixture.source, join(fixture.directory, "missing")), /^Error: Unable to verify Workers Builds Git checkout$/);
    const noGit = fixture.cli({ PATH: "/nonexistent-git-bin" });
    assert.equal(noGit.status, 2); assert.equal(noGit.stdout, "");
    assert.equal(noGit.stderr, "Unable to verify Workers Builds Git checkout\n");
    const metadata = join(fixture.directory, ".git"); rmSync(metadata, { recursive: true, force: true });
    const nonRepo = fixture.cli({ GIT_CEILING_DIRECTORIES: resolve(fixture.directory, "..") });
    assert.equal(nonRepo.status, 2); assert.equal(nonRepo.stdout, "");
    assert.equal(nonRepo.stderr, "Unable to verify Workers Builds Git checkout\n");
    assert.equal(existsSync(join(fixture.directory, "runs/registry/wrangler.jsonc")), false);
  } finally { fixture.close(); }
});

test("CLI emits verified source and truthful stamp metadata without leaking stamp values", () => {
  const fixture = checkout();
  try {
    const result = fixture.cli({ WORKERS_CI_COMMIT_SHA: "x".repeat(4) });
    assert.equal(result.status, 0);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.status, "configured"); assert.equal(receipt.deployed, false);
    assert.equal(receipt.source.commit, fixture.head); assert.equal(receipt.source.tree, fixture.tree);
    assert.deepEqual(receipt.source.providerCommitStamp, { role: "observational", length: 4, matchesCheckout: false });
    assert.match(result.stderr, /^Workers Builds commit stamp is unqualified; source verified from the clean Git checkout\.\n$/);
    assert.ok(!result.stdout.includes("xxxx") && !result.stderr.includes("xxxx"));
    assert.equal(JSON.parse(readFileSync(join(fixture.directory, "runs/registry/wrangler.jsonc"))).account_id, env.CLOUDFLARE_ACCOUNT_ID);
  } finally { fixture.close(); }
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
