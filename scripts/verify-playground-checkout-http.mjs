/**
 * Real-HTTP paid-order proof for the playground's Stripe TEST checkout, on the built playground Worker with
 * Commerce's Registry build installed in-store (template-one-build-registry-20261031). A local stand-in for the
 * Payments service answers the passes, sessions and lookups the playground's checkout guard forwards.
 *
 * It proves, through the cart's own Registry calls and the storefront's /api/checkout/status:
 * - a configured playground visitor gets a capability, starts checkout and has the paid order confirmed;
 * - a foreign, reset or unbound visitor is refused before any Payments call or order disclosure;
 * - the paid order still confirms after the Worker restarts (the binding is read back from SQLite);
 * - an expired binding is refused;
 * - without the trusted store origin, the cart shows checkout unavailable and nothing reaches Commerce or Payments.
 *
 * Pass --no-build to reuse the current playground build.
 */
import { createServer } from "node:http";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildPlaygroundWorker,
  PLAYGROUND_PROOF_SITE,
  startPlaygroundVisitor,
  startPlaygroundWorker,
} from "./lib/playground-worker-proof.mjs";

const root = resolve(import.meta.dirname, "..");
const artifact = resolve(root, ".artifacts/playground-http-proof");
rmSync(artifact, { recursive: true, force: true });
mkdirSync(artifact, { recursive: true });
const persistTo = join(artifact, "state");
const COMMERCE = "/_emdash/api/plugins/r_gshdrqaldna3r7sn";
const trace = [];
const calls = [];

// Each attempt keeps one session, opened when Payments is first asked for it.
const sessions = new Map();
function sessionFor(attemptId) {
  if (!sessions.has(attemptId)) {
    const createdAt = Math.floor(Date.now() / 1000);
    sessions.set(attemptId, { sessionId: `cs_${attemptId}`, redirectUrl: "https://checkout.stripe.com/c/pay/cs_proof", createdAt, expiresAt: createdAt + 1860 });
  }
  return sessions.get(attemptId);
}
// A pass shaped like DinkusKit.com's: Commerce admits it by its claims before any Payments call.
const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const pass = () => {
  const now = Math.floor(Date.now() / 1000);
  return `${part({ alg: "ES256", typ: "JWT" })}.${part({ iss: "https://dinkuskit.com/account", aud: "dinkus-payments",
    sub: "store:playground", site_id: "playground", scope: "payments:checkout", iat: now, exp: now + 600 })}.c2ln`;
};
const payments = createServer(async (request, response) => {
  const body = await new Promise((resolveBody) => {
    let text = "";
    request.on("data", (chunk) => { text += chunk; });
    request.on("end", () => resolveBody(text));
  });
  const parsed = body ? JSON.parse(body) : null;
  calls.push({ path: request.url, attemptId: parsed?.attemptId ?? null, clientIp: request.headers["x-dinkus-client-ip"] ?? null });
  if (request.url === "/api/store-passes") return json(response, { access_token: pass(), token_type: "Bearer", expires_in: 600 });
  if (request.url === "/v1/checkout/session") {
    return json(response, { outcome: "open", attemptId: parsed.attemptId, total: parsed.total, session: sessionFor(parsed.attemptId) });
  }
  if (request.url === "/v1/checkout/lookup") {
    return json(response, { outcome: "paid", attemptId: parsed.attemptId, total: parsed.total,
      paymentId: `pay_${parsed.attemptId}`, session: sessionFor(parsed.attemptId) });
  }
  response.writeHead(404); response.end();
});
function json(response, value) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}
await new Promise((resolveReady) => payments.listen(0, "127.0.0.1", resolveReady));
const paymentsUrl = `http://127.0.0.1:${payments.address().port}`;

const port = 4397;
const READY = {
  DINKUS_CHECKOUT_ENABLED: "1",
  DINKUS_LOCAL_PROOF: "1",
  PAYMENTS_URL: "https://payments.dinkuskit.com",
  PAYMENTS_LOCAL_HTTP_URL: paymentsUrl,
  PAYMENTS_STORE_PASSES_URL: `${paymentsUrl}/api/store-passes`,
  PAYMENTS_STORE_KEY: `dk_store_${"k".repeat(43)}`,
  PAYMENTS_STRIPE_ACCOUNT_ID: "acct_TEST1",
  // The trusted return origin admission requires; the last phase proves checkout stays unavailable without it.
  EMDASH_SITE_URL: PLAYGROUND_PROOF_SITE,
};

buildPlaygroundWorker();
let server = await startPlaygroundWorker({ name: "checkout-proof", port, vars: READY, persistTo });
const base = server.base;

async function request(path, cookie, body, capability = "capability-proof") {
  const before = calls.length;
  const response = await fetch(`${base}${path}`, { method: "POST", body: JSON.stringify(body), headers: {
    "content-type": "application/json", origin: PLAYGROUND_PROOF_SITE, cookie, "cf-connecting-ip": "203.0.113.7",
    "x-commerce-guest-capability": capability,
  } });
  const jsonBody = await response.json().catch(() => null);
  const entry = { path, cookie: cookie.replace(/=.*/, "=redacted"), status: response.status, body: jsonBody, paymentsCalls: calls.length - before };
  trace.push(entry);
  return entry;
}
async function cartAdmission(cookie) {
  const response = await fetch(`${base}/cart`, { headers: { cookie, "cf-connecting-ip": "203.0.113.7" } });
  const html = await response.text();
  if (!response.ok) throw new Error(`cart page status ${response.status}: ${html.slice(0, 300)}`);
  return html.match(/data-checkout-available="(true|false)"/)?.[1] ?? null;
}
async function warmSession(cookie) {
  const response = await fetch(`${base}/playground`, { headers: { origin: PLAYGROUND_PROOF_SITE, cookie, "cf-connecting-ip": "203.0.113.7" }, redirect: "manual" });
  if (response.status >= 400) throw new Error(`playground session warmup failed (${response.status})`);
}
/** A one-variant catalog item the visitor's Commerce sells, from its own public catalog. */
async function sellableItem(cookie) {
  const response = await fetch(`${base}${COMMERCE}/catalog/public`, { headers: { cookie } });
  const body = await response.json().catch(() => null);
  const products = body?.data?.products ?? [];
  const members = products.map((candidate) => candidate.variants?.members ?? []).find((list) =>
    list.length === 1 && typeof list[0].catalogItemId === "string" && list[0].availability?.sellable !== false);
  if (!members) throw new Error(`the visitor's Commerce sells nothing: ${JSON.stringify(body).slice(0, 600)}`);
  return members[0].catalogItemId;
}

const { cookie } = await startPlaygroundVisitor(base, "203.0.113.7", server.output);
const { cookie: foreignCookie } = await startPlaygroundVisitor(base, "203.0.113.8", server.output);
const { cookie: resetCookie } = await startPlaygroundVisitor(base, "203.0.113.9", server.output);
const provisionedCart = await cartAdmission(cookie);
const catalogItemId = await sellableItem(cookie);
const address = { name: "Proof Visitor", line1: "1 Test Way", city: "Testville", region: "NC", postalCode: "27601", country: "US" };
const created = await request(`${COMMERCE}/checkout/guest/prepare`, cookie, {});
const capability = created.body?.data?.capability?.capability;
if (typeof capability !== "string") throw new Error(`Commerce did not issue a capability: ${JSON.stringify(created.body)}\n${server.output.join("").slice(-3000)}`);
const started = await request(`${COMMERCE}/checkout/guest/start`, cookie,
  { lines: [{ catalogItemId, quantity: 1 }], contact: { email: "proof@example.test", delivery: address, billing: address } }, capability);
const attemptId = started.body?.data?.checkout?.attemptId;
if (typeof attemptId !== "string" || attemptId.length === 0) {
  throw new Error(`Commerce start response did not contain an attempt ID: ${started.status} ${JSON.stringify(started.body)}\n${server.output.join("").slice(-3000)}`);
}

// Both status entrypoints: the storefront's /api/checkout/status and Commerce's own route the cart calls.
const STATUS_ENTRYPOINTS = ["/api/checkout/status", `${COMMERCE}/checkout/guest/status`];
const surface = (path) => path.startsWith("/api") ? "proxy" : "registry";
const checkoutOf = (entry) => entry.body?.data?.checkout ?? entry.body?.checkout ?? null;
const paidFor = (entry) => entry.status === 200 && checkoutOf(entry)?.state === "paid" &&
  checkoutOf(entry)?.attemptId === attemptId && checkoutOf(entry)?.order != null;
const refused = (entry) => entry.status === 403 && entry.paymentsCalls === 0 && !JSON.stringify(entry.body ?? {}).includes("orderId");
const cases = {};
async function statusMatrix(label) {
  for (const path of STATUS_ENTRYPOINTS) {
    const key = `${label}:${surface(path)}`;
    cases[`${key}:authorized`] = await request(path, cookie, { attemptId }, capability);
    cases[`${key}:foreign`] = await request(path, foreignCookie, { attemptId }, capability);
    cases[`${key}:reset`] = await request(path, resetCookie, { attemptId }, capability);
    cases[`${key}:unbound`] = await request(path, cookie, { attemptId: "unbound-proof" }, capability);
  }
}
await statusMatrix("live");
const settled = cases["live:proxy:authorized"];

await server.stop();
server = await startPlaygroundWorker({ name: "checkout-proof", port, vars: READY, persistTo });
await warmSession(cookie);
await statusMatrix("restarted");
await server.stop();

server = await startPlaygroundWorker({ name: "checkout-proof-expired", port, persistTo,
  vars: { ...READY, DINKUS_LOCAL_PROOF_NOW: String(Date.now() + 2_000_000) } });
await warmSession(cookie);
for (const path of STATUS_ENTRYPOINTS) {
  cases[`expired:${surface(path)}:authorized`] = await request(path, cookie, { attemptId }, capability);
}
await server.stop();

writeFileSync(join(artifact, "trace.jsonl"), trace.map((item) => JSON.stringify(item)).join("\n") + "\n");
writeFileSync(join(artifact, "payments-calls.json"), JSON.stringify(calls, null, 2) + "\n");
const summary = Object.fromEntries(Object.entries(cases).map(([key, entry]) => [key,
  { status: entry.status, state: checkoutOf(entry)?.state ?? null, paymentsCalls: entry.paymentsCalls }]));
writeFileSync(join(artifact, "status-matrix.json"), JSON.stringify(summary, null, 2) + "\n");

// Missing trusted return origin: the flag and every Payments value are set, but EMDASH_SITE_URL is not.
// Admission must fail closed: the cart shows checkout unavailable, and neither checkout entry reaches
// Commerce or Payments.
server = await startPlaygroundWorker({ name: "checkout-proof-missing-origin", port, persistTo: join(artifact, "state-missing-origin"),
  vars: { ...READY, EMDASH_SITE_URL: null } });
const missingCallsBefore = calls.length;
const { cookie: missingCookie } = await startPlaygroundVisitor(base, "203.0.113.20", server.output);
const missingCart = await cartAdmission(missingCookie);
const missingPrepare = await request(`${COMMERCE}/checkout/guest/prepare`, missingCookie, {});
const missingStart = await request(`${COMMERCE}/checkout/guest/start`, missingCookie, { lines: [{ catalogItemId, quantity: 1 }] });
const missingOriginPaymentsCalls = calls.length - missingCallsBefore;
await server.stop();
payments.close();

const failures = [];
if (provisionedCart !== "true") failures.push(`provisioned origin: cart data-checkout-available=${provisionedCart}, expected true`);
if (missingCart !== "false") failures.push(`missing origin: cart data-checkout-available=${missingCart}, expected false`);
for (const [label, entry] of [["prepare", missingPrepare], ["start", missingStart]]) {
  if (entry.status < 400 || entry.body?.data?.capability || checkoutOf(entry)) {
    failures.push(`missing origin: ${label} was admitted -> ${entry.status} ${JSON.stringify(entry.body)?.slice(0, 200)}`);
  }
}
if (missingOriginPaymentsCalls !== 0) failures.push(`missing origin: ${missingOriginPaymentsCalls} Payments calls, expected 0`);
for (const [key, entry] of Object.entries(cases)) {
  // Authorized live and restarted returns must confirm the retained paid order; every foreign, reset,
  // unbound and expired case must be refused before any Payments call or order disclosure.
  const ok = /^(live|restarted):.*:authorized$/.test(key) ? paidFor(entry) : refused(entry);
  if (!ok) failures.push(`${key} -> ${entry.status} ${JSON.stringify(entry.body)?.slice(0, 200)}`);
}
const sessionCalls = calls.filter((call) => call.path === "/v1/checkout/session");
if (sessionCalls.length === 0) failures.push("no Payments session was created");
if (sessionCalls.some((call) => call.clientIp !== "203.0.113.7")) failures.push("a Payments session call lacked the visitor's IP");
console.log(`trace: ${trace.length} cases`);
console.log(`paymentsCalls: ${calls.map((call) => call.path).join(", ")}`);
console.log(`settled: ${paidFor(settled)}`);
console.log(`restartRecoveryPaid: ${paidFor(cases["restarted:proxy:authorized"]) && paidFor(cases["restarted:registry:authorized"])}`);
console.log(`expiredRefused: ${refused(cases["expired:proxy:authorized"]) && refused(cases["expired:registry:authorized"])}`);
console.log(`missingOriginUnavailable: cart=${missingCart} prepare=${missingPrepare.status} start=${missingStart.status} paymentsCalls=${missingOriginPaymentsCalls}`);
console.log(JSON.stringify(summary, null, 2));
if (failures.length) throw new Error(`real HTTP paid-order proof failed:\n${failures.join("\n")}`);
console.log("PASS_PLAYGROUND_HTTP_PAID_ORDER");
process.exit(0);
