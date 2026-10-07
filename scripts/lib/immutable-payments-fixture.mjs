import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const localRequire = createRequire(import.meta.url);
const toolRequire = createRequire(localRequire.resolve("wrangler/package.json"));
const mfPath = toolRequire.resolve("miniflare");
export const miniflareVersion = JSON.parse(readFileSync(resolve(mfPath, "../../../package.json"))).version;
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = await import(pathToFileURL(mfPath));

// Only synthetic in-memory identity and fully intercepted official Stripe SDK
// transport. The immutable Payments Worker remains the sole connection owner.
export async function createImmutablePaymentsFixture({ worker, proof, scenario, siteId }) {
  let ready = true, paid = false, session, creates = 0, deniedOutbound = 0, mockedProviderCalls = 0;
  const operations = new Map();
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "synthetic-proof", alg: "RS256", use: "sig" };
  const issuer = "https://identity.example.invalid";
  function token(scope = "payments:admin payments:checkout", changes = {}) {
    const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const message = encode({ alg: "RS256", kid: jwk.kid }) + "." + encode({ iss: issuer, aud: "payments-local-proof", sub: "synthetic-owner", site_id: siteId, scope, iat: now, exp: now + 3600, ...changes });
    return message + "." + sign("RSA-SHA256", Buffer.from(message), privateKey).toString("base64url");
  }
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
  async function reopen() { mf = new Miniflare(options); await mf.ready; }
  try {
    await reopen();
    const headers = { authorization: "Bearer " + token(), "x-dinkus-site": siteId };
    const connect = await mf.dispatchFetch("https://payments.example.invalid/v1/connect", { method: "POST", headers });
    assert.equal(connect.status, 400); assert.equal((await connect.json()).error, "unexpected_input");
    const before = mockedProviderCalls;
    const denied = await mf.dispatchFetch("https://payments.example.invalid/v1/checkout-binding?bindingRef=invalid", { headers: { ...headers, authorization: "Bearer " + token("payments:admin") } });
    assert.equal(denied.status, 401); assert.equal(mockedProviderCalls, before);
    // This is owner-RPC fixture onboarding, not a qualified public HTTP connect.
    const namespace = await mf.getDurableObjectNamespace("PAYMENT_CONNECTIONS");
    const connectedRpc = await namespace.getByName(JSON.stringify(["test", siteId])).startOnboarding({ accountId: JSON.stringify([issuer, "synthetic-owner"]), siteId });
    const bindingRef = connectedRpc.bindingRef; assert.equal(connectedRpc.state, "ready");
    return {
      issuer, audience: "payments-local-proof", siteId, bindingRef, token,
      async fetch(path, init) { return mf.dispatchFetch("https://payments.example.invalid" + path, init); },
      stats() { return { creates, deniedOutbound, mockedProviderCalls }; },
      async restart() {
        await mf.dispose(); mf = undefined; await reopen();
        const response = await mf.dispatchFetch("https://payments.example.invalid/v1/existing-binding?bindingRef=" + bindingRef, { headers });
        assert.equal(response.status, 200, "Payments binding must survive owner-store restart");
      },
      async paidWebhook() {
        ready = false; paid = true;
        const payload = JSON.stringify({ id: "evt_syntheticfixture", object: "event", type: "checkout.session.completed", account: "acct_syntheticfixture", livemode: false, data: { object: { ...session, status: "complete", payment_status: "paid", payment_intent: "pi_syntheticfixture" } } });
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = `t=${timestamp},v1=${createHmac("sha256", "whsec_synthetic_fixture").update(timestamp + "." + payload).digest("hex")}`;
        const response = await mf.dispatchFetch("https://payments.example.invalid/v1/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature }, body: payload });
        assert.equal(response.status, 200);
      },
      async close() { if (mf) { await mf.dispose(); mf = undefined; } },
    };
  } catch (error) { if (mf) await mf.dispose(); throw error; }
}
