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
  assert.equal(policy.authority.kind, "source-pin");
  assert.equal(policy.authority.deploymentReady, false);
  assert.match(policy.authority.commerceSourceCommit, /^[0-9a-f]{40}$/u);
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

test("wildcard audit checks only deployment policy inputs and catches named-plugin wildcards", async () => {
  const dir = await mkdtemp(join(tmpdir(), "access-routes-policy-"));
  try {
    await writeFile(join(dir, "DEPLOY.md"), [
      "Exact route: /_emdash/api/plugins/dinkus-commerce/catalog/public",
      "Wildcard route: /_emdash/api/plugins/dinkus-commerce/*",
    ].join("\n"));
    await writeFile(join(dir, "wrangler.jsonc"), JSON.stringify({
      access: ["/_emdash/api/plugins/dinkus-payments/checkout"],
    }));
    const commerce = await mkdtemp(join(tmpdir(), "access-routes-commerce-"));
    try {
      await mkdir(join(commerce, "src"), { recursive: true });
      await writeFile(join(commerce, "src/plugin.ts"), [
        "const plugin = {",
        "  routes: {",
        '    "catalog/public": pluginRoute({ public: true, methods: ["GET"] }),',
        "  },",
        "};",
        "",
      ].join("\n"));
      const env = {
        ...process.env,
        ACCESS_ROUTES_COMMERCE_ROOT: commerce,
        ACCESS_ROUTES_POLICY_ROOT: dir,
      };
      const wildcardResult = await execFileAsync(
        process.execPath,
        ["scripts/verify-access-routes.mjs"],
        { cwd: root, encoding: "utf8", env },
      );
      assert.equal(JSON.parse(wildcardResult.stdout).wildcardPluginBypass, true);
      for (const path of [
        "/_emdash/api/plugins/*",
        "/_emdash/api/plugins/<plugin>/*",
        "/_emdash/api/plugins/{plugin}/*",
        "/_emdash/api/plugins/dinkus-commerce/*",
      ]) {
        await writeFile(join(dir, "DEPLOY.md"), path);
        await assert.rejects(
          execFileAsync(process.execPath, ["scripts/verify-access-routes.mjs", "--check"], {
            cwd: root, encoding: "utf8", env,
          }),
          (error) => /a wildcard plugin bypass is present/u.test(error.stderr),
        );
      }

      await writeFile(join(dir, "DEPLOY.md"), [
        "Exact route: /_emdash/api/plugins/dinkus-commerce/catalog/public",
        "Exact route: /_emdash/api/plugins/dinkus-commerce/catalog/public/item",
      ].join("\n"));
      const exactResult = await execFileAsync(
        process.execPath,
        ["scripts/verify-access-routes.mjs"],
        { cwd: root, encoding: "utf8", env },
      );
      assert.equal(JSON.parse(exactResult.stdout).wildcardPluginBypass, false);
    } finally {
      await rm(commerce, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("route ids resolve from any Commerce module and unresolved ids fail closed", async () => {
  const commerce = await mkdtemp(join(tmpdir(), "access-routes-"));
  try {
    await mkdir(join(commerce, "src/features/policies"), { recursive: true });
    await writeFile(join(commerce, "src/features/policies/public.ts"), 'export const POLICIES_ROUTE = "policies/public";\n');
    await writeFile(join(commerce, "src/plugin.ts"), [
      'import { POLICIES_ROUTE } from "./features/policies/public.js";',
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

test("quoted Commerce route keys are included and undeclared keys fail check mode", async () => {
  const commerce = await mkdtemp(join(tmpdir(), "access-routes-quoted-"));
  try {
    await mkdir(join(commerce, "src"), { recursive: true });
    await writeFile(join(commerce, "src/plugin.ts"), [
      "const plugin = {",
      "  routes: {",
      '    \'catalog/public\': pluginRoute({ public: true, methods: ["GET"] }),',
      '    "admin": pluginRoute({ methods: ["GET"] }),',
      "  },",
      "};",
      "",
    ].join("\n"));
    const env = { ...process.env, ACCESS_ROUTES_COMMERCE_ROOT: commerce };
    const result = await execFileAsync(
      process.execPath,
      ["scripts/verify-access-routes.mjs"],
      { cwd: root, encoding: "utf8", env },
    );
    const policy = JSON.parse(result.stdout);
    assert.deepEqual(policy.commerce.publicRoutes, [
      "/_emdash/api/plugins/dinkus-commerce/catalog/public",
    ]);
    assert.deepEqual(policy.undeclaredRoutes, [
      "/_emdash/api/plugins/dinkus-commerce/admin",
    ]);
    await assert.rejects(
      execFileAsync(
        process.execPath,
        ["scripts/verify-access-routes.mjs", "--check"],
        { cwd: root, encoding: "utf8", env },
      ),
      (error) => /lack an explicit public\/admin declaration: \/_emdash\/api\/plugins\/dinkus-commerce\/admin/u.test(
        `${error.stdout}\n${error.stderr}`,
      ),
    );
  } finally {
    await rm(commerce, { recursive: true, force: true });
  }
});

test("Payments manifest routes become bypasses only when exact and authenticated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "access-routes-payments-"));
  // Fixtures are outside the deployment-policy text audit.
  const pluginWide = "/_emdash/api/plugins/" + "*";
  try {
    const manifest = join(dir, "payments-route-manifest.json");
    await writeFile(manifest, JSON.stringify({
      routes: [
        { path: "/webhooks/authorize-net/site-1", public: true, method: "POST", surface: "hosted", auth: "provider-signature" },
        { path: pluginWide, public: true, method: "POST" },
        { path: "/_emdash/api/plugins/dinkus-payments/*", public: true, method: "POST" },
        { path: "/_emdash/api/plugins/dinkus-commerce/admin", public: true, method: "POST", surface: "registry", auth: "provider-signature" },
        { path: "/webhooks/authorize-net/{siteId}", public: true, method: "POST", surface: "hosted", auth: "provider-signature" },
        { path: "/webhooks/stripe", public: true, method: "POST", surface: "hosted", auth: "provider-signature" },
        { path: "/webhooks/not-a-provider", public: true, method: "POST", surface: "hosted", auth: "provider-signature" },
        { path: "/_emdash/api/plugins/dinkus-payments", public: true, method: "POST" },
        { path: "/_emdash/api/plugins/dinkus-payments/admin", public: false, method: "POST" },
      ],
    }));
    const args = ["scripts/verify-access-routes.mjs", `--payments-manifest=${manifest}`];
    const result = await execFileAsync(process.execPath, args, { cwd: root, encoding: "utf8" });
    const policy = JSON.parse(result.stdout);
    assert.deepEqual(policy.payments.publicRoutes, ["/webhooks/authorize-net/site-1", "/webhooks/stripe"]);
    assert.deepEqual(policy.invalidPublicRoutes.map(({ path }) => path), [
      pluginWide,
      "/_emdash/api/plugins/dinkus-payments/*",
      "/_emdash/api/plugins/dinkus-commerce/admin",
      "/webhooks/authorize-net/{siteId}",
      "/webhooks/not-a-provider",
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
        /Payments registry route must belong to dinkus-payments/u.test(`${error.stdout}\n${error.stderr}`) &&
        /outside the documented provider webhook paths/u.test(`${error.stdout}\n${error.stderr}`),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Payments rejects every auth declaration except provider-signature", async () => {
  const dir = await mkdtemp(join(tmpdir(), "access-routes-payments-auth-"));
  try {
    const commerce = join(dir, "commerce");
    await mkdir(join(commerce, "src"), { recursive: true });
    await writeFile(join(commerce, "src/plugin.ts"), [
      "const plugin = {",
      "  routes: {",
      '    "catalog/public": pluginRoute({',
      "      public: true,",
      '      methods: ["GET"],',
      "    }),",
      "  },",
      "};",
      "",
    ].join("\n"));
    const manifest = join(dir, "payments-route-manifest.json");
    const rejectedAuth = ["none", "public", "unknown", "", "   ", 42];
    await writeFile(manifest, JSON.stringify({
      routes: [
        { path: "/webhooks/stripe", public: true, method: "POST", surface: "hosted", auth: "provider-signature" },
        ...rejectedAuth.map((auth, index) => ({
          path: `/webhooks/authorize-net/rejected-${index}`,
          public: true,
          method: "POST",
          surface: "hosted",
          auth,
        })),
      ],
    }));
    const args = [
      "scripts/verify-access-routes.mjs",
      `--payments-manifest=${manifest}`,
    ];
    const env = { ...process.env, ACCESS_ROUTES_COMMERCE_ROOT: commerce };
    const result = await execFileAsync(process.execPath, [...args], { cwd: root, encoding: "utf8", env });
    const policy = JSON.parse(result.stdout);
    assert.deepEqual(policy.payments.publicRoutes, ["/webhooks/stripe"]);
    assert.deepEqual(
      policy.invalidPublicRoutes.filter(({ path }) => path.startsWith("/webhooks/authorize-net/rejected-")).map(({ path }) => path),
      rejectedAuth.map((_, index) => `/webhooks/authorize-net/rejected-${index}`),
    );

    await assert.rejects(
      execFileAsync(process.execPath, [...args, "--check"], { cwd: root, encoding: "utf8", env }),
      (error) => {
        const output = `${error.stdout}\n${error.stderr}`;
        return /must declare auth exactly as provider-signature/u.test(output) &&
          !/lack an explicit public\/admin declaration/u.test(output);
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("route ids follow plugin import bindings and do not use colliding filesystem exports", async () => {
  const commerce = await mkdtemp(join(tmpdir(), "access-routes-imports-"));
  try {
    await mkdir(join(commerce, "src"), { recursive: true });
    await writeFile(join(commerce, "src/a.ts"), 'export const PUBLIC_ROUTE = "catalog/from-a";\n');
    await writeFile(join(commerce, "src/b.ts"), 'export const PUBLIC_ROUTE = "catalog/from-b";\n');
    await writeFile(join(commerce, "src/plugin.ts"), [
      'import { PUBLIC_ROUTE as LEGITIMATE_ROUTE } from "./a.js";',
      "const plugin = {",
      "  routes: {",
      "    [LEGITIMATE_ROUTE]: pluginRoute({ public: true, methods: [\"GET\"] }),",
      "  },",
      "};",
      "",
    ].join("\n"));
    const env = { ...process.env, ACCESS_ROUTES_COMMERCE_ROOT: commerce };
    const result = await execFileAsync(process.execPath, ["scripts/verify-access-routes.mjs"], {
      cwd: root,
      encoding: "utf8",
      env,
    });
    const policy = JSON.parse(result.stdout);
    assert.deepEqual(policy.commerce.publicRoutes, [
      "/_emdash/api/plugins/dinkus-commerce/catalog/from-a",
    ]);
    assert.equal(policy.commerce.publicRoutes.includes("/_emdash/api/plugins/dinkus-commerce/catalog/from-b"), false);
    assert.deepEqual(policy.unresolvedRouteIds, []);
  } finally {
    await rm(commerce, { recursive: true, force: true });
  }
});
