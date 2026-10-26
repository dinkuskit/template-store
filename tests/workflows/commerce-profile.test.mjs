import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { commerceProfile, commerceProfileDefine } from "../../src/features/commerce-profile/profiles.mjs";
import { extractCommerceRoutes } from "../../scripts/access-route-extractor.mjs";
const tools = createRequire(createRequire(import.meta.url).resolve("wrangler/package.json"));
const { build } = await import(pathToFileURL(tools.resolve("esbuild")));
const manifestBytes = await readFile(new URL("../fixtures/commerce-beta/manifest.json", import.meta.url));
const manifest = JSON.parse(manifestBytes);

test("beta contract is the exact qualified package manifest, with private routes preserved", () => {
  assert.equal(createHash("sha256").update(manifestBytes).digest("hex"), "86cbba303b8780f7a1dfc74dfa7af3404215975f89a98aa4403596992de16e5e");
  assert.equal(manifest.id, commerceProfile("beta").packageId);
  assert.equal(manifest.version, "0.3.0-beta.0");
  assert.equal(manifest.routes.length, 9);
  for (const route of ["admin", "orders"]) assert.equal(manifest.routes.find(r => r.name === route).public, false);
});

for (const profile of ["stable", "beta"]) {
  const { runtimeId } = commerceProfile(profile);
  const otherId = commerceProfile(profile === "stable" ? "beta" : "stable").runtimeId;
  test(`${profile}: server and browser share one immutable namespace; other/private routes stay closed`, async () => {
    await mkdir("runs", { recursive: true });
    const directory = await mkdtemp(join(process.cwd(), "runs/profile-contract-"));
    try {
      const source = `export * from './src/features/guest-cart/checkout-protocol.ts';
        export * from './src/features/guest-cart/checkout-admission.ts';
        export * from './src/features/commerce-catalog/installed.ts';
        export * from './src/features/security/public-boundary.ts';
        export {createPublicPluginApiRouteHandler} from './node_modules/emdash/src/astro/public-plugin-api-routes.ts';`;
      for (const platform of ["node", "browser"]) {
        const outfile = join(directory, platform + ".mjs");
        await build({ stdin: { resolveDir: process.cwd(), contents: source }, bundle: true, platform, format: "esm", outfile,
          define: commerceProfileDefine({ DINKUS_COMMERCE_PROFILE: profile }) });
        const api = await import(pathToFileURL(outfile));
        assert.equal(api.COMMERCE_REGISTRY_RUNTIME_ID, runtimeId);
        assert.equal(api.GUEST_CHECKOUT_PREPARE_ENDPOINT, `/_emdash/api/plugins/${runtimeId}/checkout/guest/prepare`);
        assert.equal(api.GUEST_CHECKOUT_START_ENDPOINT, `/_emdash/api/plugins/${runtimeId}/checkout/guest/start`);
        assert.equal(api.GUEST_CHECKOUT_STATUS_ENDPOINT, "/api/checkout/status");
        for (const route of ["prepare", "start", "status"]) {
          assert.equal(api.evaluatePublicBoundary("POST", `/_emdash/api/plugins/${runtimeId}/checkout/guest/${route}`).allowed, true);
          assert.equal(api.isExactGuestCheckoutPath(`/_emdash/api/plugins/${otherId}/checkout/guest/${route}`), false);
          assert.equal(api.evaluatePublicBoundary("POST", `/_emdash/api/plugins/${otherId}/checkout/guest/${route}`).allowed, false);
        }
        for (const path of ["admin", "orders", "checkout/guest/start/extra"]) {
          assert.equal(api.evaluatePublicBoundary("POST", `/_emdash/api/plugins/${runtimeId}/${path}`).allowed, false);
        }
        const calls = [];
        const backend = {
          getPluginRouteMeta: (id, path) => id === runtimeId ? manifest.routes.find(r => r.name === path) ?? null : null,
          async handlePluginApiRoute(id, method, path, request) {
            calls.push({ id, method, path, url: request.url });
            return { success: true, data: path === "checkout/guest/readiness"
              ? { schema: api.CHECKOUT_READINESS_SCHEMA, status: "supported", mode: "test" }
              : path === "catalog/public" ? { products: [] } : null };
          },
        };
        const runtime = { ...backend, handlePublicPluginApiRoute: api.createPublicPluginApiRouteHandler(backend) };
        const request = new Request("https://store.example.test/");
        assert.deepEqual(await api.readInstalledCommerceCatalog({ runtime, request }), []);
        assert.equal((await api.acquireGuestCheckoutAdmission({ runtime, request })).pluginId, runtimeId);
        assert.deepEqual(calls.map(c => c.path), ["catalog/public", "checkout/guest/readiness"]);
        assert.ok(calls.every(c => c.id === runtimeId && c.url.startsWith(`https://store.example.test/_emdash/api/plugins/${runtimeId}/`)));
        const privateResult = await runtime.handlePublicPluginApiRoute(runtimeId, "POST", "admin", request);
        assert.equal(privateResult.error.code, "NOT_FOUND");
        const wrong = { ...runtime, getPluginRouteMeta: () => null };
        assert.equal(await api.acquireGuestCheckoutAdmission({ runtime: wrong, request }), null);
        await assert.rejects(() => api.readInstalledCommerceCatalog({ runtime: wrong, request }));
        assert.equal(api.resolveGuestCheckoutAdmission({ runtime, catalog: { pluginId: otherId, sameCatalogNamespace: true, checkoutConfiguration: "supported" } }), null);
        for (const bad of [{ public: false, methods: ["POST"] }, { public: true, methods: ["GET"] }, null]) {
          const denied = { ...runtime, getPluginRouteMeta: (id, path) => path === "checkout/guest/start" ? bad : backend.getPluginRouteMeta(id, path) };
          assert.equal(api.canDispatchInstalledGuestCheckout({ runtime: denied, request }), false);
        }
        const transports = [];
        const transport = { fetch: async (url) => { transports.push(url); return Response.json({ok:false,error:{code:"CAPABILITY_DENIED"}}); } };
        await api.callGuestCheckout({kind:"prepare"}, null, transport);
        const retention = { capabilityId: "cap", capability: "cap.synthetic", attemptId: null };
        await api.callGuestCheckout({kind:"start", intent:{version:1,lines:[{id:"one",quantity:1}]}}, retention, transport);
        await api.callGuestCheckout({kind:"status"}, retention, transport);
        assert.deepEqual(transports, [api.GUEST_CHECKOUT_PREPARE_ENDPOINT, api.GUEST_CHECKOUT_START_ENDPOINT, api.GUEST_CHECKOUT_STATUS_ENDPOINT]);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  test(`${profile}: Access AST preview uses same identity and retains strict metadata`, () => {
    const source = ".artifacts/source-deps/commerce/src/plugin.ts";
    const extracted = extractCommerceRoutes(source, { profile });
    assert.equal(extracted.unsupported.length, 0);
    const shopperAccountRoutes = [
      { name: "account/sign-in/start", methods: ["POST"], public: true },
      { name: "account/sign-in/verify", methods: ["POST"], public: true },
      { name: "account/sign-out", methods: ["POST"], public: true },
      { name: "account/orders", methods: ["GET"], public: true },
      { name: "account/profile", methods: ["GET", "POST"], public: true },
    ];
    // Commerce 0.5.0 adds Connect's public receipt route after the store policies route.
    const manifestRoutes = manifest.routes.map(({ name, methods, public: isPublic }) => ({ name, methods, public: isPublic }));
    const connectReceiptAt = manifestRoutes.findIndex((route) => route.name === "policies/public") + 1;
    // Commerce 0.6.0 adds the product panel and the publish check, both private, after admin.
    const productScreenAt = manifestRoutes.findIndex((route) => route.name === "admin") + 1;
    assert.deepEqual(
      extracted.routes.map(({ name, methods, public: isPublic }) => ({ name, methods, public: isPublic })),
      [
        ...manifestRoutes.slice(0, connectReceiptAt),
        { name: "store-proof", methods: ["GET"], public: true },
        ...manifestRoutes.slice(connectReceiptAt, productScreenAt),
        { name: "product-panel", methods: ["POST"], public: false },
        { name: "catalog-items/set-on-sale", methods: ["POST"], public: false },
        ...manifestRoutes.slice(productScreenAt),
        ...shopperAccountRoutes,
      ],
    );
    assert.ok(extracted.routes.every(r => r.path.startsWith(`/_emdash/api/plugins/${runtimeId}/`)));
    assert.equal(extracted.routes.find(r => r.name === "admin").public, false);
    for (const route of ["checkout/guest/prepare", "checkout/guest/start", "checkout/guest/status"]) {
      assert.equal(extracted.routes.find(r => r.name === route).public, true);
    }
    assert.throws(() => extractCommerceRoutes(source, { profile: otherId }), /DINKUS_COMMERCE_PROFILE/);
  });
}
