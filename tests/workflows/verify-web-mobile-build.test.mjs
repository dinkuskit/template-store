import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const mobile = "chromium-mobile,shipping-chromium-mobile";
function runVerifier(t, mode = "browser", overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "verify-web-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "bin"));
  const stub = join(root, "commands"); mkdirSync(stub);
  copyFileSync(new URL("../../bin/verify-web", import.meta.url), join(root, "bin/verify-web"));
  for (const name of ["pnpm", "node", "git"]) {
    writeFileSync(join(stub, name), `#!/bin/sh\nprintf '${name}:%s\\n' "$*" >> "$TEST_CALLS"\n` + (name === "pnpm" ? `
if [ "$1 $2 $3" = "exec astro build" ]; then exit "\${TEST_BUILD_EXIT:-0}"; fi
if [ "$1 $2 $3" = "exec playwright test" ]; then exit "\${TEST_BROWSER_EXIT:-0}"; fi
if [ "$1 $2 $3" = "exec astro preview" ]; then while :; do sleep 1; done; fi
` : ""), { mode: 0o755 });
  }
  writeFileSync(join(stub, "curl"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(root, "bin/verify-site"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const calls = join(root, "calls.txt"); writeFileSync(calls, "");
  const env = { PATH: `${stub}:/usr/bin:/bin`, HOME: process.env.HOME, TMPDIR: root, TEST_CALLS: calls };
  for (const [key, value] of Object.entries(overrides)) if (value !== undefined) env[key] = value;
  const result = spawnSync("bash", [join(root, "bin/verify-web"), mode], { env, encoding: "utf8", timeout: 5000 });
  assert.equal(result.error, undefined);
  return { ...result, calls: readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) };
}
const builds = (r) => r.calls.filter((s) => s === "pnpm:exec astro build").length;

test("explicit normal mobile pair retains preparation and exact browser selection without a production build", (t) => {
  const r = runVerifier(t, "browser", { VERIFY_E2E_PROJECTS: mobile });
  assert.equal(r.status, 0);
  assert.equal(builds(r), 0);
  assert.deepEqual(r.calls, ["pnpm:prepare:sources", "node:scripts/prepare-paired-commerce.mjs", "pnpm:exec playwright test --project=chromium-mobile --project=shipping-chromium-mobile"]);
  assert.match(r.stdout, /verify-web: browser passed/u);
});

test("unspecified, partial, malformed, unknown and desktop selections retain the build", (t) => {
  for (const selection of [undefined, "", "chromium-mobile", "shipping-chromium-mobile", "shipping-chromium-mobile,chromium-mobile", "chromium-mobile,shipping-chromium-mobile,", "chromium-mobile, shipping-chromium-mobile", "chromium-mobile,unknown", "chromium-desktop,shipping-chromium-desktop", `${mobile},chromium-desktop`]) {
    const r = runVerifier(t, "browser", { VERIFY_E2E_PROJECTS: selection });
    assert.equal(r.status, 0); assert.equal(builds(r), 1, String(selection));
    assert.ok(r.calls.indexOf("pnpm:exec astro build") < r.calls.findIndex((s) => s.startsWith("pnpm:exec playwright test")));
  }
});

test("configured adapters, Cloudflare and custom build inputs retain the build even if empty", (t) => {
  for (const name of ["DINKUS_HOSTING_PROFILE", "ASTRO_ADAPTER", "CLOUDFLARE_E2E", "DINKUS_WRANGLER_CONFIG", "DINKUS_PAIRED_COMMERCE_DIR", "DINKUS_COMMERCE_PROFILE", "DINKUS_CATALOG_PROFILE", "DINKUS_TEMPLATE_DB_URL", "DINKUS_TEMPLATE_UPLOADS_DIR", "EMDASH_SITE_URL"]) {
    for (const value of ["", "configured"]) {
      const r = runVerifier(t, "browser", { VERIFY_E2E_PROJECTS: mobile, [name]: value });
      assert.equal(r.status, 0); assert.equal(builds(r), 1, `${name}=${value}`);
    }
  }
});

test("full always builds while quick and invalid modes preserve their contracts", (t) => {
  const full = runVerifier(t, "full", { VERIFY_E2E_PROJECTS: mobile });
  assert.equal(full.status, 0); assert.equal(builds(full), 1);
  assert.ok(full.calls.includes("pnpm:exec astro check"));
  assert.ok(full.calls.includes("node:--test tests/workflows/*.test.mjs"));
  const quick = runVerifier(t, "quick", { VERIFY_E2E_PROJECTS: mobile });
  assert.equal(quick.status, 0); assert.equal(builds(quick), 0);
  assert.ok(!quick.calls.some((s) => s.includes("playwright")));
  const invalid = runVerifier(t, "invalid", { VERIFY_E2E_PROJECTS: mobile });
  assert.equal(invalid.status, 2); assert.deepEqual(invalid.calls, []);
});

test("build and browser failures remain visible and stop success reporting", (t) => {
  const build = runVerifier(t, "browser", { TEST_BUILD_EXIT: "23" });
  assert.equal(build.status, 23); assert.ok(!build.calls.some((s) => s.includes("playwright")));
  const browser = runVerifier(t, "browser", { VERIFY_E2E_PROJECTS: mobile, TEST_BROWSER_EXIT: "19" });
  assert.equal(browser.status, 19); assert.doesNotMatch(browser.stdout, /browser passed/u);
});
