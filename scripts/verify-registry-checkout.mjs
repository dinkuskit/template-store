import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";
import { PluginStorageRepository, createSettingsAccess } from "emdash";
import { OptionsRepository } from "emdash/internal/plugins/host";
import { WorkerdSandboxRunner } from "@emdash-cms/sandbox-workerd/sandbox";
import { createImmutablePaymentsFixture, miniflareVersion } from "./lib/immutable-payments-fixture.mjs";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 3,
  "Usage: pnpm verify:registry-checkout [commerce.tgz registry.tar.gz payments.tgz]");
const files = args.length ? args.map(p => resolve(p)) :
  ["commerce49.tgz", "commerce49-registry.tar.gz", "payments12.tgz"].map(p => join(root, ".artifacts/owner-packages", p));
const archiveSha256 = [
  "e0d1c88ca5cf805f3795aa61ef598f1c50c893be35fd4b41aa0ac867d554e4df",
  "79b64463dbb7c80012bb13fca613be0954b2387ee5ec5709a4656293dd5cfa3a",
  "bb91f476f9e8c1a67ce4aa84cd36722e1c390a4d70b21681b3cf1d7e7feb53e0",
];
const commerceSource = "45ced324bfb2c39c0a1fe200e5d8ceda7c5581ef";
const paymentsSource = "37842220fddb10dc5294af084110cd33804715be";
const backendSha256 = "6613d122e8991a462bf16538f29a287f5d243f7fd60d163c802c63f3f39eaeaa";
const manifestRawSha256 = "78f3e4233cc4d49c3cf66eb1666536ac44475f65f4c02e418dad257959f11b44";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).dinkuskit.sourcePins.commerce.commit, commerceSource);
assert.equal(JSON.parse(readFileSync(join(root, "node_modules/emdash/package.json"))).version, "1.0.1");
mkdirSync(join(root, ".artifacts"), { recursive: true });
const proof = mkdtempSync(join(root, ".artifacts/registry-checkout-"));
const extraction = String.raw`import pathlib,sys,tarfile
source,dest=map(pathlib.Path,sys.argv[1:])
with tarfile.open(source,'r:gz') as archive:
 members=archive.getmembers()
 assert len(members)<4000 and sum(m.size for m in members)<128*1024*1024
 for m in members:
  p=pathlib.PurePosixPath(m.name)
  assert not p.is_absolute() and '..' not in p.parts
  assert (m.isfile() or m.isdir()) and m.size<16*1024*1024
 archive.extractall(dest,filter='data')
`;
for (const [i, file] of files.entries()) {
  const bytes = readFileSync(file);
  assert.ok(bytes.length < 32 * 1024 * 1024);
  assert.equal(hash(bytes), archiveSha256[i]);
  const copy = join(proof, `input-${i}.tgz`), destination = join(proof, `input-${i}`);
  writeFileSync(copy, bytes); mkdirSync(destination);
  execFileSync("python3", ["-I", "-c", extraction, copy, destination]);
}
const commerce = join(proof, "input-0/package");
const backend = readFileSync(join(commerce, "dist/sandbox/plugin.mjs"));
const manifestBytes = readFileSync(join(commerce, "dist/sandbox/manifest.json"));
assert.equal(hash(backend), backendSha256);
assert.equal(hash(manifestBytes), manifestRawSha256);
assert.deepEqual(readFileSync(join(proof, "input-1/backend.js")), backend);
assert.deepEqual(readFileSync(join(proof, "input-1/manifest.json")), manifestBytes);
const artifact = JSON.parse(manifestBytes);
assert.deepEqual(artifact.capabilities, []); assert.deepEqual(artifact.allowedHosts, []);
const worker = join(proof, "input-2/package/dist/worker.js");
assert.equal(hash(readFileSync(worker)), "77c6fe70120c962ee482760a2ad308e3f57faaf367e5bba86d74cd13b1eee548");
mkdirSync(join(commerce, "node_modules"));
symlinkSync(join(root, "node_modules/emdash"), join(commerce, "node_modules/emdash"));
const couponsApi = await import(pathToFileURL(join(commerce, "dist/features/coupons/index.js")));

// Repeat EmDash 1.0.1's public publisher+slug namespace derivation and load-time
// manifest normalization. This does NOT verify a signed Registry installation.
const declaration = JSON.parse(readFileSync(join(commerce, "emdash-plugin.jsonc")));
const digest = createHash("sha256").update(declaration.publisher + "\n" + declaration.slug).digest();
const bits = Array.from(digest, byte => byte.toString(2).padStart(8, "0")).join("");
let encoded = "";
for (let i = 0; i < 80; i += 5) encoded += "abcdefghijklmnopqrstuvwxyz234567"[parseInt(bits.slice(i, i + 5), 2)];
const owner = "r_" + encoded;
assert.equal(owner, "r_gshdrqaldna3r7sn");
assert.equal(artifact.id, "dinkus-commerce");
const SITE = "https://shop.example.test", TRANSPORT = "https://8.8.8.8";
const SCHEMA = "dinkuskit.commerce.registry-checkout/v1";
const usd = minor => ({ currency: "USD", minor: String(minor) });
// Fresh process-only encryption key; no operator credential is read or saved.
process.env.EMDASH_ENCRYPTION_KEY = "emdash_enc_v1_" + randomBytes(32).toString("base64url");
const results = [];
const basket = { lines: [{ catalogItemId: "one", quantity: 2 }, { catalogItemId: "two", quantity: 1 }], couponCode: "SAVE" };

async function runtime({ name, payments, config = null, credential = null, grants = false }) {
  const counts = { credentials: 0, transport: 0, acknowledgments: 0, scheduler: 0 };
  let sqlite, db, runner, plugin, settings, collections;
  const manifest = structuredClone(artifact);
  manifest.id = owner;
  // Test-only permission variant. Shipped manifest remains byte-identical/empty.
  if (grants) { manifest.capabilities = ["network:request"]; manifest.allowedHosts = ["8.8.8.8"]; }
  async function close() {
    try { if (runner) { await runner.terminateAll(); runner = undefined; } }
    finally { if (db) { await db.destroy(); db = undefined; } }
  }
  async function open() {
    sqlite = new BetterSqlite3(join(proof, name + "-commerce.sqlite"));
    // Minimal schemas from the pinned SDK. Original repositories/bridge own CAS.
    sqlite.exec(`CREATE TABLE IF NOT EXISTS options (name TEXT PRIMARY KEY, value TEXT NOT NULL, revision TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS _plugin_storage (plugin_id TEXT NOT NULL, collection TEXT NOT NULL,
      id TEXT NOT NULL, data TEXT NOT NULL, revision TEXT NOT NULL DEFAULT '0',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(plugin_id,collection,id));`);
    db = new Kysely({ dialect: new SqliteDialect({ database: sqlite }), log(event) {
      if (event.level !== "query") return;
      // Observe only counters, never log SQL values, encrypted payloads or JWTs.
      if (/^select /i.test(event.query.sql) && event.query.sql.includes('"options"') &&
        event.query.parameters.includes(`plugin:${owner}:settings:installedCheckoutCredential`)) counts.credentials++;
      if (event.query.sql.includes("_emdash_cron_tasks")) counts.scheduler++;
    } });
    collections = {};
    for (const [name, spec] of Object.entries(manifest.storage)) {
      assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/);
      collections[name] = new PluginStorageRepository(db, owner, name, [...spec.indexes, ...(spec.uniqueIndexes ?? [])]);
      for (const [index, fields] of (spec.uniqueIndexes ?? []).entries()) {
        const list = Array.isArray(fields) ? fields : [fields];
        assert.ok(list.every(field => /^[A-Za-z_][A-Za-z0-9_]*$/.test(field)));
        const expressions = list.map(field => `json_extract(data, '$.${field}')`).join(",");
        sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "fixture_${name}_${index}" ON _plugin_storage(plugin_id,collection,${expressions})`);
      }
    }
    settings = createSettingsAccess(new OptionsRepository(db), owner, manifest.admin.settingsSchema);
    runner = new WorkerdSandboxRunner({ db, siteInfo: { name: "Synthetic Template Store", url: SITE, locale: "en" },
      limits: { wallTimeMs: 15000 }, httpFetch: async (url, init) => {
        counts.transport++;
        assert.equal(new URL(url).origin, TRANSPORT); assert.equal(init.redirect, "manual");
        assert.ok(payments, "transport is forbidden without synthetic Payments fixture");
        const path = new URL(url).pathname;
        if (path === "/v1/checkout/wakes/ack") {
          const event = JSON.parse(new TextDecoder().decode(init.body));
          const association = await collections.checkout_payment_associations.get(event.attemptId);
          const cart = await collections.checkout_carts.get(association.cartId);
          const attempt = cart.attempts.find(value => value.attemptId === event.attemptId);
          assert.equal(attempt.phase, "paid"); assert.ok(attempt.order);
          assert.equal(attempt.coupon.status, "consumed");
        }
        const response = await payments.fetch(path + new URL(url).search, init);
        if (path === "/v1/checkout/wakes/ack") {
          assert.equal(response.status, 200);
          assert.equal((await response.clone().json()).acknowledged, true);
          counts.acknowledgments++;
        }
        return response;
      } });
    assert.equal(runner.isAvailable(), true);
    plugin = await runner.load(manifest, backend.toString());
  }
  try {
    await open();
    if (config !== null) await settings.set("installedCheckout", JSON.stringify(config));
    if (credential !== null) await settings.set("installedCheckoutCredential", credential);
    for (const [id, price] of [["one", 75], ["two", 100]]) {
      await collections.catalog_items.put(id, { recordKind: "catalog-item", itemId: id, commandId: "synthetic-" + id,
        sku: id.toUpperCase(), skuKey: id.toUpperCase(), creationIntent: { manageStock: false }, kind: "simple-product",
        name: "Fixture " + id, state: "draft", stockManagement: { mode: "unmanaged" }, createdAt: new Date().toISOString() });
      await collections.catalog_prices.put(id, { recordKind: "catalog-price", recordId: id, catalogItemId: id, regular: usd(price) });
      await collections.catalog_manual_availability.put(id, { recordKind: "catalog-manual-availability", recordId: id, catalogItemId: id, status: "in-stock" });
    }
  } catch (error) { await close(); throw error; }
  return {
    counts, get settings() { return settings; }, get collections() { return collections; },
    invoke(route, input = {}, capability, origin = SITE) {
      return plugin.invokeRoute("checkout/guest/" + route, input, {
        url: `${SITE}/_emdash/api/plugins/${owner}/checkout/guest/${route}`, method: "POST",
        headers: { origin, "sec-fetch-site": "same-origin", ...(capability ? { "x-commerce-guest-capability": capability } : {}) },
      });
    },
    cron() { return plugin.invokeHook("cron", { name: "commerce-checkout-wakes" }); },
    async records() { return (await collections.checkout_carts.query()).items.map(item => item.data); },
    async restart() { await close(); await open(); }, close,
  };
}
function configuration(payments, shipping) {
  return { schema: SCHEMA, enabled: true, commerceOrigin: SITE, siteId: payments.siteId, paymentsOrigin: TRANSPORT,
    bindingRef: payments.bindingRef, providerId: "stripe", stripeAccountId: "acct_syntheticfixture",
    pricingSchema: "dinkuskit.commerce.checkout-pricing/v1", issuer: payments.issuer, audience: payments.audience, shipping };
}
async function start(state, input = basket) {
  const prepared = await state.invoke("prepare"); assert.equal(prepared.ok, true);
  const capability = prepared.capability.capability;
  return { capability, result: await state.invoke("start", input, capability) };
}
for (const [name, config] of [["unconfigured", null], ["disabled", { schema: SCHEMA, enabled: false }]]) {
  const state = await runtime({ name, config });
  try {
    const { result } = await start(state, { lines: basket.lines });
    assert.equal(result.error.code, "PAYMENTS_UNAVAILABLE"); await state.cron();
    assert.deepEqual(await state.records(), []);
    assert.deepEqual(state.counts, { credentials: 0, transport: 0, acknowledgments: 0, scheduler: 0 });
    results.push({ scenario: name, prepareAvailable: true, startUnavailable: true, ...state.counts, attempts: 0 });
  } finally { await state.close(); }
}
for (const scenario of [
  { name: "flat-nondivisible", discount: 101, shipping: 50, total: 199 },
  { name: "free", discount: 100, shipping: 0, total: 150 },
  { name: "shipping-only", discount: 250, shipping: 50, total: 50 },
]) {
  const payments = await createImmutablePaymentsFixture({ worker, proof, scenario, siteId: "synthetic-" + scenario.name });
  let state;
  try {
    const shipping = { configurationId: "synthetic-shipping", revision: 1, mode: scenario.shipping ? "flat" : "free",
      ...(scenario.shipping ? { amount: usd(scenario.shipping) } : {}) };
    const config = configuration(payments, shipping);
    if (scenario.name === "free") {
      const blocked = await runtime({ name: "configured-missing-grants", payments, config, credential: payments.token() });
      try {
        const denied = await start(blocked, { lines: basket.lines });
        assert.equal(denied.result.ok, true);
        assert.equal(blocked.counts.transport, 0); assert.equal(payments.stats().creates, 0);
        const record = (await blocked.records())[0]; assert.equal(record.attempts.length, 1);
        assert.equal(record.attempts[0].phase, "paying"); assert.equal(record.attempts[0].order, undefined);
        await blocked.cron(); assert.equal(blocked.counts.acknowledgments, 0); assert.equal(blocked.counts.scheduler, 0);
        results.push({ scenario: "configured-missing-grants", transport: 0, providerCreates: 0, unconfirmedAttempts: 1, orders: 0, acknowledgments: 0 });
      } finally { await blocked.close(); }
    }
    state = await runtime({ name: scenario.name, payments, config, credential: payments.token(), grants: true });
    if (scenario.name === "free") {
      assert.equal((await state.invoke("prepare", {}, undefined, "https://other.example.test")).error.code, "ORIGIN_DENIED");
      assert.equal(state.counts.credentials, 0);
      await state.settings.set("installedCheckout", JSON.stringify({ ...config, commerceOrigin: "https://other.example.test" }));
      assert.equal((await state.invoke("prepare")).error.code, "UNAVAILABLE"); assert.equal(state.counts.credentials, 0);
      await state.settings.set("installedCheckout", JSON.stringify(config));
      const now = Math.floor(Date.now() / 1000);
      for (const [scope, changes] of [["payments:admin", {}], ["payments:checkout", { exp: now - 1 }],
        ["payments:checkout", { site_id: "other-site" }], ["payments:checkout", { iss: "https://other.example.invalid" }]]) {
        await state.settings.set("installedCheckoutCredential", payments.token(scope, changes));
        assert.equal((await state.invoke("prepare")).error.code, "UNAVAILABLE");
      }
      assert.equal(state.counts.transport, 0); assert.deepEqual(await state.records(), []);
      await state.settings.set("installedCheckoutCredential", payments.token());
    }
    const couponAdmin = couponsApi.createCouponAdmin(state.collections.coupons);
    const now = Date.now();
    await couponAdmin.create({ code: "SAVE", globalCap: 1, rule: { ruleId: "synthetic-rule", version: 1,
      discount: { kind: "fixed", amount: usd(scenario.discount) }, appliesTo: "all-merchandise", selectedProductIds: [], includeSaleItems: true,
      minimumEligibleMerchandise: usd(0), startsAt: new Date(now - 86400000).toISOString(), endsAt: new Date(now + 86400000).toISOString(), timeZone: "UTC" } });
    const { capability, result } = await start(state);
    assert.equal(result.ok, true); assert.equal(result.checkout.state, "pending");
    assert.equal(result.checkout.total.minor, String(scenario.total)); assert.equal(payments.stats().creates, 1);
    assert.equal((await state.invoke("status", { success: true, payment_status: "paid" }, capability)).checkout.state, "pending");
    await state.restart(); await payments.restart();
    await state.settings.set("installedCheckout", JSON.stringify(configuration(payments,
      { configurationId: "changed-later", revision: 2, mode: "flat", amount: usd(999) })));
    await state.settings.set("installedCheckoutCredential", payments.token());
    const replay = await state.invoke("start", basket, capability);
    assert.equal(replay.ok, true); assert.equal(replay.checkout.total.minor, String(scenario.total)); assert.equal(payments.stats().creates, 1);
    await payments.paidWebhook(); await state.cron();
    assert.equal(state.counts.acknowledgments, 1, "wake must ACK only after canonical settlement");
    const settled = await state.invoke("status", {}, capability);
    assert.equal(settled.checkout.state, "paid"); assert.equal(settled.checkout.order.total.minor, String(scenario.total));
    assert.equal((await state.invoke("status", {}, capability)).checkout.order.orderId, settled.checkout.order.orderId);
    await state.cron(); assert.equal(state.counts.acknowledgments, 1);
    const records = await state.records(); assert.equal(records.length, 1); assert.equal(records[0].attempts.length, 1);
    const attempt = records[0].attempts[0]; assert.equal(attempt.phase, "paid"); assert.equal(attempt.coupon.status, "consumed");
    assert.equal(attempt.order.pricing.shipping.configurationId, "synthetic-shipping");
    assert.equal(attempt.order.pricing.shipping.revision, 1);
    if (scenario.name === "flat-nondivisible") assert.ok(attempt.order.pricing.lines.some(line => BigInt(line.netAmount.minor) % BigInt(line.quantity) !== 0n));
    const coupon = (await couponsApi.createCouponAdmin(state.collections.coupons).list())[0];
    assert.equal((await couponsApi.createCouponAttemptOwner(state.collections.coupons).getCounts(coupon.couponId)).consumed, 1);
    assert.equal(payments.stats().deniedOutbound, 0); assert.equal(state.counts.scheduler, 0);
    results.push({ scenario: scenario.name, total: scenario.total, originalDefaultPluginContext: true,
      bothOwnerStoresRestarted: true, frozenShippingReplay: true, forgedReturnRemainsPending: true,
      canonicalOrders: 1, couponConsumed: 1, providerCreates: payments.stats().creates,
      wakeSettledBeforeAck: true, acknowledgments: state.counts.acknowledgments, scheduler: 0,
      encryptedCredentialReads: state.counts.credentials, interceptedRequests: state.counts.transport });
  } finally { try { if (state) await state.close(); } finally { await payments.close(); } }
}
assert.equal(hash(manifestBytes), manifestRawSha256);
const report = { commerceSource, paymentsSource, archiveSha256, backendSha256, manifestRawSha256,
  emdashVersion: "1.0.1", miniflareVersion, runtimeId: owner,
  proof: "Immutable default Commerce backend through original EmDash workerd context/settings/storage -> immutable Payments HTTP/JWT/SQLite -> fully intercepted Stripe SDK",
  results, registryInstalled: false, localDefaultLoader: true, shippedGrantsEmpty: true, actualProviderCalls: 0,
  schedulerRegistered: false, publicCheckoutEnabled: false,
  limits: ["Unsigned local artifacts do not prove official Registry publication, delivery or installation.",
    "Synthetic ephemeral credentials do not prove account provisioning or renewal; test-only grants are never shipped.",
    "Local bodyless connect HTTP returns 400; setup uses original Payments owner onboarding RPC.",
    "Named cron hook invocation is not scheduler registration; deployed callbacks and real Stripe TEST remain unproved."] };
writeFileSync(join(proof, "RESULT.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.log("registry-checkout receipt: " + join(proof, "RESULT.json"));
