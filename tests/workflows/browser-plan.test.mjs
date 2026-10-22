import assert from "node:assert/strict";
import test from "node:test";
import { needsBrowser } from "../../.github/scripts/browser-plan.mjs";

test("record-only changes skip the browser tests", () => {
  assert.equal(needsBrowser([".grilltrack/ledger.json", ".grilltrack/proof/x/PROOF.md", "docs/playground.md", "README.md", ""]), false);
});

test("any other change, or no readable change, runs the browser tests", () => {
  assert.equal(needsBrowser(["README.md", "src/pages/index.astro"]), true);
  assert.equal(needsBrowser(["skills/store-verification/SKILL.md"]), true);
  assert.equal(needsBrowser(["proof/registry-host-preparation-20261012/README.md"]), true);
  assert.equal(needsBrowser([".github/workflows/ci.yml"]), true);
  assert.equal(needsBrowser([""]), true);
  assert.equal(needsBrowser([]), true);
});
