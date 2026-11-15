import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { selectedRegistrySandboxRunner } from "../../scripts/registry-sandbox.mjs";

test("only Registry Cloudflare selects the bounded runner", () => {
  const selected = { DINKUS_HOSTING_PROFILE: "cloudflare", DINKUS_WRANGLER_CONFIG: "runs/registry/wrangler.jsonc" };
  const path = fileURLToPath(new URL("../../src/features/registry-sandbox/runner.ts", import.meta.url));
  assert.equal(selectedRegistrySandboxRunner(selected), path);
  assert.equal(selectedRegistrySandboxRunner({ ASTRO_ADAPTER: "cloudflare", DINKUS_WRANGLER_CONFIG: selected.DINKUS_WRANGLER_CONFIG }), path);
  for (const env of [{}, { ...selected, DINKUS_HOSTING_PROFILE: "node" },
    { ...selected, DINKUS_WRANGLER_CONFIG: "wrangler.playground.jsonc" },
    { ...selected, DINKUS_WRANGLER_CONFIG: "wrangler.playground.jsonc" }]) {
    assert.equal(selectedRegistrySandboxRunner(env), undefined);
  }
});
