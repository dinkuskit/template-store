import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

function jobCondition(job) {
  const body = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n  [a-z][a-z-]+:\n/u)[0];
  assert.ok(body, `missing job ${job}`);
  const condition = body.match(/^    if: >-\n((?:      .+\n)+)/mu)?.[1];
  assert.ok(condition, `missing folded condition for ${job}`);
  return condition.trim().replaceAll("github.event.pull_request.labels.*.name", "labels");
}

function allowed(job, { event = "pull_request", action = "synchronize", labels = [], sameRepo = true, enabled = true } = {}) {
  const github = {
    event_name: event,
    repository: "example/store",
    event: {
      action,
      pull_request: { head: { repo: { full_name: sameRepo ? "example/store" : "fork/store" } } },
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

test("verification and build jobs remain available to labeled PRs", () => {
  for (const job of ["workflows", "verify", "build-playground"]) {
    const body = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n  [a-z][a-z-]+:\n/u)[0];
    assert.ok(body);
    assert.match(body, /^    if: github.event.action != 'closed'$/mu);
  }
});
