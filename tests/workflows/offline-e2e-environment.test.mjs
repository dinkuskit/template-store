import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOfflineE2EEnvironment,
  validateOfflineE2EOptions,
} from "../../scripts/lib/offline-e2e-environment.mjs";

const root = "/workspace/template-store";

test("builds a shipping child environment from disposable paths and loopback origin", () => {
  const env = buildOfflineE2EEnvironment({
    PATH: "/bin",
    HOME: "/tmp/home",
    HOSTILE_CHECKOUT_TOKEN: "must-not-forward",
    PAYMENT_API_KEY: "must-not-forward",
    EMDASH_SITE_URL: "https://hostile.example.invalid",
    DINKUS_TEMPLATE_DB_URL: "file:./production.db",
    DINKUS_TEMPLATE_UPLOADS_DIR: "/production/uploads",
    DINKUS_CATALOG_PROFILE: "native-development",
    DINKUS_HOSTING_PROFILE: "cloudflare",
    DINKUS_WRANGLER_CONFIG: "/production/wrangler.json",
    NODE_OPTIONS: "--import=./untrusted.mjs",
  }, {
    root,
    profile: "shipping",
    port: "4638",
  });

  assert.equal(env.DINKUS_STOREFRONT_PROFILE, "shipping");
  assert.equal(env.DINKUS_TEMPLATE_DB_URL, "file:./.artifacts/e2e-shipping/content.db");
  assert.equal(env.DINKUS_TEMPLATE_UPLOADS_DIR, "./.artifacts/e2e-shipping/uploads");
  assert.equal(env.EMDASH_SITE_URL, "http://127.0.0.1:4638");
  assert.equal(env.PATH, "/bin");
  for (const key of ["DINKUS_CATALOG_PROFILE", "DINKUS_HOSTING_PROFILE", "DINKUS_WRANGLER_CONFIG", "NODE_OPTIONS"]) {
    assert.equal(key in env, false);
  }
  assert.equal("HOSTILE_CHECKOUT_TOKEN" in env, false);
  assert.equal("PAYMENT_API_KEY" in env, false);
  assert.equal("DINKUS_TEMPLATE_DB_URL" in env && env.DINKUS_TEMPLATE_DB_URL.includes("production"), false);
});

test("validates profile and port before a disposable reset can be attempted", () => {
  assert.throws(
    () => validateOfflineE2EOptions({ root, profile: "production", port: 4638 }),
    /unknown profile/,
  );
  assert.throws(
    () => validateOfflineE2EOptions({ root, profile: "proof", port: "not-a-port" }),
    /invalid port/,
  );
  assert.throws(
    () => validateOfflineE2EOptions({ root, profile: "proof", port: 65_536 }),
    /invalid port/,
  );
});

test("pins proof to its own disposable database and upload root", () => {
  const env = buildOfflineE2EEnvironment({}, {
    root,
    profile: "proof",
    port: 4637,
  });

  assert.equal(env.DINKUS_CATALOG_PROFILE, "native-development");
  assert.deepEqual(
    {
      db: env.DINKUS_TEMPLATE_DB_URL,
      uploads: env.DINKUS_TEMPLATE_UPLOADS_DIR,
      site: env.EMDASH_SITE_URL,
    },
    {
      db: "file:./.artifacts/e2e/content.db",
      uploads: "./.artifacts/e2e/uploads",
      site: "http://127.0.0.1:4637",
    },
  );
});

test("launcher validated options compose with the environment builder for both profiles", () => {
  for (const profile of ["proof", "shipping"]) {
    const options = validateOfflineE2EOptions({ root, profile, port: 4637 });
    const env = buildOfflineE2EEnvironment({}, options);
    assert.equal(options.root, root);
    assert.equal(env.DINKUS_TEMPLATE_DB_URL, `file:./${options.relativeDir}/content.db`);
    assert.equal(env.EMDASH_SITE_URL, options.siteOrigin);
  }
});
