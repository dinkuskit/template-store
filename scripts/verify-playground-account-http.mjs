/**
 * Real-HTTP shopper-account authority proof on the built playground Worker, with Commerce's Registry build
 * installed in the visitor's store (template-one-build-registry-20261031). Commerce's Registry routes refuse
 * in-band ({ ok: false, error } with HTTP 200), as in every store, so a refusal is its error code with nothing
 * disclosed. Commerce keeps its own clock: its 30-second sign-in code cooldown is waited out in real time, and its
 * 30-day session expiry is Commerce's to prove. Pass --no-build to reuse the current playground build.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildPlaygroundWorker,
  PLAYGROUND_PROOF_SITE,
  startPlaygroundVisitor,
  startPlaygroundWorker,
} from "./lib/playground-worker-proof.mjs";

const root = resolve(import.meta.dirname, "..");
const artifact = resolve(root, ".artifacts/playground-account-http-proof");
rmSync(artifact, { recursive: true, force: true });
mkdirSync(artifact, { recursive: true });
const persistTo = join(artifact, "state");

const appPort = 4398;
const origin = PLAYGROUND_PROOF_SITE;
const trace = [];
const cases = {};

const baseNowMs = Date.now();
const secondOtpNowMs = baseNowMs + 60 * 1000;
const baseNowIso = new Date(baseNowMs).toISOString();
const secondOtpNowIso = new Date(secondOtpNowMs).toISOString();
const leadEmail = `verified.lead.${baseNowMs}@example.com`;

const proofVars = {
  DINKUS_LOCAL_PROOF: "1",
  DINKUS_PROOF_MODE: "1",
  DINKUS_LOCAL_PROOF_SITE_URL: origin,
  DINKUS_PLAYGROUND_ACCOUNT_ORIGIN: origin,
  DINKUS_LOCAL_PROOF_NOW: String(baseNowMs),
};
const serve = (name, vars) => startPlaygroundWorker({ name: `account-${name}`, port: appPort, persistTo, vars });

async function initSession(ip, output) {
  return (await startPlaygroundVisitor(base, ip, output)).cookie;
}

async function warmSession(cookie, ip = "203.0.113.41") {
  const response = await fetch(`${base}/playground`, {
    headers: { origin, cookie, "cf-connecting-ip": ip },
    redirect: "manual",
  });
  if (response.status >= 400) {
    throw new Error(`playground session warmup failed (${response.status})`);
  }
}

async function callAccount({
  label,
  method = "GET",
  path,
  cookie,
  sessionToken = null,
  body = undefined,
  requestOrigin = origin,
  ip = "203.0.113.41",
}) {
  const headers = {
    origin: requestOrigin,
    cookie,
    "cf-connecting-ip": ip,
    ...(body !== undefined ? { "content-type": "application/json" } : {}),
    ...(sessionToken ? { "x-commerce-customer-session": sessionToken } : {}),
  };
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const jsonBody = await response.json().catch(() => null);
  const unpacked = jsonBody?.data ?? jsonBody;
  const errorCode =
    jsonBody?.error?.code ??
    unpacked?.error?.code ??
    (typeof jsonBody?.error === "string" ? jsonBody.error : null);
  const entry = {
    label,
    method,
    path,
    cookie: cookie.replace(/=.*/, "=redacted"),
    sessionToken: sessionToken ? "session=redacted" : null,
    origin: requestOrigin,
    status: response.status,
    errorCode,
    orderIds: Array.isArray(unpacked?.orders) ? unpacked.orders.map((o) => o.orderId) : null,
    profileLine1: unpacked?.profile?.delivery?.line1 ?? null,
    signedOut: unpacked?.signedOut ?? null,
  };
  trace.push(entry);
  cases[label] = { ...entry, raw: unpacked };
  return cases[label];
}

const REGISTRY_PREFIX = "/_emdash/api/plugins/r_gshdrqaldna3r7sn/account";

buildPlaygroundWorker();
const live = await serve("live", proofVars);
const base = live.base;

const cookieA = await initSession("203.0.113.41", live.output);
const cookieB = await initSession("203.0.113.42", live.output);
const cookieReset = await initSession("203.0.113.43", live.output);

// 0. Seed a pre-upgrade paid order (#1002, ord_pre_upgrade_1000) in Visitor A's existing DB before any account route runs
const preUpgradeSeedRes = await fetch(`${base}/api/proof/shopper-account`, {
  method: "POST",
  headers: {
    origin,
    cookie: cookieA,
    "cf-connecting-ip": "203.0.113.41",
    "content-type": "application/json",
  },
  body: JSON.stringify({}),
});
const preUpgradeSeedBody = await preUpgradeSeedRes.json().catch(() => null);
if (!preUpgradeSeedRes.ok || preUpgradeSeedBody?.preUpgradeOrderId !== "ord_pre_upgrade_1000") {
  throw new Error(
    `pre-upgrade order seed failed (${preUpgradeSeedRes.status}): ${JSON.stringify(preUpgradeSeedBody)}`,
  );
}
cases["live:pre-upgrade-seed:visitorA"] = {
  label: "live:pre-upgrade-seed:visitorA",
  method: "POST",
  path: "/api/proof/shopper-account",
  cookie: cookieA.replace(/=.*/, "=redacted"),
  sessionToken: null,
  origin,
  status: preUpgradeSeedRes.status,
  errorCode: null,
  orderIds: [preUpgradeSeedBody.preUpgradeOrderId],
  profileLine1: null,
  signedOut: null,
};
trace.push(cases["live:pre-upgrade-seed:visitorA"]);

// 0b. Mint a shopper session in Visitor Reset, then execute /_playground/reset -> /playground -> /_playground/init
const demoSessionResetBefore = await callAccount({
  label: "live:demo-session:visitorReset-before-reset",
  method: "POST",
  path: "/api/account/demo-session",
  cookie: cookieReset,
  ip: "203.0.113.43",
  body: {},
});
const tokenResetBefore = demoSessionResetBefore.raw?.capability?.session;
if (typeof tokenResetBefore !== "string") {
  throw new Error(
    `visitorReset demo-session did not issue a shopper session token: ${JSON.stringify(demoSessionResetBefore.raw)}`,
  );
}
const resetResponse = await fetch(`${base}/_playground/reset`, {
  method: "GET",
  redirect: "manual",
  headers: {
    origin,
    cookie: cookieReset,
    "cf-connecting-ip": "203.0.113.43",
  },
});
if (resetResponse.status !== 302) {
  throw new Error(`/_playground/reset did not redirect with 302 (${resetResponse.status})`);
}
const cookieAfterReset = await initSession("203.0.113.43", live.output);
if (cookieAfterReset === cookieReset) {
  throw new Error("/_playground/reset did not rotate the visitor sandbox session cookie");
}
await callAccount({
  label: "live:registry:orders:own-token-after-playground-reset",
  method: "GET",
  path: `${REGISTRY_PREFIX}/orders`,
  cookie: cookieAfterReset,
  sessionToken: tokenResetBefore,
  ip: "203.0.113.43",
});

// 1. Mint demo session in Visitor A
const demoSessionA = await callAccount({
  label: "live:demo-session:visitorA",
  method: "POST",
  path: "/api/account/demo-session",
  cookie: cookieA,
  body: {},
});
const tokenA = demoSessionA.raw?.capability?.session;
if (typeof tokenA !== "string") {
  throw new Error(`demo-session did not issue a shopper session token: ${JSON.stringify(demoSessionA.raw)}`);
}

// 2. Save custom profile delivery address in Visitor A (Registry path)
await callAccount({
  label: "live:registry:profile-write:visitorA",
  method: "POST",
  path: `${REGISTRY_PREFIX}/profile`,
  cookie: cookieA,
  sessionToken: tokenA,
  body: {
    phone: "+1 503 555 0199",
    delivery: {
      name: "Visitor A Shopper",
      line1: "900 Durable Ave",
      line2: "Suite 400",
      city: "Portland",
      region: "OR",
      postalCode: "97205",
      country: "US",
    },
  },
});

// 3. Verify Path 1 (Verified OTP + Opt-In Lead Capture) in Visitor A
await callAccount({
  label: "live:registry:otp-start:without-optin-refused",
  method: "POST",
  path: `${REGISTRY_PREFIX}/sign-in/start`,
  cookie: cookieA,
  body: { email: leadEmail, optInUpdates: false },
});
const firstOtpStartedAt = Date.now();
await callAccount({
  label: "live:registry:otp-start:with-optin",
  method: "POST",
  path: `${REGISTRY_PREFIX}/sign-in/start`,
  cookie: cookieA,
  body: { email: leadEmail, optInUpdates: true },
});
const proofEmailRes = await fetch(
  `${base}/api/proof/shopper-account?email=${encodeURIComponent(leadEmail)}`,
  { headers: { cookie: cookieA } },
);
const proofEmailBody = await proofEmailRes.json();
const otpCode = proofEmailBody?.email?.code;
if (!/^[0-9]{6}$/.test(String(otpCode ?? ""))) {
  throw new Error(`proof endpoint did not return 6-digit OTP code: ${JSON.stringify(proofEmailBody)}`);
}
const verifiedOtp = await callAccount({
  label: "live:registry:otp-verify:with-optin",
  method: "POST",
  path: `${REGISTRY_PREFIX}/sign-in/verify`,
  cookie: cookieA,
  body: { email: leadEmail, code: otpCode, optInUpdates: true },
});
const otpTokenA = verifiedOtp.raw?.capability?.session;
if (typeof otpTokenA !== "string") {
  throw new Error(`otp verify did not issue a shopper session token: ${JSON.stringify(verifiedOtp.raw)}`);
}
const liveLeadsRes = await fetch(`${base}/api/proof/shopper-account`, {
  headers: { cookie: cookieA },
});
const liveLeadsBody = await liveLeadsRes.json().catch(() => null);
const liveLeadRow = Array.isArray(liveLeadsBody?.leads)
  ? liveLeadsBody.leads.find((lead) => lead.email === leadEmail) ?? null
  : null;
cases["live:leads-db:after-first-otp"] = {
  label: "live:leads-db:after-first-otp",
  method: "GET",
  path: "/api/proof/shopper-account",
  cookie: cookieA.replace(/=.*/, "=redacted"),
  sessionToken: null,
  origin,
  status: liveLeadsRes.status,
  errorCode: null,
  orderIds: null,
  profileLine1: null,
  signedOut: null,
  lead: liveLeadRow ? { ...liveLeadRow, email: "verified.lead@example.com" } : null,
};
trace.push(cases["live:leads-db:after-first-otp"]);

// 4. Run the authority matrix on Commerce's account routes while live
async function runAuthorityMatrix(phase) {
  for (const [surface, prefix] of [["registry", REGISTRY_PREFIX]]) {
    await callAccount({
      label: `${phase}:${surface}:orders:authorized`,
      method: "GET",
      path: `${prefix}/orders`,
      cookie: cookieA,
      sessionToken: tokenA,
    });
    await callAccount({
      label: `${phase}:${surface}:orders:foreign-visitor`,
      method: "GET",
      path: `${prefix}/orders`,
      cookie: cookieB,
      sessionToken: tokenA,
      ip: "203.0.113.42",
    });
    await callAccount({
      label: `${phase}:${surface}:profile-write:foreign-visitor`,
      method: "POST",
      path: `${prefix}/profile`,
      cookie: cookieB,
      sessionToken: tokenA,
      ip: "203.0.113.42",
      body: {
        delivery: {
          name: "Foreign Visitor",
          line1: "1 Spoof St",
          city: "Portland",
          region: "OR",
          postalCode: "97201",
          country: "US",
        },
      },
    });
    await callAccount({
      label: `${phase}:${surface}:orders:reset-visitor`,
      method: "GET",
      path: `${prefix}/orders`,
      cookie: cookieReset,
      sessionToken: tokenA,
      ip: "203.0.113.43",
    });
  }
}

await runAuthorityMatrix("live");

// Cross-origin write refusal
await callAccount({
  label: "live:registry:profile-write:cross-origin",
  method: "POST",
  path: `${REGISTRY_PREFIX}/profile`,
  cookie: cookieA,
  sessionToken: tokenA,
  requestOrigin: "https://evil.example",
  body: {
    delivery: {
      name: "Cross Origin",
      line1: "1 Evil Way",
      city: "Portland",
      region: "OR",
      postalCode: "97201",
      country: "US",
    },
  },
});

// Sign-out revocation on the OTP session token
await callAccount({
  label: "live:registry:sign-out:otp-session",
  method: "POST",
  path: `${REGISTRY_PREFIX}/sign-out`,
  cookie: cookieA,
  sessionToken: otpTokenA,
  body: {},
});
await callAccount({
  label: "live:registry:orders:after-sign-out",
  method: "GET",
  path: `${REGISTRY_PREFIX}/orders`,
  cookie: cookieA,
  sessionToken: otpTokenA,
});

await live.stop();

// 5. Restart server over the same existing database and verify existing-state persistence + foreign refusal + durable leads
const restarted = await serve("restarted", { ...proofVars, DINKUS_LOCAL_PROOF_NOW: String(secondOtpNowMs) });
await warmSession(cookieA, "203.0.113.41");
await warmSession(cookieB, "203.0.113.42");
await warmSession(cookieReset, "203.0.113.43");
await runAuthorityMatrix("restarted");

const restartedLeadsBeforeRes = await fetch(`${base}/api/proof/shopper-account`, {
  headers: { cookie: cookieA },
});
const restartedLeadsBeforeBody = await restartedLeadsBeforeRes.json().catch(() => null);
const restartedLeadBeforeRow = Array.isArray(restartedLeadsBeforeBody?.leads)
  ? restartedLeadsBeforeBody.leads.find((lead) => lead.email === leadEmail) ?? null
  : null;
cases["restarted:leads-db:before-second-otp"] = {
  label: "restarted:leads-db:before-second-otp",
  method: "GET",
  path: "/api/proof/shopper-account",
  cookie: cookieA.replace(/=.*/, "=redacted"),
  sessionToken: null,
  origin,
  status: restartedLeadsBeforeRes.status,
  errorCode: null,
  orderIds: null,
  profileLine1: null,
  signedOut: null,
  lead: restartedLeadBeforeRow
    ? { ...restartedLeadBeforeRow, email: "verified.lead@example.com" }
    : null,
};
trace.push(cases["restarted:leads-db:before-second-otp"]);

// Commerce's sign-in code cooldown runs on its own clock.
await new Promise((resolveDelay) => setTimeout(resolveDelay, Math.max(0, firstOtpStartedAt + 31_000 - Date.now())));
await callAccount({
  label: "restarted:registry:otp-start:with-optin",
  method: "POST",
  path: `${REGISTRY_PREFIX}/sign-in/start`,
  cookie: cookieA,
  body: { email: leadEmail, optInUpdates: true },
});
const secondProofEmailRes = await fetch(
  `${base}/api/proof/shopper-account?email=${encodeURIComponent(leadEmail)}`,
  { headers: { cookie: cookieA } },
);
const secondProofEmailBody = await secondProofEmailRes.json();
const secondOtpCode = secondProofEmailBody?.email?.code;
if (!/^[0-9]{6}$/.test(String(secondOtpCode ?? ""))) {
  throw new Error(
    `restarted proof endpoint did not return 6-digit OTP code: ${JSON.stringify(secondProofEmailBody)}`,
  );
}
await callAccount({
  label: "restarted:registry:otp-verify:with-optin",
  method: "POST",
  path: `${REGISTRY_PREFIX}/sign-in/verify`,
  cookie: cookieA,
  body: { email: leadEmail, code: secondOtpCode, optInUpdates: true },
});
const restartedLeadsAfterRes = await fetch(`${base}/api/proof/shopper-account`, {
  headers: { cookie: cookieA },
});
const restartedLeadsAfterBody = await restartedLeadsAfterRes.json().catch(() => null);
const restartedLeadAfterRow = Array.isArray(restartedLeadsAfterBody?.leads)
  ? restartedLeadsAfterBody.leads.find((lead) => lead.email === leadEmail) ?? null
  : null;
cases["restarted:leads-db:after-second-otp"] = {
  label: "restarted:leads-db:after-second-otp",
  method: "GET",
  path: "/api/proof/shopper-account",
  cookie: cookieA.replace(/=.*/, "=redacted"),
  sessionToken: null,
  origin,
  status: restartedLeadsAfterRes.status,
  errorCode: null,
  orderIds: null,
  profileLine1: null,
  signedOut: null,
  lead: restartedLeadAfterRow
    ? { ...restartedLeadAfterRow, email: "verified.lead@example.com" }
    : null,
};
trace.push(cases["restarted:leads-db:after-second-otp"]);

await restarted.stop();

// 6. Missing trusted account origin: the template's instant demo account fails closed (503)
const missingOrigin = await serve("missing-origin", {
  ...proofVars,
  DINKUS_PLAYGROUND_ACCOUNT_ORIGIN: null,
  DINKUS_LOCAL_PROOF_SITE_URL: null,
});
await warmSession(cookieA, "203.0.113.41");
await callAccount({
  label: "missing-origin:demo-session",
  method: "POST",
  path: "/api/account/demo-session",
  cookie: cookieA,
  body: {},
});
// Commerce's own route answers on the store origin EmDash gives it; recorded, not asserted.
await callAccount({
  label: "missing-origin:registry:orders",
  method: "GET",
  path: `${REGISTRY_PREFIX}/orders`,
  cookie: cookieA,
  sessionToken: tokenA,
});
await missingOrigin.stop();

const summary = Object.fromEntries(
  Object.entries(cases).map(([key, entry]) => [
    key,
    {
      status: entry.status,
      errorCode: entry.errorCode,
      orderIds: entry.orderIds,
      profileLine1: entry.profileLine1,
      signedOut: entry.signedOut,
      ...(entry.lead ? { lead: entry.lead } : {}),
    },
  ]),
);
writeFileSync(join(artifact, "trace.jsonl"), trace.map((item) => JSON.stringify(item)).join("\n") + "\n");
writeFileSync(join(artifact, "status-matrix.json"), JSON.stringify(summary, null, 2) + "\n");

/** Refused with `code`, disclosing no orders or profile: in-band (200) as Commerce answers, or an HTTP refusal. */
const refused = (entry, code) => [200, 401, 403].includes(entry?.status) && entry.errorCode === code &&
  !entry.orderIds && !entry.profileLine1;
const failures = [];
for (const phase of ["live", "restarted"]) {
  for (const surface of ["registry"]) {
    const ordersEntry = cases[`${phase}:${surface}:orders:authorized`];
    if (
      ordersEntry?.status !== 200 ||
      !ordersEntry.orderIds?.includes("ord_demo_shopper_1001") ||
      !ordersEntry.orderIds?.includes("ord_pre_upgrade_1000")
    ) {
      failures.push(`${phase}:${surface}:orders:authorized failed -> ${JSON.stringify(ordersEntry)}`);
    }
    // The saved profile comes back with the orders, unchanged by every refused write.
    if (ordersEntry?.profileLine1 !== "900 Durable Ave") {
      failures.push(`${phase}:${surface}:orders:authorized profile mismatch -> ${JSON.stringify(ordersEntry)}`);
    }
    for (const adverse of [
      `${phase}:${surface}:orders:foreign-visitor`,
      `${phase}:${surface}:profile-write:foreign-visitor`,
      `${phase}:${surface}:orders:reset-visitor`,
    ]) {
      const entry = cases[adverse];
      if (!refused(entry, "SESSION_DENIED")) {
        failures.push(`${adverse} was not refused with SESSION_DENIED -> ${JSON.stringify(entry)}`);
      }
    }
  }
}

for (const resetOwnCase of ["live:registry:orders:own-token-after-playground-reset"]) {
  const entry = cases[resetOwnCase];
  if (!refused(entry, "SESSION_DENIED")) {
    failures.push(`${resetOwnCase} must be refused with SESSION_DENIED -> ${JSON.stringify(entry)}`);
  }
}

const liveLead = cases["live:leads-db:after-first-otp"]?.lead;
if (
  liveLead?.email !== "verified.lead@example.com" ||
  liveLead?.firstVerifiedAt !== baseNowIso ||
  liveLead?.lastVerifiedAt !== baseNowIso ||
  liveLead?.verificationCount !== 1
) {
  failures.push(`live:leads-db:after-first-otp mismatch -> ${JSON.stringify(liveLead)}`);
}
const restartedLeadBefore = cases["restarted:leads-db:before-second-otp"]?.lead;
if (
  restartedLeadBefore?.email !== "verified.lead@example.com" ||
  restartedLeadBefore?.firstVerifiedAt !== baseNowIso ||
  restartedLeadBefore?.lastVerifiedAt !== baseNowIso ||
  restartedLeadBefore?.verificationCount !== 1
) {
  failures.push(`restarted:leads-db:before-second-otp mismatch -> ${JSON.stringify(restartedLeadBefore)}`);
}
const restartedLeadAfter = cases["restarted:leads-db:after-second-otp"]?.lead;
if (
  restartedLeadAfter?.email !== "verified.lead@example.com" ||
  restartedLeadAfter?.firstVerifiedAt !== baseNowIso ||
  restartedLeadAfter?.lastVerifiedAt !== secondOtpNowIso ||
  restartedLeadAfter?.verificationCount !== 2
) {
  failures.push(`restarted:leads-db:after-second-otp mismatch -> ${JSON.stringify(restartedLeadAfter)}`);
}

if (cases["live:registry:otp-start:without-optin-refused"]?.status !== 400) {
  failures.push(`OTP start without opt-in must return 400 -> ${JSON.stringify(cases["live:registry:otp-start:without-optin-refused"])}`);
}
if (cases["live:registry:otp-verify:with-optin"]?.status !== 200) {
  failures.push(`OTP verify with opt-in must return 200 -> ${JSON.stringify(cases["live:registry:otp-verify:with-optin"])}`);
}
if (!refused(cases["live:registry:profile-write:cross-origin"], "ORIGIN_DENIED")) {
  failures.push(`cross-origin profile write must be refused with ORIGIN_DENIED -> ${JSON.stringify(cases["live:registry:profile-write:cross-origin"])}`);
}
if (cases["live:registry:sign-out:otp-session"]?.status !== 200 || cases["live:registry:sign-out:otp-session"]?.signedOut !== true) {
  failures.push(`sign-out must return 200 signedOut=true -> ${JSON.stringify(cases["live:registry:sign-out:otp-session"])}`);
}
if (!refused(cases["live:registry:orders:after-sign-out"], "SESSION_DENIED")) {
  failures.push(`orders after sign-out must be refused with SESSION_DENIED -> ${JSON.stringify(cases["live:registry:orders:after-sign-out"])}`);
}
if (cases["missing-origin:demo-session"]?.status !== 503) {
  failures.push(`missing account origin: the instant demo account must fail closed with 503 -> ${cases["missing-origin:demo-session"]?.status}`);
}

console.log(`trace: ${trace.length} cases`);
console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0) {
  throw new Error(`real HTTP shopper-account authority proof failed:\n${failures.join("\n")}`);
}
console.log("PASS_PLAYGROUND_HTTP_SHOPPER_ACCOUNT");
process.exit(0);
