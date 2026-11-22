// A stand-in for DinkusKit.com and the Payments service, for the paired proofs that take a real checkout.
// Load it into the store's own process with NODE_OPTIONS="--import <this file>" and
// DINKUS_PAIRED_STAND_IN_STATE=<a JSON file>. It answers only what the pinned Commerce asks those two
// services during a checkout (its 5-minute passes, its checkout settings, its Payments binding, the Stripe session, the session's
// lookup and Payments' wake list) and lets every other fetch go out unchanged. It never reaches the real
// services, so no key, pass or Stripe account is involved: the passes carry the claims Commerce checks and
// no real signature, and the Stripe page is a made-up address the browser test answers itself.
//
// The proof steers it through the state file: { storeKey, siteId, bindingRef, stripeAccountId, settings, expired: [attemptId] }. A session the
// proof marks expired looks up as expired-unpaid and is offered once in Payments' wake list, as Payments
// does when Stripe ends an unpaid session. Each call is appended to <state>.calls.jsonl for the proof trace.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const stateFile = process.env.DINKUS_PAIRED_STAND_IN_STATE;
const STAND_IN_HOSTS = new Set(["dinkuskit.com", "payments.dinkuskit.com"]);
const ISSUER = "https://dinkuskit.com/account";

if (stateFile && !globalThis.__dinkusPairedStandIn) {
  const realFetch = globalThis.fetch.bind(globalThis);
  const read = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : {});
  const write = (state) => writeFileSync(stateFile, JSON.stringify(state, null, 2));
  const log = (entry) => appendFileSync(`${stateFile}.calls.jsonl`, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const pass = (state, scope, audience) => {
    const now = Math.floor(Date.now() / 1000);
    return `${part({ alg: "ES256", typ: "JWT" })}.${part({ iss: ISSUER, aud: audience, sub: "store:paired-proof", site_id: state.siteId,
      scope, iat: now - 1, exp: now + 300 })}.c3RhbmQtaW4`;
  };
  // One Stripe session per attempt, as Payments keeps it: the same answer every time it is asked again.
  const session = (state, attemptId) => {
    state.sessions ??= {};
    if (!state.sessions[attemptId]) {
      const createdAt = Math.floor(Date.now() / 1000);
      state.sessions[attemptId] = { sessionId: `cs_test_${attemptId.replace(/[^A-Za-z0-9]/g, "")}`,
        redirectUrl: `https://checkout.stripe.com/c/pay/cs_test_${attemptId.replace(/[^A-Za-z0-9]/g, "")}`, createdAt, expiresAt: createdAt + 1800 };
    }
    return state.sessions[attemptId];
  };
  const bodyOf = (init) => {
    const raw = init?.body;
    if (raw === undefined || raw === null) return null;
    const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw);
    return text ? JSON.parse(text) : null;
  };
  const headerOf = (input, init, name) => (init?.headers ? new Headers(init.headers).get(name) : input instanceof Request ? input.headers.get(name) : null);

  globalThis.__dinkusPairedStandIn = true;
  globalThis.fetch = async (input, init) => {
    let url;
    try { url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); } catch { return realFetch(input, init); }
    // EmDash looks up a plugin's host before each call to refuse private addresses: answer that for the stand-in's hosts.
    if (url.origin === "https://cloudflare-dns.com" && url.pathname === "/dns-query" && STAND_IN_HOSTS.has(url.searchParams.get("name") ?? "")) {
      const name = url.searchParams.get("name");
      const answer = url.searchParams.get("type") === "A" ? [{ name, type: 1, TTL: 300, data: "104.16.0.1" }] : [];
      return new Response(JSON.stringify({ Status: 0, Answer: answer }), { headers: { "content-type": "application/dns-json" } });
    }
    if (!STAND_IN_HOSTS.has(url.hostname) || url.protocol !== "https:") return realFetch(input, init);
    const state = read();
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const authorization = headerOf(input, init, "authorization") ?? "";
    const body = bodyOf(init);
    const entry = { host: url.hostname, method, path: url.pathname, attemptId: body?.attemptId ?? null };
    try {
      if (url.hostname === "dinkuskit.com") {
        if (method === "POST" && url.pathname === "/api/store-passes") {
          if (authorization !== `Bearer ${state.storeKey}` || body?.site_id !== state.siteId) return json({ error: "invalid_token" }, 401);
          entry.scope = body.scope;
          return json({ access_token: pass(state, body.scope, body.audience), token_type: "Bearer", expires_in: 300 });
        }
        // Commerce rereads its checkout settings now and then: the same ones the proof connected it with.
        if (method === "GET" && url.pathname === "/api/commerce-settings") {
          const claims = JSON.parse(Buffer.from(authorization.split(".")[1] ?? "", "base64url").toString() || "{}");
          if (claims.site_id !== state.siteId || claims.scope !== "commerce:settings" || typeof state.settings !== "string") return json({ error: "invalid_token" }, 401);
          return new Response(state.settings, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
        }
        return json({ error: "not_found" }, 404);
      }
      // Payments: every call carries a pass this stand-in gave for this store.
      const claims = JSON.parse(Buffer.from(authorization.split(".")[1] ?? "", "base64url").toString() || "{}");
      if (claims.site_id !== state.siteId || claims.aud !== "dinkus-payments") return json({ error: "invalid_token" }, 401);
      const binding = { bindingRef: state.bindingRef, providerId: "stripe", stripeAccountId: state.stripeAccountId, mode: "test" };
      if (method === "GET" && (url.pathname === "/v1/checkout-binding" || url.pathname === "/v1/existing-binding")) return json(binding);
      if (method === "POST" && url.pathname === "/v1/checkout/session") {
        const found = session(state, body.attemptId);
        write(state);
        return json({ outcome: "open", attemptId: body.attemptId, total: body.total, session: found });
      }
      if (method === "POST" && url.pathname === "/v1/checkout/lookup") {
        const found = session(state, body.attemptId);
        write(state);
        const outcome = (state.expired ?? []).includes(body.attemptId) ? "expired-unpaid" : "open";
        entry.outcome = outcome;
        return json({ outcome, attemptId: body.attemptId, total: body.total, session: found });
      }
      if (method === "GET" && url.pathname === "/v1/checkout/wakes") {
        const acked = new Set(state.acked ?? []);
        const wakes = (state.expired ?? []).filter((attemptId) => !acked.has(attemptId)).map((attemptId) => ({
          attemptId, bindingRef: state.bindingRef, deliveryGeneration: 1,
          eventId: `evt_${attemptId.replace(/[^A-Za-z0-9]/g, "")}`, wokeAt: Math.floor(Date.now() / 1000) }));
        entry.wakes = wakes.map((wake) => wake.attemptId);
        return json(wakes);
      }
      if (method === "POST" && url.pathname === "/v1/checkout/wakes/ack") {
        state.acked = [...new Set([...(state.acked ?? []), body.attemptId])];
        write(state);
        return json({ acknowledged: true });
      }
      return json({ error: "not_found" }, 404);
    } finally {
      log(entry);
    }
  };
}
