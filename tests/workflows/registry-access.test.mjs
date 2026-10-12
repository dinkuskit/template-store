import assert from "node:assert/strict";
import test from "node:test";
import { access } from "@emdash-cms/cloudflare";
import { authenticate } from "@emdash-cms/cloudflare/auth";
import { registryAccessOptions, selectedRegistryAccessOptions } from "../../scripts/registry-access.mjs";

const enabled = {
  DINKUS_REGISTRY_ACCESS_ENABLED: "1",
  DINKUS_REGISTRY_ACCESS_TEAM_DOMAIN: "test-team.cloudflareaccess.com",
  DINKUS_HOSTING_PROFILE: "cloudflare",
  DINKUS_WRANGLER_CONFIG: "runs/registry/wrangler.jsonc",
};

test("only a selected Registry Cloudflare build enables Access", () => {
  assert.equal(selectedRegistryAccessOptions({}), undefined);
  assert.equal(selectedRegistryAccessOptions({ ...enabled, DINKUS_WRANGLER_CONFIG: "wrangler.jsonc" }), undefined);
  assert.equal(selectedRegistryAccessOptions({ ...enabled, DINKUS_HOSTING_PROFILE: "node" }), undefined);
  assert.equal(selectedRegistryAccessOptions({ ...enabled, DINKUS_REGISTRY_ACCESS_ENABLED: "0" }), undefined);
  assert.deepEqual(selectedRegistryAccessOptions(enabled), registryAccessOptions(enabled));
});

test("Access leaves first-user provisioning upstream and gives later users Subscriber", () => {
  assert.deepEqual(registryAccessOptions(enabled), {
    teamDomain: "test-team.cloudflareaccess.com",
    audienceEnvVar: "CF_ACCESS_AUDIENCE",
    autoProvision: true, defaultRole: 10, syncRoles: false, syncName: false,
  });
});


test("the installed adapter accepts our descriptor and rejects anonymous requests", async () => {
  const options = registryAccessOptions(enabled);
  const descriptor = access(options);
  assert.equal(descriptor.type, "cloudflare-access");
  assert.equal(descriptor.entrypoint, "@emdash-cms/cloudflare/auth");
  assert.equal(descriptor.config.audienceEnvVar, "CF_ACCESS_AUDIENCE");
  assert.equal(descriptor.config.defaultRole, 10);
  assert.equal(descriptor.config.autoProvision, true);
  assert.equal(descriptor.config.syncRoles, false);
  await assert.rejects(authenticate(new Request("https://store.example.test/_emdash/admin"), options), /No Access JWT present/);
});
