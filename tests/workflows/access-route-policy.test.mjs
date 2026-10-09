import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = new URL("../..", import.meta.url);

test("generated Access policy has no plugin wildcard and exposes only declared public Commerce routes", async () => {
  const result = await execFileAsync(process.execPath, ["scripts/verify-access-routes.mjs"], {
    cwd: root,
    encoding: "utf8",
  });
  const policy = JSON.parse(result.stdout);
  assert.equal(policy.wildcardPluginBypass, false);
  assert.deepEqual(policy.checkoutDisabled.bypasses, []);
  assert.deepEqual(policy.commerce.publicRoutes, [
    "/_emdash/api/plugins/dinkus-commerce/catalog/public",
    "/_emdash/api/plugins/dinkus-commerce/catalog/public/item",
    "/_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare",
    "/_emdash/api/plugins/dinkus-commerce/checkout/guest/start",
    "/_emdash/api/plugins/dinkus-commerce/checkout/guest/status",
  ]);
  assert.deepEqual(policy.payments.publicRoutes, []);
  assert.deepEqual(policy.undeclaredRoutes, [
    "/_emdash/api/plugins/dinkus-commerce/admin",
  ]);
});

test("check mode fails closed when an upstream route is undeclared", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/verify-access-routes.mjs", "--check"], {
      cwd: root,
      encoding: "utf8",
    }),
    (error) => /lack an explicit public\/admin declaration/u.test(`${error.stdout}\n${error.stderr}`),
  );
});
