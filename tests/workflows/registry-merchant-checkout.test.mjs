import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { PluginStorageRepository, createSettingsAccess } from "emdash";
import { OptionsRepository } from "emdash/internal/plugins/host";
import { WorkerdSandboxRunner } from "@emdash-cms/sandbox-workerd/sandbox";

const root = resolve(import.meta.dirname, "../..");

// Explicit local-candidate input. Ordinary CI reports a real skip; the dedicated
// verification command requires this input and cannot silently pass without it.
const ARTIFACT_DIR = process.env.COMMERCE_READINESS_ARTIFACT_DIR;
if (ARTIFACT_DIR) assert.ok(existsSync(ARTIFACT_DIR), "configured artifact directory must exist");
const artifactTest = (name, run) => test(name, { skip: ARTIFACT_DIR ? false : "Commerce candidate artifacts not supplied" }, run);
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL?.startsWith(pathToFileURL(join(root, "src/")).href)) {
    const source = new URL(specifier.slice(0, -3) + ".ts", context.parentURL);
    if (existsSync(fileURLToPath(source))) return next(source.href, context);
  }
  return next(specifier, context);
} });

const EXPECTED_HASHES = {
  "registry-dinkus-commerce-0.1.0.tar.gz":
    "f870b1eafc868ccfa832cb682d3bbeeee8027696cdad7fc02d8ab33de2bf9339",
  "dinkuskit-commerce-0.1.0.tgz":
    "13e0531ea36cf67267f7aa98782a644e2ee1d231886e16be4cec252cd01636ba",
  "route-manifest.json":
    "50b51ecc45896e4caa7bd74564c93a61ff6a1f90e91a9e81b0de5b7fa6f226e5",
  "backend.js":
    "8f3f771cb713044f1d6e638df1363bbe91e8da36ac4d778741ee8cf157752f81",
};

const EXPECTED_BACKEND_BYTES = 129442;

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

artifactTest("frozen Commerce candidate artifacts match qualification digests", () => {

  for (const [file, expectedHash] of Object.entries(EXPECTED_HASHES)) {
    if (file === "backend.js") continue;
    const filePath = join(ARTIFACT_DIR, file);
    assert.ok(existsSync(filePath), `artifact file must exist: ${file}`);
    const actualHash = sha256(readFileSync(filePath));
    assert.equal(actualHash, expectedHash, `hash must match for ${file}`);
  }
});

artifactTest("compiled installed Registry path executes catalog/readiness/prepare/start/status on same namespace with one-order settlement", async (t) => {

  const tarGzPath = join(ARTIFACT_DIR, "registry-dinkus-commerce-0.1.0.tar.gz");
  assert.ok(existsSync(tarGzPath), "registry tar.gz must exist");

  const proofRoot = join(root, ".artifacts");
  mkdirSync(proofRoot, { recursive: true });
  const tempDir = mkdtempSync(join(proofRoot, "reg-checkout-test-"));
  t.after(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  const {
    CHECKOUT_READINESS_SCHEMA, SUPPORTED_GUEST_CHECKOUT_ROUTES,
    acquireGuestCheckoutAdmission, readInstalledCheckoutReadiness,
  } = await import(pathToFileURL(join(root, "src/features/guest-cart/checkout-admission.ts")));
  const { COMMERCE_REGISTRY_RUNTIME_ID } = await import(pathToFileURL(join(root, "src/features/guest-cart/checkout-protocol.ts")));
  const { readInstalledCommerceCatalog } = await import(pathToFileURL(join(root, "src/features/commerce-catalog/installed.ts")));
  for (const [file, digest] of Object.entries(EXPECTED_HASHES)) {
    if (file !== "backend.js") assert.equal(sha256(readFileSync(join(ARTIFACT_DIR, file))), digest);
  }
  // The SDK validates named-host DNS before invoking the injected transport.
  // Intercept that validation too: this entire test refuses real network I/O.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return originalFetch(input, init);
    assert.equal(url.origin + url.pathname, "https://cloudflare-dns.com/dns-query", "unexpected real network request");
    assert.equal(url.searchParams.get("name"), "dinkuskit.com");
    return Response.json({ Status: 0, Answer: [{ type: 1, data: "9.9.9.9" }] });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  execFileSync("tar", ["-xzf", tarGzPath, "-C", tempDir]);

  const backendCode = readFileSync(join(tempDir, "backend.js"), "utf8");
  const manifestRaw = readFileSync(join(tempDir, "manifest.json"), "utf8");

  assert.equal(sha256(Buffer.from(backendCode)), EXPECTED_HASHES["backend.js"]);
  assert.equal(Buffer.byteLength(backendCode, "utf8"), EXPECTED_BACKEND_BYTES);

  const parsedManifest = JSON.parse(manifestRaw);
  assert.equal(parsedManifest.id, "dinkus-commerce");

  // Installed namespace: r_gshdrqaldna3r7sn
  const owner = COMMERCE_REGISTRY_RUNTIME_ID;
  const manifest = structuredClone(parsedManifest);
  manifest.id = owner;

  // Labeled local test fixture profile
  const SITE = "https://shop.example.test";
  const TRANSPORT_ORIGIN = "https://8.8.8.8";
  const ISSUER_ORIGIN = "https://dinkuskit.com";
  const AUDIENCE = "synthetic-payments";
  const SITE_ID = "synthetic-site";
  const BINDING = "synthetic-binding";
  const ACCOUNT = "acct_synthetic";
  const STORE_KEY = "synthetic store key";

  manifest.capabilities = ["network:request"];
  manifest.allowedHosts = ["8.8.8.8", "dinkuskit.com"];

  // RSA key pair for synthetic passes
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pubJwk = {
    ...publicKey.export({ format: "jwk" }),
    kid: "synthetic-proof",
    alg: "RS256",
    use: "sig",
  };

  function createPass(scope = "payments:checkout") {
    const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
    const header = { alg: "RS256", kid: pubJwk.kid };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: ISSUER_ORIGIN + "/account",
      aud: AUDIENCE,
      sub: "synthetic-owner",
      site_id: SITE_ID,
      scope,
      iat: now,
      exp: now + 1800,
    };
    const message = `${enc(header)}.${enc(payload)}`;
    const signature = sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64url");
    return `${message}.${signature}`;
  }

  function verifyPass(token) {
    const [h, p, s] = token.split(".");
    const message = `${h}.${p}`;
    const valid = verify("RSA-SHA256", Buffer.from(message), publicKey, Buffer.from(s, "base64url"));
    assert.ok(valid, "pass signature must be valid");
    return JSON.parse(Buffer.from(p, "base64url").toString());
  }

  // Set encryption key for emdash options
  process.env.EMDASH_ENCRYPTION_KEY =
    "emdash_enc_v1_" + randomBytes(32).toString("base64url");

  // Sqlite DB setup
  const sqlite = new BetterSqlite3(":memory:");
  sqlite.exec(`CREATE TABLE IF NOT EXISTS options (name TEXT PRIMARY KEY, value TEXT NOT NULL, revision TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS _plugin_storage (plugin_id TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL,
      data TEXT NOT NULL, revision TEXT NOT NULL DEFAULT '0', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(plugin_id,collection,id));
    CREATE TABLE IF NOT EXISTS _emdash_cron_tasks (id TEXT PRIMARY KEY, plugin_id TEXT NOT NULL, task_name TEXT NOT NULL,
      schedule TEXT NOT NULL, is_oneshot INTEGER NOT NULL DEFAULT 0, data TEXT, next_run_at TEXT NOT NULL, last_run_at TEXT,
      status TEXT NOT NULL DEFAULT 'idle', locked_at TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT,
      UNIQUE(plugin_id, task_name));`);

  const db = new Kysely({ dialect: new SqliteDialect({ database: sqlite }) });

  const collections = {};
  for (const [name, spec] of Object.entries(manifest.storage)) {
    collections[name] = new PluginStorageRepository(
      db,
      owner,
      name,
      [...spec.indexes, ...(spec.uniqueIndexes ?? [])],
    );
    for (const fields of spec.uniqueIndexes ?? []) {
      const fieldList = Array.isArray(fields) ? fields : [fields];
      const expressions = fieldList.map((f) => `json_extract(data, '$.${f}')`).join(",");
      sqlite.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS "uidx_plugin_${owner}_${name}_${fieldList.join("_")}" ON _plugin_storage(plugin_id,collection,${expressions})`,
      );
    }
  }

  // Seed sample catalog item
  await collections.catalog_items.put("hat", {
    recordKind: "catalog-item",
    itemId: "hat",
    commandId: "synthetic-create-hat",
    sku: "HAT",
    skuKey: "HAT",
    fulfillment: "digital",
    creationIntent: { manageStock: false },
    kind: "simple-product",
    name: "Everyday Hat",
    state: "draft",
    stockManagement: { mode: "unmanaged" },
    createdAt: new Date().toISOString(),
  });
  await collections.catalog_prices.put("hat", {
    recordKind: "catalog-price",
    recordId: "hat",
    catalogItemId: "hat",
    regular: { currency: "USD", minor: "2500" },
  });
  await collections.catalog_manual_availability.put("hat", {
    recordKind: "catalog-manual-availability",
    recordId: "hat",
    catalogItemId: "hat",
    status: "in-stock",
  });

  const settingsAccess = createSettingsAccess(
    new OptionsRepository(db),
    owner,
    manifest.admin.settingsSchema,
  );

  let paid = false;
  const sessions = new Map();

  async function mockTransport(urlStr, init) {
    const url = new URL(urlStr);
    const headers = new Headers(init.headers);

    if (url.origin === ISSUER_ORIGIN) {
      assert.equal(headers.get("authorization"), "Bearer " + STORE_KEY);
      const body = JSON.parse(
        typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body),
      );
      assert.equal(body.site_id, SITE_ID);
      assert.equal(body.scope, "payments:checkout");
      return Response.json({
        access_token: createPass("payments:checkout"),
        token_type: "Bearer",
        expires_in: 300,
      });
    }

    if (url.origin === TRANSPORT_ORIGIN) {
      const bearer = headers.get("authorization")?.replace(/^Bearer /, "");
      assert.ok(bearer);
      const claims = verifyPass(bearer);
      assert.equal(claims.site_id, SITE_ID);
      assert.equal(headers.get("x-dinkus-site"), SITE_ID);

      const path = url.pathname;
      if (path.endsWith("-binding")) {
        return Response.json({
          bindingRef: BINDING,
          providerId: "stripe",
          stripeAccountId: ACCOUNT,
          mode: "test",
          ready: true,
        });
      }

      if (path === "/v1/checkout/session" || path === "/v1/checkout/lookup") {
        const reqBody = JSON.parse(
          typeof init.body === "string" ? init.body : new TextDecoder().decode(init.body),
        );
        const attemptId = reqBody.attemptId;
        if (!sessions.has(attemptId)) {
          const now = Math.floor(Date.now() / 1000);
          sessions.set(attemptId, {
            sessionId: "cs_synthetic_" + attemptId,
            redirectUrl: "https://pay.example.test/synthetic",
            createdAt: now,
            expiresAt: now + 1800,
          });
        }
        const session = sessions.get(attemptId);
        return Response.json({
          outcome: paid ? "paid" : "open",
          attemptId,
          total: reqBody.total,
          session,
          ...(paid ? { paymentId: "pi_synthetic_" + attemptId } : {}),
        });
      }
    }

    return new Response("Not found", { status: 404 });
  }

  const runner = new WorkerdSandboxRunner({
    db,
    siteInfo: { name: "Synthetic Store", url: SITE, locale: "en" },
    httpFetch: mockTransport,
    limits: { wallTimeMs: 15000 },
  });
  assert.equal(runner.isAvailable(), true);

  t.after(async () => {
    await runner.terminateAll();
    await db.destroy();
  });

  const plugin = await runner.load(manifest, backendCode);

  // Expose runtime adapter interface matching Astro.locals.emdash
  const runtime = {
    getRuntimePluginSettingsSchema(pluginId) {
      return pluginId === owner ? (manifest.admin?.settingsSchema ?? {}) : null;
    },
    getPluginRouteMeta(pluginId, path) {
      if (pluginId !== owner) return null;
      const found = manifest.routes?.find((r) => r.name === path);
      if (!found) return null;
      return { public: found.public === true, methods: found.methods };
    },
    async handlePublicPluginApiRoute(pluginId, method, path, request) {
      if (pluginId !== owner) {
        return { success: false, error: { code: "NOT_FOUND", message: "Plugin route not found" } };
      }
      const meta = this.getPluginRouteMeta(pluginId, path);
      if (!meta?.public || !meta.methods?.includes(method)) {
        return { success: false, error: { code: "NOT_FOUND", message: "Plugin route not found" } };
      }
      const rawRes = await plugin.invokeRoute(path, undefined, {
        url: request.url,
        method,
        headers: Object.fromEntries(request.headers.entries()),
      });
      return { success: true, data: rawRes };
    },
  };

  const clientRequest = new Request(`${SITE}/cart`, { method: "GET" });
  const anonymousRuntime = { handlePublicPluginApiRoute: runtime.handlePublicPluginApiRoute.bind(runtime) };

  // 1. UNCONFIGURED CHECK: Readiness returns unavailable, admission stays null
  const unconfiguredReadiness = await readInstalledCheckoutReadiness({ runtime: anonymousRuntime, request: clientRequest });
  assert.deepEqual(unconfiguredReadiness, {
    schema: CHECKOUT_READINESS_SCHEMA,
    status: "unavailable",
  });

  const unconfiguredAdmission = await acquireGuestCheckoutAdmission({ runtime: anonymousRuntime, request: clientRequest });
  assert.equal(unconfiguredAdmission, null);

  // 2. CONFIGURE MERCH TEST CHECKOUT
  const checkoutConfig = {
    schema: "dinkuskit.commerce.registry-checkout/v1",
    enabled: true,
    commerceOrigin: SITE,
    siteId: SITE_ID,
    paymentsOrigin: TRANSPORT_ORIGIN,
    bindingRef: BINDING,
    providerId: "stripe",
    mode: "test",
    stripeAccountId: ACCOUNT,
    pricingSchema: "dinkuskit.commerce.checkout-pricing/v1",
    issuer: ISSUER_ORIGIN + "/account",
    audience: AUDIENCE,
    shipping: { configurationId: "shipping-synthetic", revision: 1, mode: "free" },
  };

  await settingsAccess.set("installedCheckout", JSON.stringify(checkoutConfig));
  await settingsAccess.set("storeKey", STORE_KEY);

  // 3. CATALOG ROUTE (catalog/public)
  const catalog = await readInstalledCommerceCatalog({ runtime: anonymousRuntime, request: clientRequest });
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0].id, "hat");
  assert.equal((await collections.checkout_carts.query()).items.length, 0);
  assert.equal((await collections.checkout_guest_capabilities.query()).items.length, 0);

  // 4. READINESS ROUTE via readInstalledCheckoutReadiness & acquireGuestCheckoutAdmission
  const configuredReadiness = await readInstalledCheckoutReadiness({ runtime: anonymousRuntime, request: clientRequest });
  assert.deepEqual(configuredReadiness, {
    schema: CHECKOUT_READINESS_SCHEMA,
    status: "supported",
    mode: "test",
  });

  const admission = await acquireGuestCheckoutAdmission({ runtime: anonymousRuntime, request: clientRequest });
  assert.notEqual(admission, null);
  assert.equal(admission.pluginId, owner);
  assert.equal(admission.catalog.sameCatalogNamespace, true);
  assert.equal(admission.catalog.checkoutConfiguration, "supported");
  assert.deepEqual(admission.routes, SUPPORTED_GUEST_CHECKOUT_ROUTES);

  assert.equal((await collections.checkout_carts.query()).items.length, 0);
  assert.equal((await collections.checkout_guest_capabilities.query()).items.length, 0);
  assert.equal((await collections.orders.query()).items.length, 0);

  // 5. PREPARE ROUTE (checkout/guest/prepare)
  const prepareRes = await plugin.invokeRoute("checkout/guest/prepare", {}, {
    url: `${SITE}/_emdash/api/plugins/${owner}/checkout/guest/prepare`,
    method: "POST",
    headers: { origin: SITE, "sec-fetch-site": "same-origin" },
  });
  assert.equal(prepareRes.ok, true);
  const capabilityToken = prepareRes.capability.capability;
  assert.ok(Boolean(capabilityToken));

  // 6. START ROUTE (checkout/guest/start)
  const startRes = await plugin.invokeRoute(
    "checkout/guest/start",
    {
      contact: { email: "shopper@example.test" },
      lines: [{ catalogItemId: "hat", quantity: 1 }],
    },
    {
      url: `${SITE}/_emdash/api/plugins/${owner}/checkout/guest/start`,
      method: "POST",
      headers: {
        origin: SITE,
        "sec-fetch-site": "same-origin",
        "x-commerce-guest-capability": capabilityToken,
      },
    },
  );
  assert.equal(startRes.ok, true);
  assert.equal(startRes.checkout.state, "pending");
  assert.ok(startRes.checkout.redirectUrl);

  const retryStart = await plugin.invokeRoute("checkout/guest/start", {
    contact: { email: "shopper@example.test" }, lines: [{ catalogItemId: "hat", quantity: 1 }],
  }, {
    url: `${SITE}/_emdash/api/plugins/${owner}/checkout/guest/start`, method: "POST",
    headers: { origin: SITE, "sec-fetch-site": "same-origin", "x-commerce-guest-capability": capabilityToken },
  });
  assert.equal(retryStart.ok, true);
  assert.equal(retryStart.checkout.attemptId, startRes.checkout.attemptId);
  assert.equal(sessions.size, 1, "start retry retains one provider session");

  // 7. STATUS ROUTE - PENDING
  const statusPending = await plugin.invokeRoute("checkout/guest/status", {}, {
    url: `${SITE}/_emdash/api/plugins/${owner}/checkout/guest/status`,
    method: "POST",
    headers: {
      origin: SITE,
      "sec-fetch-site": "same-origin",
      "x-commerce-guest-capability": capabilityToken,
    },
  });
  assert.equal(statusPending.ok, true);
  assert.equal(statusPending.checkout.state, "pending");
  assert.equal((await collections.orders.query()).items.length, 0);

  // 8. SETTLE PAYMENT & STATUS ROUTE - ONE ORDER SETTLEMENT
  paid = true;
  const statusPaid = await plugin.invokeRoute("checkout/guest/status", {}, {
    url: `${SITE}/_emdash/api/plugins/${owner}/checkout/guest/status`,
    method: "POST",
    headers: {
      origin: SITE,
      "sec-fetch-site": "same-origin",
      "x-commerce-guest-capability": capabilityToken,
    },
  });
  assert.equal(statusPaid.ok, true);
  assert.equal(statusPaid.checkout.state, "paid");
  assert.ok(statusPaid.checkout.order);

  const orders = await collections.orders.query();
  assert.equal(orders.items.length, 1, "exactly one order must be settled");

  // 9. STATUS RETRY / REPLAY - IDEMPOTENT
  const statusReplay = await plugin.invokeRoute("checkout/guest/status", {}, {
    url: `${SITE}/_emdash/api/plugins/${owner}/checkout/guest/status`,
    method: "POST",
    headers: {
      origin: SITE,
      "sec-fetch-site": "same-origin",
      "x-commerce-guest-capability": capabilityToken,
    },
  });
  assert.equal(statusReplay.ok, true);
  assert.equal(statusReplay.checkout.state, "paid");
  assert.equal(statusReplay.checkout.order.orderId, statusPaid.checkout.order.orderId);
  assert.equal((await collections.orders.query()).items.length, 1, "retry does not create a second order");
});
