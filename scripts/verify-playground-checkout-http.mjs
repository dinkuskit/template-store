import { createServer } from "node:http";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const artifact = resolve(root, ".artifacts/playground-http-proof");
rmSync(artifact, { recursive: true, force: true });
mkdirSync(artifact, { recursive: true });
const trace = [];
const calls = [];
const expiry = Math.floor(Date.now() / 1000) + 1860;
const payments = createServer(async (request, response) => {
  const body = await new Promise((resolveBody) => {
    let text = "";
    request.on("data", (chunk) => { text += chunk; });
    request.on("end", () => resolveBody(text));
  });
  const parsed = body ? JSON.parse(body) : null;
  calls.push({ path: request.url, attemptId: parsed?.attemptId ?? null });
  if (request.url === "/api/store-passes") return json(response, { access_token: "a.b.c", token_type: "Bearer", expires_in: 300 });
  if (request.url?.startsWith("/v1/checkout-binding") || request.url?.startsWith("/v1/existing-binding")) {
    return json(response, { bindingRef: "playground", providerId: "stripe", stripeAccountId: "acct_TEST1", mode: "test", ready: true });
  }
  if (request.url === "/v1/checkout/session") {
    return json(response, { outcome: "open", attemptId: parsed.attemptId, total: parsed.total,
      session: { sessionId: `cs_${parsed.attemptId}`, redirectUrl: "https://checkout.stripe.test/session", createdAt: Math.floor(Date.now() / 1000), expiresAt: expiry } });
  }
  if (request.url === "/v1/checkout/lookup") {
    return json(response, { outcome: "paid", attemptId: parsed.attemptId, total: parsed.total,
      paymentId: `pay_${parsed.attemptId}`, session: { sessionId: `cs_${parsed.attemptId}`, redirectUrl: "https://checkout.stripe.test/session", createdAt: Math.floor(Date.now() / 1000), expiresAt: expiry } });
  }
  response.writeHead(404); response.end();
});
function json(response, value) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}
await new Promise((resolveReady) => payments.listen(0, "127.0.0.1", resolveReady));
const paymentsUrl = `http://127.0.0.1:${payments.address().port}`;
const appPort = 4397;
const wranglerProofConfig = join(artifact, "wrangler.playground.proof.jsonc");
const wranglerConfig = JSON.parse(readFileSync(join(root, "wrangler.playground.jsonc"), "utf8"));
wranglerConfig.main = "../../src/playground-worker.ts";
wranglerConfig.assets.directory = "../../dist/client";
wranglerConfig.vars = {
  ...wranglerConfig.vars,
  DINKUS_CHECKOUT_ENABLED: "1",
  DINKUS_LOCAL_PROOF: "1",
  PAYMENTS_URL: "https://payments.local",
  PAYMENTS_LOCAL_HTTP_URL: paymentsUrl,
  PAYMENTS_STORE_PASSES_URL: `${paymentsUrl}/api/store-passes`,
  PAYMENTS_STORE_KEY: `dk_store_${"k".repeat(43)}`,
  PAYMENTS_STRIPE_ACCOUNT_ID: "acct_TEST1",
  // Provisioned like the other checkout env (see src/features/playground-checkout/index.ts):
  // the trusted return origin admission requires. The missing-origin phase
  // below proves checkout stays unavailable without it.
  EMDASH_SITE_URL: `http://127.0.0.1:${appPort}`,
  DINKUS_LOCAL_PROOF_SITE_URL: `http://127.0.0.1:${appPort}`,
};
wranglerConfig.previews = {
  ...wranglerConfig.previews,
  vars: { ...wranglerConfig.vars },
};
writeFileSync(wranglerProofConfig, JSON.stringify(wranglerConfig, null, 2));
const expiredProofConfig = join(artifact, "wrangler.playground.expired.jsonc");
writeFileSync(expiredProofConfig, JSON.stringify({
  ...wranglerConfig,
  vars: { ...wranglerConfig.vars, DINKUS_LOCAL_PROOF_NOW: String(Date.now() + 2_000_000) },
  previews: { ...wranglerConfig.previews, vars: { ...wranglerConfig.vars, DINKUS_LOCAL_PROOF_NOW: String(Date.now() + 2_000_000) } },
}, null, 2));
const { EMDASH_SITE_URL: _provisionedOrigin, ...missingOriginVars } = wranglerConfig.vars;
const missingOriginConfig = join(artifact, "wrangler.playground.missing-origin.jsonc");
writeFileSync(missingOriginConfig, JSON.stringify({
  ...wranglerConfig,
  vars: missingOriginVars,
  previews: { ...wranglerConfig.previews, vars: missingOriginVars },
}, null, 2));
const serverEnv = { ...process.env, ASTRO_DEV_BACKGROUND: "0", DINKUS_LOCAL_PROOF: "1",
    DINKUS_CHECKOUT_ENABLED: "1",
    DINKUS_LOCAL_PROOF_SITE_URL: `http://127.0.0.1:${appPort}`,
    PAYMENTS_URL: "https://payments.local", PAYMENTS_LOCAL_HTTP_URL: paymentsUrl,
    PAYMENTS_STORE_PASSES_URL: `${paymentsUrl}/api/store-passes`,
    PAYMENTS_STORE_KEY: `dk_store_${"k".repeat(43)}`, PAYMENTS_STRIPE_ACCOUNT_ID: "acct_TEST1",
    EMDASH_SITE_URL: `http://127.0.0.1:${appPort}`, DINKUS_TEMPLATE_DB_URL: `file:${join(artifact, "visitor.db")}`,
    DINKUS_TEMPLATE_UPLOADS_DIR: join(artifact, "uploads"),
    DINKUS_PLAYGROUND_WRANGLER_CONFIG: wranglerProofConfig };
const activeChildren = new Set();
process.on("exit", () => {
  for (const child of activeChildren) {
    try { process.kill(-child.pid, "SIGTERM"); } catch {}
  }
});
function spawnServer(env) {
  const child = spawn("pnpm", ["exec", "astro", "dev", "--config", "astro.playground.config.mjs",
    "--host", "127.0.0.1", "--port", String(appPort), "--force"], {
    cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"], env,
  });
  activeChildren.add(child);
  child.once("exit", () => activeChildren.delete(child));
  return child;
}
async function stopServer(child) {
  try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2000)),
  ]);
  try { process.kill(-child.pid, "SIGKILL"); } catch {}
  child.stdout?.destroy();
  child.stderr?.destroy();
}
const app = spawnServer(serverEnv);
const output = [];
app.stdout.on("data", (chunk) => output.push(String(chunk)));
app.stderr.on("data", (chunk) => output.push(String(chunk)));
await waitForHttp(`http://127.0.0.1:${appPort}/`);
await waitForReady(output);

const origin = `http://127.0.0.1:${appPort}`;
const base = { "content-type": "application/json", origin, "cf-connecting-ip": "203.0.113.7" };
async function request(path, cookie, body, capability = "capability-proof") {
  return requestAt(origin, path, cookie, body, capability);
}
async function requestAt(requestOrigin, path, cookie, body, capability = "capability-proof") {
  const before = calls.length;
  const response = await fetch(`${requestOrigin}${path}`, { method: "POST", headers: { ...base, origin: requestOrigin, cookie, "x-commerce-guest-capability": capability }, body: JSON.stringify(body) });
  const jsonBody = await response.json().catch(() => null);
  const entry = { path, cookie: cookie.replace(/=.*/, "=redacted"), status: response.status, body: jsonBody, paymentsCalls: calls.length - before };
  trace.push(entry);
  return entry;
}

async function initSession(ip) {
  let loading;
  try {
    loading = await fetch(`${origin}/playground`, { headers: { origin, "cf-connecting-ip": ip } });
  } catch (error) {
    throw new Error(`playground request failed: ${error.message}\n${output.join("")}`);
  }
  const sessionCookie = loading.headers.get("set-cookie")?.split(";")[0];
  if (!sessionCookie) throw new Error(`playground loading page did not issue a session cookie (${loading.status})`);
  let initResponse;
  try {
    initResponse = await fetch(`${origin}/_playground/init`, {
      method: "POST",
      headers: { origin, cookie: sessionCookie, "cf-connecting-ip": ip, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
  } catch (error) {
    throw new Error(`playground init request failed: ${error.message}\n${output.join("")}`);
  }
  if (!initResponse.ok) throw new Error(`playground init failed (${initResponse.status}): ${(await initResponse.text()).slice(0, 300)}`);
  return sessionCookie;
}
const cookie = await initSession("203.0.113.7");
const foreignCookie = await initSession("203.0.113.8");
const resetCookie = await initSession("203.0.113.9");
let pageResponse;
try {
  pageResponse = await fetch(`${origin}/`, { headers: { cookie } });
} catch (error) {
  throw new Error(`Astro request failed: ${error.message}\n${output.join("")}`);
}
if (!pageResponse.ok) throw new Error(`playground page status ${pageResponse.status}: ${(await pageResponse.text()).slice(0, 300)}`);
const page = await pageResponse.text();
const productId = page.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0];
if (!productId) throw new Error("playground page did not expose a seeded catalog item");
const provisionedCart = await cartAdmission(origin, cookie);
const created = await request("/_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare", cookie, {});
const capability = created.body?.data?.capability?.capability;
if (typeof capability !== "string") throw new Error(`native Commerce did not issue a capability: ${JSON.stringify(created.body)}\n${output.join("")}`);
const started = await request("/_emdash/api/plugins/dinkus-commerce/checkout/guest/start", cookie,
  { lines: [{ catalogItemId: productId, quantity: 1 }],
    contact: { email: "proof@example.test", delivery: {
      name: "Proof Visitor", line1: "1 Test Way", city: "Testville",
      region: "NC", postalCode: "00000", country: "US",
    } } }, capability);
const attemptId = started.body?.data?.checkout?.attemptId ?? started.body?.checkout?.attemptId ?? started.body?.data?.attemptId ?? started.body?.attemptId;
if (typeof attemptId !== "string" || attemptId.length === 0) {
  throw new Error(`native Commerce start response did not contain an attempt ID: ${JSON.stringify(started.body)}`);
}
// Both status entrypoints: the storefront's /api/checkout/status proxy and the
// native Commerce route the cart calls directly.
const STATUS_ENTRYPOINTS = ["/api/checkout/status", "/_emdash/api/plugins/dinkus-commerce/checkout/guest/status"];
const checkoutOf = (entry) => entry.body?.data?.checkout ?? entry.body?.checkout ?? null;
const paidFor = (entry) => entry.status === 200 && checkoutOf(entry)?.state === "paid" &&
  checkoutOf(entry)?.attemptId === attemptId && checkoutOf(entry)?.order != null;
const refused = (entry) => entry.status === 403 && entry.paymentsCalls === 0 && !JSON.stringify(entry.body ?? {}).includes("orderId");
const cases = {};
async function statusMatrix(label, at = origin) {
  for (const path of STATUS_ENTRYPOINTS) {
    const key = `${label}:${path.startsWith("/api") ? "proxy" : "native"}`;
    cases[`${key}:authorized`] = await requestAt(at, path, cookie, { attemptId }, capability);
    cases[`${key}:foreign`] = await requestAt(at, path, foreignCookie, { attemptId }, capability);
    cases[`${key}:reset`] = await requestAt(at, path, resetCookie, { attemptId }, capability);
    cases[`${key}:unbound`] = await requestAt(at, path, cookie, { attemptId: "unbound-proof" }, capability);
  }
}
await statusMatrix("live");
const settled = cases["live:proxy:authorized"];
await stopServer(app);
const restarted = spawnServer(serverEnv);
const restartedOutput = [];
restarted.stdout.on("data", (chunk) => restartedOutput.push(String(chunk)));
restarted.stderr.on("data", (chunk) => restartedOutput.push(String(chunk)));
await waitForHttp(`${origin}/`);
await waitForReady(restartedOutput);
await warmSession(origin, cookie);
await statusMatrix("restarted");
await stopServer(restarted);
const expiredEnv = {
  ...serverEnv,
  DINKUS_LOCAL_PROOF_NOW: String(Date.now() + 2_000_000),
  DINKUS_LOCAL_PROOF_SITE_URL: `http://127.0.0.1:${appPort}`,
  EMDASH_SITE_URL: `http://127.0.0.1:${appPort}`,
  DINKUS_PLAYGROUND_WRANGLER_CONFIG: expiredProofConfig,
};
const expired = spawnServer(expiredEnv);
const expiredOutput = [];
expired.stdout.on("data", (chunk) => expiredOutput.push(String(chunk)));
expired.stderr.on("data", (chunk) => expiredOutput.push(String(chunk)));
const expiredOrigin = origin;
await waitForHttp(`${expiredOrigin}/`);
await waitForReady(expiredOutput);
await warmSession(expiredOrigin, cookie);
for (const path of STATUS_ENTRYPOINTS) {
  cases[`expired:${path.startsWith("/api") ? "proxy" : "native"}:authorized`] = await requestAt(expiredOrigin, path, cookie, { attemptId }, capability);
}
writeFileSync(join(artifact, "trace.jsonl"), trace.map((item) => JSON.stringify(item)).join("\n") + "\n");
writeFileSync(join(artifact, "payments-calls.json"), JSON.stringify(calls.map(({ path, attemptId: id }) => ({ path, attemptId: id })), null, 2) + "\n");
const summary = Object.fromEntries(Object.entries(cases).map(([key, entry]) => [key,
  { status: entry.status, state: checkoutOf(entry)?.state ?? null, paymentsCalls: entry.paymentsCalls }]));
writeFileSync(join(artifact, "status-matrix.json"), JSON.stringify(summary, null, 2) + "\n");
await stopServer(expired);

// Missing trusted return origin: the flag and every Payments value are set,
// but EMDASH_SITE_URL is not provisioned (neither in the Wrangler vars nor
// the process env). Admission must fail closed: the cart shows checkout
// unavailable, and neither checkout entry reaches Commerce or Payments.
const { EMDASH_SITE_URL: _omittedOrigin, ...missingOriginProcessEnv } = serverEnv;
const missingOriginEnv = { ...missingOriginProcessEnv, DINKUS_PLAYGROUND_WRANGLER_CONFIG: missingOriginConfig };
const missingOrigin = spawnServer(missingOriginEnv);
const missingOriginOutput = [];
missingOrigin.stdout.on("data", (chunk) => missingOriginOutput.push(String(chunk)));
missingOrigin.stderr.on("data", (chunk) => missingOriginOutput.push(String(chunk)));
await waitForHttp(`${origin}/`);
await waitForReady(missingOriginOutput);
const missingCallsBefore = calls.length;
const missingCookie = await initSession("203.0.113.20");
const missingCart = await cartAdmission(origin, missingCookie);
const missingPrepare = await request("/_emdash/api/plugins/dinkus-commerce/checkout/guest/prepare", missingCookie, {});
const missingStart = await request("/_emdash/api/plugins/dinkus-commerce/checkout/guest/start", missingCookie,
  { lines: [{ catalogItemId: productId, quantity: 1 }] }, "capability-proof");
const missingOriginPaymentsCalls = calls.length - missingCallsBefore;
await stopServer(missingOrigin);
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
  // Authorized live and restarted returns must confirm the retained paid
  // order; every foreign, reset, unbound and expired case must be refused
  // before any Payments call or order disclosure.
  const ok = /^(live|restarted):.*:authorized$/.test(key) ? paidFor(entry) : refused(entry);
  if (!ok) failures.push(`${key} -> ${entry.status} ${JSON.stringify(entry.body)?.slice(0, 200)}`);
}
if (calls.length === 0) failures.push("no Payments session was created");
console.log(`trace: ${trace.length} cases`);
console.log(`paymentsCalls: ${calls.length}`);
console.log(`settled: ${paidFor(settled)}`);
console.log(`restartRecoveryPaid: ${paidFor(cases["restarted:proxy:authorized"]) && paidFor(cases["restarted:native:authorized"])}`);
console.log(`expiredRefused: ${refused(cases["expired:proxy:authorized"]) && refused(cases["expired:native:authorized"])}`);
console.log(`missingOriginUnavailable: cart=${missingCart} prepare=${missingPrepare.status} start=${missingStart.status} paymentsCalls=${missingOriginPaymentsCalls}`);
console.log(JSON.stringify(summary, null, 2));
if (failures.length) {
  throw new Error(`real HTTP paid-order proof failed:\n${failures.join("\n")}\n${output.join("").slice(-4000)}`);
}
console.log("PASS_PLAYGROUND_HTTP_PAID_ORDER");
process.exit(0);

async function waitForHttp(url) {
  for (let i = 0; i < 120; i++) {
    try { const response = await fetch(url); if (response.status < 500) return; } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`local Astro server did not start\n${output.join("")}`);
}

async function waitForReady(log) {
  for (let i = 0; i < 120; i++) {
    if (log.some((line) => line.includes("watching for file changes") || line.includes("Ready on http"))) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`local Astro server did not become ready\n${output.join("")}`);
}

async function cartAdmission(requestOrigin, cookie) {
  const response = await fetch(`${requestOrigin}/cart`, { headers: { cookie, "cf-connecting-ip": "203.0.113.7" } });
  const html = await response.text();
  if (!response.ok) throw new Error(`cart page status ${response.status}: ${html.slice(0, 300)}`);
  return html.match(/data-checkout-available="(true|false)"/)?.[1] ?? null;
}

async function warmSession(requestOrigin, cookie) {
  const response = await fetch(`${requestOrigin}/playground`, {
    headers: { origin: requestOrigin, cookie, "cf-connecting-ip": "203.0.113.7" },
  });
  if (!response.ok) throw new Error(`playground session warmup failed (${response.status})`);
}
