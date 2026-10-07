import assert from "node:assert/strict";
import { createHash, createHmac, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2, "Usage: pnpm verify:paired-checkout [commerce.tgz payments.tgz]");
const archives = args.length ? args.map(p => resolve(p)) : ["commerce49.tgz", "payments12.tgz"].map(p => join(root, ".artifacts/owner-packages", p));
const digests = ["e0d1c88ca5cf805f3795aa61ef598f1c50c893be35fd4b41aa0ac867d554e4df", "bb91f476f9e8c1a67ce4aa84cd36722e1c390a4d70b21681b3cf1d7e7feb53e0"];
const commerceSource = "45ced324bfb2c39c0a1fe200e5d8ceda7c5581ef";
const paymentsSource = "37842220fddb10dc5294af084110cd33804715be";
assert.equal(JSON.parse(readFileSync(join(root, "package.json"))).dinkuskit.sourcePins.commerce.commit, commerceSource);
mkdirSync(join(root, ".artifacts"), { recursive: true });
const proof = mkdtempSync(join(root, ".artifacts/paired-checkout-"));
const extraction = String.raw`import pathlib,sys,tarfile
source,dest=map(pathlib.Path,sys.argv[1:])
with tarfile.open(source,'r:gz') as archive:
 members=archive.getmembers()
 assert len(members)<4000 and sum(m.size for m in members)<128*1024*1024
 for m in members:
  p=pathlib.PurePosixPath(m.name)
  assert not p.is_absolute() and '..' not in p.parts and p.parts[0]=='package'
  assert (m.isfile() or m.isdir()) and m.size<16*1024*1024
 archive.extractall(dest,filter='data')
`;
for (const [i, archive] of archives.entries()) {
  const bytes = readFileSync(archive);
  assert.ok(bytes.length < 32 * 1024 * 1024);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), digests[i]);
  const folder = join(proof, i === 0 ? "commerce" : "payments");
  mkdirSync(folder); const copy = join(proof, `input-${i}.tgz`); writeFileSync(copy, bytes);
  execFileSync("python3", ["-I", "-c", extraction, copy, folder]);
}
const commerce = join(proof, "commerce/package");
const worker = join(proof, "payments/package/dist/worker.js");
assert.equal(createHash("sha256").update(readFileSync(worker)).digest("hex"), "77c6fe70120c962ee482760a2ad308e3f57faaf367e5bba86d74cd13b1eee548");
mkdirSync(join(commerce, "node_modules"));
symlinkSync(resolve(root, "node_modules/emdash"), join(commerce, "node_modules/emdash"));
assert.equal(JSON.parse(readFileSync(resolve(root, "node_modules/emdash/package.json"))).version, "1.0.1");
const checkoutPath = join(commerce, "dist/features/checkout/index.js");
const checkout = await import(pathToFileURL(checkoutPath));
const couponsApi = await import(pathToFileURL(join(commerce, "dist/features/coupons/index.js")));
const localRequire = createRequire(import.meta.url);
const toolsRequire = createRequire(localRequire.resolve("wrangler/package.json"));
const { build } = await import(pathToFileURL(toolsRequire.resolve("esbuild")));
const miniflarePath = toolsRequire.resolve("miniflare");
const miniflareVersion = JSON.parse(readFileSync(resolve(miniflarePath, "../../../package.json"))).version;
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = await import(pathToFileURL(miniflarePath));
// Bundle only Template's adapter. Canonical Commerce remains an external import
// of the immutable compiled archive. No Payments source import or rebuild.
const adapter = join(proof, "template-adapter.mjs");
await build({ entryPoints: [join(root, "src/features/paired-checkout/index.ts")], outfile: adapter,
  bundle: true, platform: "node", format: "esm", plugins: [{ name: "immutable-commerce", setup(b) {
    b.onResolve({ filter: /^@dinkuskit\/commerce\/features\/checkout$/ }, () => ({ path: checkoutPath, external: true }));
  } }] });
const { createPairedCheckoutConsumer } = await import(pathToFileURL(adapter));
const schema = checkout.CHECKOUT_PRICING_SCHEMA;
const usd = minor => ({ currency: "USD", minor: String(minor) });
// Fresh ephemeral synthetic identity keys exist only in memory; no credential
// store or real issuer is read, and no token/key is written into proof output.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "synthetic-proof", alg: "RS256", use: "sig" };
const issuer = "https://identity.example.invalid";
function token(siteId, scope = "payments:admin payments:checkout") {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const message = encode({ alg: "RS256", kid: jwk.kid }) + "." + encode({ iss: issuer, aud: "payments-local-proof", sub: "synthetic-owner", site_id: siteId, scope, iat: now, exp: now + 3600 });
  return message + "." + sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64url");
}
const results = [];
for (const scenario of [
  { name: "flat-nondivisible", discount: 101, shipping: 50, total: 199 },
  { name: "free", discount: 100, shipping: 0, total: 150 },
  { name: "shipping-only", discount: 250, shipping: 50, total: 50 },
]) {
  const siteId = `synthetic-${scenario.name}`;
  let ready = true, paid = false, session, creates = 0, deniedOutbound = 0, mockedProviderCalls = 0;
  const operations = new Map();
  let db = new DatabaseSync(join(proof, scenario.name + ".sqlite"));
  db.exec("CREATE TABLE IF NOT EXISTS owner_collections(collection TEXT,id TEXT,revision TEXT,value TEXT,PRIMARY KEY(collection,id))");
  // Isolated canonical-owner storage fixture. This is NOT a host SQL bridge or
  // an installed PluginContext. Catalog seeds are neutral fixture data; only
  // canonical Commerce operations write checkout/order/coupon lifecycle data.
  const collection = name => ({
    async get(id) { return (await this.getVersioned(id))?.value ?? null; },
    async getVersioned(id) { const row = db.prepare("SELECT revision,value FROM owner_collections WHERE collection=? AND id=?").get(name, id); return row ? { revision: row.revision, value: JSON.parse(row.value) } : null; },
    async put(id, value) { db.prepare("INSERT INTO owner_collections VALUES(?,?,?,?) ON CONFLICT(collection,id) DO UPDATE SET revision=excluded.revision,value=excluded.value").run(name, id, randomUUID(), JSON.stringify(value)); },
    async query() { return { items: db.prepare("SELECT id,value FROM owner_collections WHERE collection=?").all(name).map(row => ({ id: row.id, data: JSON.parse(row.value) })), hasMore: false }; },
    async compareAndSet(id, revision, value) { const next = randomUUID(); const res = revision === null
      ? db.prepare("INSERT INTO owner_collections VALUES(?,?,?,?) ON CONFLICT(collection,id) DO NOTHING").run(name, id, next, JSON.stringify(value))
      : db.prepare("UPDATE owner_collections SET revision=?,value=? WHERE collection=? AND id=? AND revision=?").run(next, JSON.stringify(value), name, id, revision);
      return { applied: res.changes === 1, revision: next }; },
  });
  const names = checkout.SANDBOX_GUEST_CHECKOUT_STORAGE;
  const storage = Object.fromEntries(Object.values(names).map(name => [name, collection(name)]));
  await storage[names.catalogItems].put("one", { recordKind: "catalog-item", itemId: "one", name: "Fixture One", stockManagement: { mode: "unmanaged" } });
  await storage[names.catalogItems].put("two", { recordKind: "catalog-item", itemId: "two", name: "Fixture Two", stockManagement: { mode: "unmanaged" } });
  for (const [id, price] of [["one", 75], ["two", 100]]) await storage[names.prices].put(id, { recordKind: "catalog-price", recordId: id, catalogItemId: id, regular: usd(price) });
  await couponsApi.createCouponAdmin(storage[names.coupons]).create({ code: "SAVE", globalCap: 1, rule: {
    ruleId: "synthetic-rule", version: 1, discount: { kind: "fixed", amount: usd(scenario.discount) }, appliesTo: "all-merchandise", selectedProductIds: [], includeSaleItems: true,
    minimumEligibleMerchandise: usd(0), startsAt: "2026-01-01T00:00:00Z", endsAt: "2027-01-01T00:00:00Z", timeZone: "UTC",
  } });
  const outbound = async request => {
    const url = new URL(request.url);
    if (url.origin === issuer && url.pathname === "/jwks" && request.method === "GET") return Response.json({ keys: [jwk] });
    if (url.origin !== "https://api.stripe.com") { deniedOutbound++; throw new Error("Non-intercepted origin denied"); }
    mockedProviderCalls++;
    const account = { object: "account", id: "acct_syntheticfixture", details_submitted: ready, charges_enabled: ready, payouts_enabled: ready, capabilities: { card_payments: ready ? "active" : "pending" }, requirements: {} };
    if (url.pathname === "/v1/accounts" && request.method === "POST") return Response.json(account);
    if (url.pathname === "/v1/accounts/acct_syntheticfixture" && request.method === "GET") return Response.json(account);
    if (url.pathname === "/v1/checkout/sessions" && request.method === "POST") {
      const params = new URLSearchParams(await request.text()); const key = request.headers.get("idempotency-key");
      if (operations.has(key)) { assert.equal(params.toString(), operations.get(key)); return Response.json(session); }
      operations.set(key, params.toString()); creates++;
      assert.equal(request.headers.get("stripe-account"), account.id);
      let total = 0; for (let i = 0; params.has(`line_items[${i}][quantity]`); i++) {
        assert.equal(params.get(`line_items[${i}][quantity]`), "1"); total += Number(params.get(`line_items[${i}][price_data][unit_amount]`));
      }
      assert.equal(total, scenario.total);
      session = { object: "checkout.session", id: "cs_syntheticfixture", url: "https://checkout.stripe.com/c/pay/cs_syntheticfixture", status: "open", payment_status: "unpaid", amount_total: total, currency: "usd", created: Math.floor(Date.now() / 1000), expires_at: Number(params.get("expires_at")), livemode: false, payment_intent: null, payment_method_types: ["card"], metadata: { dinkus_attempt: params.get("metadata[dinkus_attempt]"), dinkus_binding: params.get("metadata[dinkus_binding]"), dinkus_site: siteId } };
      return Response.json(session);
    }
    if (url.pathname === "/v1/checkout/sessions/cs_syntheticfixture" && request.method === "GET") return Response.json({ ...session, ...(paid ? { status: "complete", payment_status: "paid", payment_intent: "pi_syntheticfixture" } : {}) });
    if (url.pathname === "/v1/payment_intents/pi_syntheticfixture" && request.method === "GET") return Response.json({ object: "payment_intent", id: "pi_syntheticfixture", status: "succeeded", amount: scenario.total, currency: "usd", latest_charge: { id: "ch_syntheticfixture", status: "succeeded" } });
    deniedOutbound++; throw new Error("Non-intercepted provider route denied");
  };
  const options = convertV4MiniflareOptions({ name: "immutable-payments-proof", modules: true, scriptPath: worker,
    compatibilityDate: "2026-09-29", compatibilityFlags: ["nodejs_compat"],
    host: "127.0.0.1", port: 0, cf: false, telemetry: { enabled: false }, log: new Log(LogLevel.ERROR), resourcePersistencePath: join(proof, scenario.name + "-payments"), unsafeEnableSharedStorage: true,
    durableObjects: { PAYMENT_CONNECTIONS: { className: "PaymentConnection", useSQLite: true } }, outboundService: outbound,
    bindings: { ACCOUNT_ISSUER: issuer, ACCOUNT_AUDIENCE: "payments-local-proof", ACCOUNT_JWKS_URL: issuer + "/jwks",
      STRIPE_API_KEY: "sk_test_synthetic_fixture", STRIPE_WEBHOOK_SECRET: "whsec_synthetic_fixture",
      ONBOARDING_RETURN_URL: "https://store.example.invalid/onboarding/return", ONBOARDING_REFRESH_URL: "https://store.example.invalid/onboarding/refresh",
      CHECKOUT_SUCCESS_URL: "https://store.example.invalid/checkout/return", CHECKOUT_CANCEL_URL: "https://store.example.invalid/checkout/cancel" },
  });
  let mf;
  try {
    mf = new Miniflare(options); await mf.ready;
    const jwt = token(siteId);
    const headers = { authorization: "Bearer " + jwt, "x-dinkus-site": siteId };
    const connectProbe = await mf.dispatchFetch("https://payments.example.invalid/v1/connect", { method: "POST", headers });
    assert.equal(connectProbe.status, 400); assert.equal((await connectProbe.json()).error, "unexpected_input");
    const callsBeforeDeniedScope = mockedProviderCalls;
    const deniedScope = await mf.dispatchFetch("https://payments.example.invalid/v1/checkout-binding?bindingRef=invalid", { headers: { ...headers, authorization: "Bearer " + token(siteId, "payments:admin") } });
    assert.equal(deniedScope.status, 401); assert.equal(mockedProviderCalls, callsBeforeDeniedScope);
    // Miniflare HTTP presents an empty POST as a non-null stream, rejected by
    // this immutable bodyless connect endpoint. Seed only via the actual owner
    // RPC method; no SQL or replacement connection service is used.
    const namespace = await mf.getDurableObjectNamespace("PAYMENT_CONNECTIONS");
    const rawConnected = await namespace.getByName(JSON.stringify(["test", siteId])).startOnboarding({ accountId: JSON.stringify([issuer, "synthetic-owner"]), siteId });
    const connected = { state: rawConnected.state, mode: rawConnected.mode, bindingRef: rawConnected.bindingRef };
    assert.equal(connected.state, "ready");
    const transport = (input, init) => mf.dispatchFetch(input, init);
    let shipping = { configurationId: "synthetic-shipping", revision: 1, mode: scenario.shipping ? "flat" : "free", amount: usd(scenario.shipping) };
    const consumer = createPairedCheckoutConsumer({ commerceSource, paymentsSource, pricingSchema: schema,
      commerceOrigin: "https://store.example.invalid", paymentsOrigin: "https://payments.example.invalid", siteId,
      bindingRef: connected.bindingRef, providerId: "stripe", stripeAccountId: "acct_syntheticfixture", credentialResolver: async () => jwt,
      fetch: transport, resolveShippingConfiguration: async () => shipping,
    });
    const ctx = { plugin: { id: "dinkus-commerce", version: "0.0.0" }, site: { url: "https://store.example.invalid" }, storage };
    const route = input => ({ input, request: { url: "https://store.example.invalid/api/plugins/commerce/guest", headers: { origin: "https://store.example.invalid", "sec-fetch-site": "same-origin" } } });
    const prepared = await consumer.prepare(route({}), ctx); assert.equal(prepared.ok, true);
    const capability = prepared.capability.capability;
    const request = input => { const r = route(input); r.request.headers[checkout.GUEST_CAPABILITY_HEADER] = capability; return r; };
    const input = { lines: [{ catalogItemId: "one", quantity: 2 }, { catalogItemId: "two", quantity: 1 }], couponCode: "SAVE" };
    const first = await consumer.start(request(input), ctx); assert.equal(first.ok, true); assert.equal(first.checkout.state, "pending");
    assert.equal(first.checkout.total.minor, String(scenario.total)); assert.equal(creates, 1);
    // Both owner stores close/reopen. Canonical replay must retain original totals.
    await mf.dispose(); mf = undefined; db.close(); db = new DatabaseSync(join(proof, scenario.name + ".sqlite"));
    mf = new Miniflare(options); await mf.ready;
    const existing = await mf.dispatchFetch("https://payments.example.invalid/v1/existing-binding?bindingRef=" + connected.bindingRef, {headers}); assert.equal(existing.status, 200, "Payments owner binding must survive restart");
    shipping = { configurationId: "changed-later", revision: 2, mode: "flat", amount: usd(999) };
    const replay = await consumer.start(request(input), ctx); assert.equal(replay.ok, true); assert.equal(replay.checkout.total.minor, String(scenario.total)); assert.equal(creates, 1);
    const returned = await consumer.status(request({ success: true, payment_status: "paid" }), ctx);
    assert.equal(returned.ok, true); assert.equal(returned.checkout.state, "pending");
    ready = false; paid = true;
    const payload = JSON.stringify({ id: "evt_syntheticfixture", object: "event", type: "checkout.session.completed", account: "acct_syntheticfixture", livemode: false, data: { object: { ...session, status: "complete", payment_status: "paid", payment_intent: "pi_syntheticfixture" } } });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = `t=${timestamp},v1=${createHmac("sha256", "whsec_synthetic_fixture").update(timestamp + "." + payload).digest("hex")}`;
    const webhook = await mf.dispatchFetch("https://payments.example.invalid/v1/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature }, body: payload });
    assert.equal(webhook.status, 200);
    // The same canonical site wake consumer supplies the sole reconciliation hook.
    const wakes = await consumer.reconcileWakes(ctx); assert.equal(wakes.executed, true); assert.ok(wakes.results.length > 0);
    const settled = await consumer.status(request({}), ctx); assert.equal(settled.ok, true); assert.equal(settled.checkout.state, "paid");
    assert.equal(settled.checkout.order.total.minor, String(scenario.total));
    const repeated = await consumer.status(request({}), ctx); assert.equal(repeated.checkout.order.orderId, settled.checkout.order.orderId);
    assert.equal((await consumer.reconcileWakes(ctx)).results.length, 0);
    const rows = await storage[names.carts].query(); assert.equal(rows.items.length, 1);
    const attempts = rows.items[0].data.attempts; assert.equal(attempts.filter(a => a.order).length, 1);
    const attempt = attempts.find(a => a.order); assert.equal(attempt.coupon.status, "consumed");
    assert.equal(attempt.order.pricing.shipping.configurationId, "synthetic-shipping");
    if (scenario.name === "flat-nondivisible") assert.ok(attempt.order.pricing.lines.some(l => BigInt(l.netAmount.minor) % BigInt(l.quantity) !== 0n));
    const coupon = (await couponsApi.createCouponAdmin(storage[names.coupons]).list())[0];
    assert.equal((await couponsApi.createCouponAttemptOwner(storage[names.coupons]).getCounts(coupon.couponId)).consumed, 1);
    assert.equal(deniedOutbound, 0);
    results.push({ scenario: scenario.name, total: scenario.total, canonicalOrders: 1, providerCreates: creates,
      persistedWorkerRestart: true, frozenShippingReplay: true, couponConsumed: 1, forgedReturnRemainsPending: true,
      wakeReconciledAndAcknowledged: true, readinessRegressionRecovery: true, wrongScopeRejectedBeforeProvider: true, bodylessConnectHttp: 400 });
  } finally { if (mf) await mf.dispose(); db.close(); }
}
const report = { commerceSource, paymentsSource, archiveSha256: digests, miniflareVersion, emdashVersion: "1.0.1",
  proof: "Template adapter with external immutable compiled Commerce package -> actual immutable Payments Worker HTTP/JWT/SQLite runtime -> official Stripe SDK with fully intercepted outbound transport -> canonical guest/wake/order/coupon APIs",
  results, actualProviderCalls: 0, credentialStoreReads: 0, registryInstalledHost: false,
  limits: ["Uninstalled Commerce PluginContext/storage fixture", "Onboarding fixture uses original Payments owner RPC: bodyless connect HTTP rejected in local Miniflare", "Ephemeral synthetic JWT issuer and intercepted Stripe responses", "No real Stripe account/payment, Registry installation, deployment, grants or activation"] };
writeFileSync(join(proof, "RESULT.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.log("paired-checkout receipt: " + join(proof, "RESULT.json"));
