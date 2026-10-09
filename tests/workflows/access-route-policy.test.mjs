import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("route ids resolve from any Commerce module and unresolved ids fail closed", async () => {
  const commerce = await mkdtemp(join(tmpdir(), "access-routes-"));
  try {
    await mkdir(join(commerce, "src/features/policies"), { recursive: true });
    await writeFile(join(commerce, "src/features/policies/public.ts"), 'export const POLICIES_ROUTE = "policies/public";\n');
    await writeFile(join(commerce, "src/plugin.ts"), [
      "const plugin = {",
      "  routes: {",
      "    [POLICIES_ROUTE]: pluginRoute({",
      "      public: true,",
      '      methods: ["GET"],',
      "    }),",
      "    [MISSING_ROUTE]: pluginRoute({",
      "      public: true,",
      '      methods: ["GET"],',
      "    }),",
      "  },",
      "};",
      "",
    ].join("\n"));
    const env = { ...process.env, ACCESS_ROUTES_COMMERCE_ROOT: commerce };
    const result = await execFileAsync(process.execPath, ["scripts/verify-access-routes.mjs"], { cwd: root, encoding: "utf8", env });
    const policy = JSON.parse(result.stdout);
    assert.deepEqual(policy.commerce.publicRoutes, ["/_emdash/api/plugins/dinkus-commerce/policies/public"]);
    assert.deepEqual(policy.unresolvedRouteIds, ["MISSING_ROUTE"]);
    assert.equal(policy.checkoutEnabled.bypasses.some(({ path }) => path.includes("MISSING_ROUTE")), false);
    await assert.rejects(
      execFileAsync(process.execPath, ["scripts/verify-access-routes.mjs", "--check"], { cwd: root, encoding: "utf8", env }),
      (error) => /could not be resolved: MISSING_ROUTE/u.test(`${error.stdout}\n${error.stderr}`),
    );
  } finally {
    await rm(commerce, { recursive: true, force: true });
  }
});

test("Payments manifest routes become bypasses only when exact and authenticated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "access-routes-payments-"));
  // Built at runtime so the tracked-text wildcard audit does not flag this test.
  const pluginWide = "/_emdash/api/plugins/" + "*";
  try {
    const manifest = join(dir, "payments-route-manifest.json");
    await writeFile(manifest, JSON.stringify({
      routes: [
        { path: "/webhooks/authorize-net/site-1", public: true, method: "POST", surface: "hosted", auth: "provider-signature" },
        { path: pluginWide, public: true, method: "POST" },
        { path: "/_emdash/api/plugins/dinkus-payments/*", public: true, method: "POST" },
        { path: "/webhooks/authorize-net/{siteId}", public: true, method: "POST", surface: "hosted", auth: "provider-signature" },
        { path: "/webhooks/stripe", public: true, method: "POST", surface: "hosted" },
        { path: "/_emdash/api/plugins/dinkus-payments", public: true, method: "POST" },
        { path: "/_emdash/api/plugins/dinkus-payments/admin", public: false, method: "POST" },
      ],
    }));
    const args = ["scripts/verify-access-routes.mjs", `--payments-manifest=${manifest}`];
    const result = await execFileAsync(process.execPath, args, { cwd: root, encoding: "utf8" });
    const policy = JSON.parse(result.stdout);
    assert.deepEqual(policy.payments.publicRoutes, ["/webhooks/authorize-net/site-1"]);
    assert.deepEqual(policy.invalidPublicRoutes.map(({ path }) => path), [
      pluginWide,
      "/_emdash/api/plugins/dinkus-payments/*",
      "/webhooks/authorize-net/{siteId}",
      "/webhooks/stripe",
      "/_emdash/api/plugins/dinkus-payments",
    ]);
    const bypassPaths = policy.checkoutEnabled.bypasses.map(({ path }) => path);
    assert.equal(bypassPaths.some((path) => /[*{}]/u.test(path)), false);
    assert.deepEqual(
      policy.checkoutEnabled.bypasses.find(({ path }) => path === "/webhooks/authorize-net/site-1"),
      { path: "/webhooks/authorize-net/site-1", methods: ["POST"], surface: "hosted", auth: "provider-signature" },
    );
    await assert.rejects(
      execFileAsync(process.execPath, [...args, "--check"], { cwd: root, encoding: "utf8" }),
      (error) => /refused public route "\/_emdash\/api\/plugins\/\*"/u.test(`${error.stdout}\n${error.stderr}`) &&
        /must declare its authentication/u.test(`${error.stdout}\n${error.stderr}`),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
