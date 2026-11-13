/**
 * Real-HTTP paid-order proof for the playground's Stripe TEST checkout, on the built playground Worker with
 * Commerce's Registry build installed in-store (template-one-build-registry-20261031). A local stand-in for the
 * Payments service answers the passes, sessions and lookups the playground's checkout guard forwards.
 *
 * It proves the store's own server cart (template-cart-real-form-20261113), with no page script:
 * - a configured playground visitor adds to the cart with the plain form, posts the checkout form, is sent to
 *   Stripe, and the thank-you page draws the paid order from the cart cookie alone;
 * - a foreign or reset visitor holding the same cart key sees no order, and Commerce's own cart route refuses
 *   them before any Payments call or order disclosure;
 * - the paid order still shows after the Worker restarts (the binding is read back from SQLite);
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

async function request(path, cookie, body, capability = "capability-proof", origin = PLAYGROUND_PROOF_SITE) {
  const before = calls.length;
  const response = await fetch(`${base}${path}`, { method: "POST", body: JSON.stringify(body), headers: {
    "content-type": "application/json", origin, cookie, "cf-connecting-ip": "203.0.113.7",
    "x-commerce-guest-capability": capability,
  } });
  const jsonBody = await response.json().catch(() => null);
  const entry = { path, cookie: cookie.replace(/=[^;]*/g, "=redacted"), status: response.status, body: jsonBody, paymentsCalls: calls.length - before };
  trace.push(entry);
  return entry;
}
/** A plain form post, as a browser with script off sends it; redirects are read, not followed. */
async function form(path, cookie, fields) {
  const before = calls.length;
  const response = await fetch(`${base}${path}`, { method: "POST", body: new URLSearchParams(fields), redirect: "manual", headers: {
    origin: PLAYGROUND_PROOF_SITE, "sec-fetch-site": "same-origin", cookie, "cf-connecting-ip": "203.0.113.7",
  } });
  const setCookies = response.headers.getSetCookie();
  const entry = { path, status: response.status, location: response.headers.get("location"), setCookies: setCookies.map((c) => c.replace(/=[^;]*/, "=redacted")),
    paymentsCalls: calls.length - before, html: response.status === 200 || response.status === 422 ? await response.text() : "" };
  trace.push({ ...entry, html: undefined });
  return { ...entry, setCookies };
}
async function page(path, cookie) {
  const before = calls.length;
  const response = await fetch(`${base}${path}`, { headers: { cookie, "cf-connecting-ip": "203.0.113.7" }, redirect: "manual" });
  const html = await response.text();
  const entry = { path, status: response.status, location: response.headers.get("location"),
    state: html.match(/data-guest-checkout-return-state="([a-z-]+)"/)?.[1] ?? null,
    order: html.match(/data-guest-checkout-order-number>Order ([^<]+)</)?.[1] ?? null, paymentsCalls: calls.length - before };
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
const cookieValue = (setCookies, name) => setCookies.map((c) => c.split(";")[0]).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;

const { cookie: session } = await startPlaygroundVisitor(base, "203.0.113.7", server.output);
const { cookie: foreignSession } = await startPlaygroundVisitor(base, "203.0.113.8", server.output);
const { cookie: resetSession } = await startPlaygroundVisitor(base, "203.0.113.9", server.output);
const provisionedCart = await cartAdmission(session);
const catalogItemId = await sellableItem(session);

const added = await form("/cart/add", session, { id: catalogItemId, quantity: "1" });
const capability = cookieValue(added.setCookies, "dk_cart");
if (added.status !== 303 || added.location !== "/cart?added=1" || typeof capability !== "string") {
  throw new Error(`the add form did not make a cart: ${added.status} ${added.location} ${added.setCookies.join(" | ")}\n${server.output.join("").slice(-3000)}`);
}
const keyCookie = added.setCookies.find((c) => c.startsWith("dk_cart="));
const cookie = `${session}; dk_cart=${capability}`;

// With Payments configured, nobody but the cart's own browser changes it or starts its purchase: a forged
// key or a foreign origin is refused before any cart write or Payments call, and the cart stays as it was.
const forgedKey = `${capability.slice(0, -4)}AAAA`;
const FOREIGN = "https://foreign.example.test";
const cartNow = async () => (await request(`${COMMERCE}/checkout/guest/cart`, session, {}, capability)).body?.data?.cart ?? null;
const before = await cartNow();
const writeAttempts = {
  forgedCartWrite: await request(`${COMMERCE}/checkout/guest/cart`, session, { version: before?.version ?? null, lines: [{ catalogItemId, quantity: 9 }] }, forgedKey),
  foreignCartWrite: await request(`${COMMERCE}/checkout/guest/cart`, session, { version: before?.version ?? null, lines: [{ catalogItemId, quantity: 9 }] }, capability, FOREIGN),
  forgedStart: await request(`${COMMERCE}/checkout/guest/start`, session, { contact: { email: "proof@example.test" } }, forgedKey),
  foreignStart: await request(`${COMMERCE}/checkout/guest/start`, session, { contact: { email: "proof@example.test" } }, capability, FOREIGN),
};
const after = await cartNow();
const writeRefusals = Object.fromEntries(Object.entries(writeAttempts).map(([name, entry]) => [name, {
  status: entry.status, code: entry.body?.data?.error?.code ?? entry.body?.error?.code ?? null, paymentsCalls: entry.paymentsCalls,
  refused: !(entry.status === 200 && entry.body?.data?.ok === true) && entry.paymentsCalls === 0,
}]));
const cartUnchanged = JSON.stringify(before?.lines) === JSON.stringify(after?.lines) && before?.version === after?.version && before?.lines?.length === 1;
const started = await form("/checkout", cookie, {
  email: "proof@example.test", "delivery[name]": "Proof Visitor", "delivery[line1]": "1 Test Way", "delivery[city]": "Testville",
  "delivery[region]": "NC", "delivery[postalCode]": "27601", "delivery[country]": "US", billingSame: "on",
});
if (started.status !== 303 || !started.location?.startsWith("https://checkout.stripe.com/")) {
  throw new Error(`the checkout form did not open Stripe: ${started.status} ${started.location} ${started.html.match(/role="alert">([^<]+)/)?.[1] ?? ""}\n${server.output.join("").slice(-3000)}`);
}

const checkoutOf = (entry) => entry.body?.data?.checkout ?? entry.body?.checkout ?? null;
const paidRead = (entry) => entry.status === 200 && checkoutOf(entry)?.state === "paid" && checkoutOf(entry)?.order != null;
// Another visitor's store has no such cart: Commerce answers 403, or 200 with CAPABILITY_DENIED. Either way no order and no Payments call.
const denied = (entry) => entry.status === 403 || (entry.status === 200 && entry.body?.data?.ok === false && entry.body.data.error?.code === "CAPABILITY_DENIED");
const refused = (entry) => denied(entry) && entry.paymentsCalls === 0 && !JSON.stringify(entry.body ?? {}).includes("orderId");
const paidPage = (entry) => entry.status === 200 && entry.state === "paid" && typeof entry.order === "string";
const hiddenPage = (entry) => entry.status === 200 && entry.state !== "paid" && entry.order === null && entry.paymentsCalls === 0;
const cases = {};
async function returnMatrix(label) {
  cases[`${label}:page:authorized`] = await page("/checkout/success?session_id=cs_ignored", cookie);
  cases[`${label}:page:foreign`] = await page("/checkout/success", `${foreignSession}; dk_cart=${capability}`);
  cases[`${label}:page:reset`] = await page("/checkout/success", `${resetSession}; dk_cart=${capability}`);
  cases[`${label}:registry:authorized`] = await request(`${COMMERCE}/checkout/guest/cart`, session, {}, capability);
  cases[`${label}:registry:foreign`] = await request(`${COMMERCE}/checkout/guest/cart`, foreignSession, {}, capability);
  cases[`${label}:registry:reset`] = await request(`${COMMERCE}/checkout/guest/cart`, resetSession, {}, capability);
}
await returnMatrix("live");
const emptied = await page("/cart", cookie);

await server.stop();
server = await startPlaygroundWorker({ name: "checkout-proof", port, vars: READY, persistTo });
await warmSession(session);
await returnMatrix("restarted");
await server.stop();

server = await startPlaygroundWorker({ name: "checkout-proof-expired", port, persistTo,
  vars: { ...READY, DINKUS_LOCAL_PROOF_NOW: String(Date.now() + 2_000_000) } });
await warmSession(session);
cases["expired:page:authorized"] = await page("/checkout/success", cookie);
cases["expired:registry:authorized"] = await request(`${COMMERCE}/checkout/guest/cart`, session, {}, capability);
await server.stop();

writeFileSync(join(artifact, "trace.jsonl"), trace.map((item) => JSON.stringify(item)).join("\n") + "\n");
writeFileSync(join(artifact, "payments-calls.json"), JSON.stringify(calls, null, 2) + "\n");
const summary = Object.fromEntries(Object.entries(cases).map(([key, entry]) => [key,
  { status: entry.status, state: entry.state ?? checkoutOf(entry)?.state ?? null, paymentsCalls: entry.paymentsCalls }]));
writeFileSync(join(artifact, "status-matrix.json"), JSON.stringify(summary, null, 2) + "\n");

// Missing trusted return origin: the flag and every Payments value are set, but EMDASH_SITE_URL is not.
// Admission must fail closed: the cart shows checkout unavailable, and no entry reaches Commerce or Payments.
server = await startPlaygroundWorker({ name: "checkout-proof-missing-origin", port, persistTo: join(artifact, "state-missing-origin"),
  vars: { ...READY, EMDASH_SITE_URL: null } });
const missingCallsBefore = calls.length;
const { cookie: missingSession } = await startPlaygroundVisitor(base, "203.0.113.20", server.output);
const missingCart = await cartAdmission(missingSession);
const missingPrepare = await request(`${COMMERCE}/checkout/guest/prepare`, missingSession, {});
const missingStart = await form("/checkout", `${missingSession}; dk_cart=${capability}`, { email: "proof@example.test" });
const missingOriginPaymentsCalls = calls.length - missingCallsBefore;
await server.stop();
payments.close();

const failures = [];
if (provisionedCart !== "true") failures.push(`provisioned origin: cart data-checkout-available=${provisionedCart}, expected true`);
if (!/HttpOnly/iu.test(keyCookie ?? "") || !/SameSite=Lax/iu.test(keyCookie ?? "")) failures.push(`cart key cookie is not HttpOnly SameSite=Lax: ${keyCookie}`);
if (missingCart !== "false") failures.push(`missing origin: cart data-checkout-available=${missingCart}, expected false`);
if (missingPrepare.status < 400 || missingPrepare.body?.data?.capability) {
  failures.push(`missing origin: prepare was admitted -> ${missingPrepare.status} ${JSON.stringify(missingPrepare.body)?.slice(0, 200)}`);
}
if (missingStart.status === 303) failures.push(`missing origin: the checkout form was sent on to ${missingStart.location}`);
for (const [name, result] of Object.entries(writeRefusals)) if (!result.refused) failures.push(`${name} was not refused: ${JSON.stringify(result)}`);
if (!cartUnchanged) failures.push(`the cart changed under refused writes: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
if (missingOriginPaymentsCalls !== 0) failures.push(`missing origin: ${missingOriginPaymentsCalls} Payments calls, expected 0`);
if (emptied.status !== 200) failures.push(`the cart after payment answered ${emptied.status}`);
for (const [key, entry] of Object.entries(cases)) {
  // The paying visitor sees the paid order live and after a restart; every foreign, reset and expired case
  // is refused, or shows no order, before any Payments call.
  const authorized = /^(live|restarted):.*:authorized$/.test(key);
  const ok = key.includes(":page:") ? (authorized ? paidPage(entry) : hiddenPage(entry)) : (authorized ? paidRead(entry) : refused(entry));
  if (!ok) failures.push(`${key} -> ${entry.status} ${JSON.stringify(entry.body ?? { state: entry.state, order: entry.order })?.slice(0, 200)}`);
}
const sessionCalls = calls.filter((call) => call.path === "/v1/checkout/session");
if (sessionCalls.length === 0) failures.push("no Payments session was created");
if (sessionCalls.some((call) => call.clientIp !== "203.0.113.7")) failures.push("a Payments session call lacked the visitor's IP");
console.log(`trace: ${trace.length} cases`);
console.log(`paymentsCalls: ${calls.map((call) => call.path).join(", ")}`);
console.log(`thankYouPage: ${paidPage(cases["live:page:authorized"])} order=${cases["live:page:authorized"].order}`);
console.log(`restartRecoveryPaid: ${paidPage(cases["restarted:page:authorized"]) && paidRead(cases["restarted:registry:authorized"])}`);
console.log(`expiredRefused: ${hiddenPage(cases["expired:page:authorized"]) && refused(cases["expired:registry:authorized"])}`);
console.log(`writeRefusals: ${JSON.stringify(writeRefusals)} cartUnchanged=${cartUnchanged}`);
console.log(`missingOriginUnavailable: cart=${missingCart} prepare=${missingPrepare.status} checkout=${missingStart.status} paymentsCalls=${missingOriginPaymentsCalls}`);
console.log(JSON.stringify(summary, null, 2));
if (failures.length) throw new Error(`real HTTP paid-order proof failed:\n${failures.join("\n")}`);
console.log("PASS_PLAYGROUND_HTTP_PAID_ORDER");
process.exit(0);
