import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { packBuild, restoreBuild } from "../../.github/scripts/playground-build-artifact.mjs";

const source = new URL("../../", import.meta.url);
const controlFiles = [
  ".github/scripts/playground-build-artifact.mjs", ".github/workflows/ci.yml", ".nvmrc", "package.json",
  "pnpm-lock.yaml", "pnpm-workspace.yaml", "astro.playground.config.mjs", "wrangler.playground.jsonc",
  "scripts/prepare-source-deps.mjs", "scripts/prepare-playground-plugins.mjs", "scripts/lib/paired-commerce.mjs",
  "src/features/commerce-profile/profiles.mjs", "src/features/playground-plugins/registry-plugins.mjs",
];
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "playground-handoff-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of controlFiles) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(new URL(path, source), join(root, path));
  }
  writeFileSync(join(root, ".gitignore"), "dist/\nartifact/\nrestored/\n");
  const git = (...args) => execFileSync("git", ["-c", "core.fsmonitor=false", "-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  git("init", "-q"); git("add", ".");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", "Fixture inputs");
  const env = { SOURCE_SHA: git("rev-parse", "HEAD"), GITHUB_REPOSITORY: "dinkuskit/template-store", GITHUB_REPOSITORY_ID: "1306882668",
    GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", PLAYGROUND_PRODUCER_ATTEMPT: "1", GITHUB_EVENT_NAME: "pull_request",
    GITHUB_WORKFLOW_SHA: "a".repeat(40), GITHUB_WORKFLOW_REF: "dinkuskit/template-store/.github/workflows/ci.yml@refs/pull/7/merge",
    SOURCE_REPOSITORY: "dinkuskit/template-store", SOURCE_PR_NUMBER: "7" };
  for (const path of ["dist/server", "dist/client/empty"]) mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, "dist/server/entry.mjs"), "export default { fetch: () => new Response('populated worker') };\n");
  writeFileSync(join(root, "dist/client/index.html"), "<h1>Populated assets</h1>\n");
  writeFileSync(join(root, "dist/client/.assetsignore"), "_headers\n");
  writeFileSync(join(root, "dist/server/wrangler.json"), JSON.stringify({ no_bundle: true, main: "entry.mjs", assets: { directory: "../client" } }));
  chmodSync(join(root, "dist/server/entry.mjs"), 0o750);
  return { root, env, git, pack: () => packBuild(root, "artifact", env),
    restore: (hash, overrides = {}) => restoreBuild(root, "artifact", "restored", { ...env, ...overrides }, hash) };
}
function mutateManifest(root, change) {
  const path = join(root, "artifact/manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")); change(manifest);
  const bytes = JSON.stringify(manifest); writeFileSync(path, bytes);
  return createHash("sha256").update(bytes).digest("hex");
}

test("nonempty worker, hidden assets, modes and empty directories survive ZIP mode/directory loss", (t) => {
  const f = fixture(t); const packed = f.pack();
  chmodSync(join(f.root, "artifact/payload/dist/server/entry.mjs"), 0o644);
  rmSync(join(f.root, "artifact/payload/dist/client/empty"), { recursive: true });
  f.restore(packed.manifestSha256);
  for (const path of ["server/entry.mjs", "server/wrangler.json", "client/index.html", "client/.assetsignore"]) {
    assert.deepEqual(readFileSync(join(f.root, "restored/dist", path)), readFileSync(join(f.root, "dist", path)));
  }
  assert.equal(lstatSync(join(f.root, "restored/dist/server/entry.mjs")).mode & 0o777, 0o750);
  assert.equal(lstatSync(join(f.root, "restored/dist/client/empty")).isDirectory(), true);
});

test("restore binds repository, source, run, attempt, event, workflow and toolchain inputs", (t) => {
  const f = fixture(t); const { manifestSha256 } = f.pack();
  for (const overrides of [{ SOURCE_SHA: "b".repeat(40) }, { GITHUB_RUN_ID: "124" }, { PLAYGROUND_PRODUCER_ATTEMPT: "2" },
    { GITHUB_REPOSITORY: "fork/template-store" }, { GITHUB_REPOSITORY_ID: "42" }, { SOURCE_REPOSITORY: "fork/template-store" },
    { SOURCE_PR_NUMBER: "8" }, { GITHUB_WORKFLOW_SHA: "b".repeat(40) }, { GITHUB_EVENT_NAME: "push" },
    { DINKUS_COMMERCE_PROFILE: "beta" }, { PUBLIC_CHANGED: "1" }, { DINKUS_PLAYGROUND_WRANGLER_CONFIG: "other.json" }]) {
    assert.throws(() => f.restore(manifestSha256, overrides));
    assert.equal(existsSync(join(f.root, "restored/dist")), false);
  }
  const badToolchain = mutateManifest(f.root, (m) => { m.inputs.toolchain.node = "v22.0.0"; });
  assert.throws(() => f.restore(badToolchain), /inputs differ/u);
  const restoredToolchain = mutateManifest(f.root, (m) => { m.inputs.toolchain.node = process.version; });
  writeFileSync(join(f.root, "astro.playground.config.mjs"), "changed");
  assert.throws(() => f.restore(restoredToolchain, { GITHUB_RUN_ID: "124" }), /inputs differ/u);
  assert.throws(() => f.restore(restoredToolchain), /clean checkout/u);
  assert.equal(existsSync(join(f.root, "restored/dist")), false);
});

test("external trusted manifest hash is mandatory and checked before manifest parsing", (t) => {
  const f = fixture(t); const { manifestSha256 } = f.pack();
  assert.throws(() => f.restore(undefined), /trusted producer/u);
  assert.throws(() => f.restore("0".repeat(64)), /trusted producer output/u);
  writeFileSync(join(f.root, "artifact/manifest.json"), "invalid JSON");
  assert.throws(() => f.restore(manifestSha256), /trusted producer output/u);
  for (const manifest of [null, {}, { schema: 1 }, { schema: 1, inputs: null }, { schema: 1, inputs: { context: null } }]) {
    const bytes = JSON.stringify(manifest);
    writeFileSync(join(f.root, "artifact/manifest.json"), bytes);
    const trustedHash = createHash("sha256").update(bytes).digest("hex");
    assert.throws(() => f.restore(trustedHash), /inputs differ/u);
  }
  assert.equal(existsSync(join(f.root, "restored/dist")), false);
});

test("missing, altered and additional payload files refuse without altering the destination", (t) => {
  const f = fixture(t); const { manifestSha256 } = f.pack();
  const path = join(f.root, "artifact/payload/dist/client/index.html");
  const original = readFileSync(path);
  for (const action of [() => rmSync(path), () => writeFileSync(path, "changed"), () => writeFileSync(join(f.root, "artifact/payload/dist/client/extra.txt"), "extra")]) {
    action(); assert.throws(() => f.restore(manifestSha256), /missing, additional or corrupt/u);
    assert.equal(existsSync(join(f.root, "restored/dist")), false); writeFileSync(path, original);
  }
});

test("protected file and symlink payloads refuse before copy", (t) => {
  const f = fixture(t);
  const protectedPath = join(f.root, "dist/client/.env.private");
  writeFileSync(protectedPath, "synthetic forbidden fixture");
  assert.throws(() => f.pack(), /configuration or credential/u);
  assert.equal(existsSync(join(f.root, "artifact")), false); rmSync(protectedPath);
  symlinkSync("index.html", join(f.root, "dist/client/link.html"));
  assert.throws(() => f.pack(), /link or unsupported/u);
});

test("SESSION and configuration paths outside dist cannot be handed off", (t) => {
  const f = fixture(t); const path = join(f.root, "dist/server/wrangler.json");
  const base = JSON.parse(readFileSync(path, "utf8"));
  for (const config of [{ ...base, kv_namespaces: [{ binding: "SESSION", id: "synthetic" }] },
    { ...base, assets: { directory: "../../src" } }, { ...base, main: "../../package.json" },
    { ...base, no_bundle: false }, { ...base, d1_databases: [{ migrations_dir: "../../migrations" }] }]) {
    writeFileSync(path, JSON.stringify(config)); assert.throws(() => f.pack());
    assert.equal(existsSync(join(f.root, "artifact")), false);
  }
});

test("clean source and immutable stage/destination are required", (t) => {
  const f = fixture(t); writeFileSync(join(f.root, "unknown-input.mjs"), "untracked");
  assert.throws(() => f.pack(), /untracked source/u); rmSync(join(f.root, "unknown-input.mjs"));
  writeFileSync(join(f.root, "astro.playground.config.mjs"), "changed");
  assert.throws(() => f.pack(), /clean checkout/u); f.git("checkout", "--", "astro.playground.config.mjs");
  const { manifestSha256 } = f.pack(); assert.throws(() => f.pack(), /already exists/u);
  mkdirSync(join(f.root, "restored/dist"), { recursive: true });
  writeFileSync(join(f.root, "restored/dist/sentinel"), "preserve");
  assert.throws(() => f.restore(manifestSha256), /already contains dist/u);
  assert.equal(readFileSync(join(f.root, "restored/dist/sentinel"), "utf8"), "preserve");
});

test("trusted but malformed member paths and linked destination ancestors refuse", (t) => {
  const f = fixture(t); f.pack();
  const hash = mutateManifest(f.root, (m) => { m.entries.push({ path: "dist/../../escape", type: "directory", mode: 0o755 }); });
  assert.throws(() => f.restore(hash), /Unsafe artifact member/u);
  assert.equal(existsSync(join(f.root, "escape")), false);
  mkdirSync(join(f.root, "actual")); symlinkSync("actual", join(f.root, "restored"));
  assert.throws(() => f.restore(hash), /traverse links/u);
});

test("a failed-job rerun accepts its earlier trusted producer but refuses a future/missing producer", (t) => {
  const f = fixture(t); const { manifestSha256 } = f.pack();
  assert.throws(() => f.restore(manifestSha256, { PLAYGROUND_PRODUCER_ATTEMPT: undefined }), /producer attempt/u);
  assert.throws(() => f.restore(manifestSha256, { PLAYGROUND_PRODUCER_ATTEMPT: "3", GITHUB_RUN_ATTEMPT: "2" }), /producer attempt/u);
  f.restore(manifestSha256, { GITHUB_RUN_ATTEMPT: "2", PLAYGROUND_PRODUCER_ATTEMPT: "1" });
  assert.equal(existsSync(join(f.root, "restored/dist/client/index.html")), true);
});

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");
function jobBody(job) { return workflow.split(`\n  ${job}:\n`)[1]?.split(/\n  [a-z][a-z-]+:\n/u)[0]; }
function stepAllowed(name, { event = "pull_request", draft = false, sameRepo = true, labels = [], enabled = true } = {}) {
  const step = jobBody("build-playground").split(`      - name: ${name}\n`)[1]?.split(/\n      - /u)[0];
  const condition = step?.match(/^        if: >-\n((?:          .+\n)+)/mu)?.[1]?.trim()
    .replaceAll("github.event.pull_request.labels.*.name", "labels");
  assert.ok(condition, `missing admission condition for ${name}`);
  const github = { event_name: event, repository: "dinkuskit/template-store", event: { pull_request: {
    draft, head: { repo: { full_name: sameRepo ? "dinkuskit/template-store" : "fork/template-store" } },
  } } };
  return Function("github", "vars", "labels", "contains", `return (${condition});`)(github,
    { PLAYGROUND_DEPLOY_ENABLED: enabled ? "true" : "false" }, labels,
    (values, value) => values.some((item) => item.toLowerCase() === value.toLowerCase()));
}
test("artifact work is admitted only for a consumer or explicit same-repository proof", () => {
  const cases = [
    [{ event: "push" }, true, false], [{ event: "push", enabled: false }, false, false],
    [{}, true, false], [{ enabled: false }, false, false],
    [{ sameRepo: false }, false, false], [{ sameRepo: false, draft: true }, false, false],
    [{ draft: true, enabled: false }, true, true], [{ labels: ["Verification-Only"], enabled: false }, true, true],
  ];
  for (const [context, upload, proof] of cases) {
    for (const step of ["Package playground build", "Upload playground build"]) assert.equal(stepAllowed(step, context), upload);
    for (const step of ["Download playground build for non-deploying proof", "Verify restored playground without deployment"]) assert.equal(stepAllowed(step, context), proof);
  }
});
test("consumer uses trusted producer outputs and keeps config verification, source stamps and keep-vars", () => {
  const producer = jobBody("build-playground"); const consumer = jobBody("deploy-playground");
  assert.match(producer, /include-hidden-files: true/u);
  assert.match(producer, /retention-days: 3/u);
  assert.match(consumer, /name: \$\{\{ needs\.build-playground\.outputs\.artifact-name \}\}/u);
  assert.match(consumer, /PLAYGROUND_MANIFEST_SHA: \$\{\{ needs\.build-playground\.outputs\.manifest-sha256 \}\}/u);
  assert.match(consumer, /PLAYGROUND_PRODUCER_ATTEMPT: \$\{\{ needs\.build-playground\.outputs\.producer-attempt \}\}/u);
  assert.match(consumer, /pnpm verify:playground-config/u);
  assert.match(consumer, /Record source commits/u); assert.match(consumer, /--keep-vars/u);
  assert.doesNotMatch(consumer, /pnpm prepare:sources|astro build|Remove unused Astro session binding/u);
});
