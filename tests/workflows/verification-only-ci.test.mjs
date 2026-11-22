import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

function jobCondition(job) {
  const body = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n  [a-z][a-z-]+:\n/u)[0];
  assert.ok(body, `missing job ${job}`);
  const condition = body.match(/^    if: >-\n((?:      .+\n)+)/mu)?.[1];
  assert.ok(condition, `missing folded condition for ${job}`);
  return condition.trim().replaceAll("github.event.pull_request.labels.*.name", "labels");
}

function allowed(job, { event = "pull_request", action = "synchronize", labels = [], sameRepo = true, enabled = true, draft = false } = {}) {
  const github = {
    event_name: event,
    repository: "example/store",
    event: {
      action,
      pull_request: { draft, head: { repo: { full_name: sameRepo ? "example/store" : "fork/store" } } },
    },
  };
  // Evaluate only the fixed, repository-owned condition with equivalent contains semantics.
  return Function("github", "vars", "labels", "contains", `return (${jobCondition(job)});`)(
    github,
    { PLAYGROUND_DEPLOY_ENABLED: enabled ? "true" : "false" },
    labels,
    (values, value) => values.some((item) => item.toLowerCase() === value.toLowerCase()),
  );
}

test("verification-only PRs cannot deploy or delete previews", () => {
  for (const action of ["opened", "synchronize", "reopened", "closed"]) {
    for (const labels of [["verification-only"], ["P2", "Verification-Only"]]) {
      for (const job of ["deploy-playground", "cleanup-playground-preview"]) {
        assert.equal(allowed(job, { action, labels }), false, `${job}: ${action}`);
      }
    }
  }
});

test("draft opening cannot publish before the verification-only label is added", () => {
  for (const action of ["opened", "synchronize", "reopened"]) {
    assert.equal(allowed("deploy-playground", { action, draft: true }), false);
    assert.equal(allowed("deploy-playground", { action, draft: true, labels: ["verification-only"] }), false);
    assert.equal(allowed("deploy-playground", { action, draft: false, labels: ["verification-only"] }), false);
    assert.equal(allowed("deploy-playground", { action, draft: false }), true);
  }
  assert.equal(allowed("deploy-playground", { event: "push", draft: true }), true);
});

test("verification-only guard preserves ordinary deployment and fork boundaries", () => {
  assert.equal(allowed("deploy-playground"), true);
  assert.equal(allowed("deploy-playground", { event: "push" }), true);
  assert.equal(allowed("cleanup-playground-preview", { action: "closed" }), true);
  assert.equal(allowed("deploy-playground", { action: "closed" }), false);
  assert.equal(allowed("cleanup-playground-preview"), false);
  for (const job of ["deploy-playground", "cleanup-playground-preview"]) {
    for (const action of ["synchronize", "closed"]) {
      assert.equal(allowed(job, { action, sameRepo: false }), false);
      assert.equal(allowed(job, { action, enabled: false }), false);
    }
  }
});

function jobBody(job) {
  const body = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n  [a-z][a-z-]+:\n/u)[0];
  assert.ok(body, `missing job ${job}`);
  return body;
}

test("verification and build jobs remain available to labeled PRs", () => {
  for (const job of ["workflows", "checks", "browser", "build-registry", "build-playground"]) {
    assert.match(jobBody(job), /^    if: github.event.action != 'closed'$/mu);
  }
  assert.match(jobBody("verify"), /^    if: \$\{\{ !cancelled\(\) && github.event.action != 'closed' \}\}$/mu);
});

test("Store verification requires the checks, every browser shard and the Registry build", () => {
  const body = jobBody("verify");
  assert.match(body, /^    name: Store verification$/mu);
  assert.match(body, /^    needs: \[checks, browser, build-registry\]$/mu);
  assert.match(body, /CHECKS: \$\{\{ needs\.checks\.result \}\}/u);
  assert.match(body, /test "\$CHECKS" = success/u);
  // A matrix job's result is success only when every shard succeeded.
  assert.match(body, /BROWSER: \$\{\{ needs\.browser\.result \}\}/u);
  assert.match(body, /test "\$BROWSER" = success/u);
  assert.match(body, /REGISTRY: \$\{\{ needs\.build-registry\.result \}\}/u);
  assert.match(body, /test "\$REGISTRY" = success/u);
});

test("the browser shards together run every browser test, desktop and phone", () => {
  const body = jobBody("browser");
  assert.match(body, /^        shard: \['1', '2', '3', '4'\]$/mu);
  assert.match(body, /^      fail-fast: false$/mu);
  assert.match(body, /run: bin\/verify-web browser\n {8}env:\n {10}VERIFY_E2E_SHARD: \$\{\{ matrix\.shard \}\}$/mu);
  // No project filter: each shard runs desktop, phone and the shipping store projects.
  assert.doesNotMatch(workflow, /VERIFY_E2E_PROJECTS/u);
  const checks = jobBody("checks");
  assert.match(checks, /run: bin\/verify-web checks$/mu);
  assert.match(checks, /run: bin\/verify-web quick$/mu);
  assert.doesNotMatch(checks, /playwright test|setup-chromium|VERIFY_E2E/u);
});

test("Registry CI compiles the actual store without deployment credentials", () => {
  const body = jobBody("build-registry");
  assert.match(body, /pnpm run build:registry\n/u);
  assert.match(body, /node \.github\/scripts\/assert-registry-build\.mjs/u);
  assert.match(body, /EMDASH_SITE_URL: https:\/\/store\.example\.test/u);
  assert.doesNotMatch(body, /secrets\.|environment:|--config-only|--dry-run|wrangler (?:deploy|preview)|WORKERS_CI:/u);
  assert.doesNotMatch(body, /^    needs:/mu);
});

test("playground builds beside verification but deploys only after it", () => {
  assert.doesNotMatch(jobBody("build-playground"), /^    needs:/mu);
  assert.match(jobBody("deploy-playground"), /^    needs: \[verify, build-playground\]$/mu);
  assert.doesNotMatch(jobBody("deploy-playground"), /always\(\)|!cancelled\(\)|failure\(\)/u);
});

test("every browser spec file runs in exactly one shard, and CI runs every shard", () => {
  const script = new URL("../../scripts/e2e-shards.mjs", import.meta.url).pathname;
  const plan = execFileSync(process.execPath, [script, "--check"], { encoding: "utf8" }).trim().split("\n");
  assert.equal(plan.length, 4);
  const seen = [];
  plan.forEach((line, index) => {
    const [label, files] = line.split(": ");
    assert.equal(label, `${index + 1}/4`);
    seen.push(...files.split(", "));
  });
  const specs = readdirSync(new URL("../e2e/", import.meta.url))
    .filter((name) => name.endsWith(".spec.ts"))
    .map((name) => name.slice(0, -".spec.ts".length));
  assert.deepEqual([...seen].sort(), [...specs].sort());
  // The filters are anchored, so one spec name cannot also select a longer one that starts with it.
  for (let shard = 1; shard <= 4; shard += 1) {
    const filters = execFileSync(process.execPath, [script, String(shard)], { encoding: "utf8" }).trim().split("\n");
    for (const filter of filters) assert.match(filter, /^tests\/e2e\/[a-z0-9-]+\\\.spec\\\.ts\$$/u);
  }
  assert.match(jobBody("browser"), /^    name: Store browser tests \(\$\{\{ matrix\.shard \}\}\/4\)$/mu);
});
