import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const artifact = resolve(root, ".artifacts/playground-account-http-proof");
rmSync(artifact, { recursive: true, force: true });
mkdirSync(artifact, { recursive: true });

const appPort = 4398;
const origin = `http://127.0.0.1:${appPort}`;
const trace = [];
const cases = {};

const wranglerProofConfig = join(artifact, "wrangler.playground.account-proof.jsonc");
const wranglerConfig = JSON.parse(readFileSync(join(root, "wrangler.playground.jsonc"), "utf8"));
wranglerConfig.main = "../../src/playground-worker.ts";
wranglerConfig.assets.directory = "../../dist/client";
wranglerConfig.vars = {
  ...wranglerConfig.vars,
  DINKUS_LOCAL_PROOF: "1",
  DINKUS_PROOF_MODE: "1",
  DINKUS_LOCAL_PROOF_SITE_URL: origin,
  DINKUS_PLAYGROUND_ACCOUNT_ORIGIN: origin,
};
wranglerConfig.previews = {
  ...wranglerConfig.previews,
  vars: { ...wranglerConfig.vars },
};
writeFileSync(wranglerProofConfig, JSON.stringify(wranglerConfig, null, 2));

const futureNowMs = Date.now() + 31 * 24 * 60 * 60 * 1000;
const expiredProofConfig = join(artifact, "wrangler.playground.account-expired.jsonc");
writeFileSync(
  expiredProofConfig,
  JSON.stringify(
    {
      ...wranglerConfig,
      vars: { ...wranglerConfig.vars, DINKUS_LOCAL_PROOF_NOW: String(futureNowMs) },
      previews: {
        ...wranglerConfig.previews,
        vars: { ...wranglerConfig.vars, DINKUS_LOCAL_PROOF_NOW: String(futureNowMs) },
      },
    },
    null,
    2,
  ),
);

const {
  DINKUS_PLAYGROUND_ACCOUNT_ORIGIN: _omittedAccountOrigin,
  DINKUS_LOCAL_PROOF_SITE_URL: _omittedProofOrigin,
  ...missingOriginVars
} = wranglerConfig.vars;
const missingOriginConfig = join(artifact, "wrangler.playground.account-missing-origin.jsonc");
writeFileSync(
  missingOriginConfig,
  JSON.stringify(
    {
      ...wranglerConfig,
      vars: missingOriginVars,
      previews: { ...wranglerConfig.previews, vars: missingOriginVars },
    },
    null,
    2,
  ),
);

const serverEnv = {
  ...process.env,
  ASTRO_DEV_BACKGROUND: "0",
  DINKUS_LOCAL_PROOF: "1",
  DINKUS_PROOF_MODE: "1",
  DINKUS_LOCAL_PROOF_SITE_URL: origin,
  DINKUS_PLAYGROUND_ACCOUNT_ORIGIN: origin,
  DINKUS_TEMPLATE_DB_URL: `file:${join(artifact, "visitor.db")}`,
  DINKUS_TEMPLATE_UPLOADS_DIR: join(artifact, "uploads"),
  DINKUS_PLAYGROUND_WRANGLER_CONFIG: wranglerProofConfig,
};

const activeChildren = new Set();
process.on("exit", () => {
  for (const child of activeChildren) {
    try {
      child.kill("SIGTERM");
    } catch {}
  }
});

function startServer(env) {
  const output = [];
  const child = spawn(
    "pnpm",
    [
      "exec",
      "astro",
      "dev",
      "--config",
      "astro.playground.config.mjs",
      "--host",
      "127.0.0.1",
      "--port",
      String(appPort),
      "--force",
    ],
    {
      cwd: root,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    },
  );
  activeChildren.add(child);
  child.once("exit", () => activeChildren.delete(child));
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  return { child, output };
}

async function stopServer(child) {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2000)),
  ]);
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {}
  child.stdout?.destroy();
  child.stderr?.destroy();
}

async function initSession(ip, output) {
  const loading = await fetch(`${origin}/playground`, {
    headers: { origin, "cf-connecting-ip": ip },
  });
  const sessionCookie = loading.headers.get("set-cookie")?.split(";")[0];
  if (!sessionCookie) {
    throw new Error(`playground loading page did not issue a session cookie (${loading.status})\n${output.join("")}`);
  }
  const initResponse = await fetch(`${origin}/_playground/init`, {
    method: "POST",
    headers: {
      origin,
      cookie: sessionCookie,
      "cf-connecting-ip": ip,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });
  if (!initResponse.ok) {
    throw new Error(`playground init failed (${initResponse.status}): ${(await initResponse.text()).slice(0, 300)}`);
  }
  return sessionCookie;
}

async function warmSession(cookie, ip = "203.0.113.41") {
  const response = await fetch(`${origin}/playground`, {
    headers: { origin, cookie, "cf-connecting-ip": ip },
  });
  if (!response.ok) {
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
  const response = await fetch(`${origin}${path}`, {
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
const NATIVE_PREFIX = "/_emdash/api/plugins/dinkus-commerce/account";

const live = startServer(serverEnv);
await waitForHttp(`${origin}/`, live.output);
await waitForReady(live.output);

const cookieA = await initSession("203.0.113.41", live.output);
const cookieB = await initSession("203.0.113.42", live.output);
const cookieReset = await initSession("203.0.113.43", live.output);

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
  body: { email: "verified.lead@example.com", optInUpdates: false },
});
await callAccount({
  label: "live:registry:otp-start:with-optin",
  method: "POST",
  path: `${REGISTRY_PREFIX}/sign-in/start`,
  cookie: cookieA,
  body: { email: "verified.lead@example.com", optInUpdates: true },
});
const proofEmailRes = await fetch(
  `${origin}/api/proof/shopper-account?email=${encodeURIComponent("verified.lead@example.com")}`,
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
  body: { email: "verified.lead@example.com", code: otpCode, optInUpdates: true },
});
const otpTokenA = verifiedOtp.raw?.capability?.session;
if (typeof otpTokenA !== "string") {
  throw new Error(`otp verify did not issue a shopper session token: ${JSON.stringify(verifiedOtp.raw)}`);
}

// 4. Run authority matrix across both Registry and Native entrypoints while live
async function runAuthorityMatrix(phase) {
  for (const [surface, prefix] of [
    ["registry", REGISTRY_PREFIX],
    ["native", NATIVE_PREFIX],
  ]) {
    await callAccount({
      label: `${phase}:${surface}:orders:authorized`,
      method: "GET",
      path: `${prefix}/orders`,
      cookie: cookieA,
      sessionToken: tokenA,
    });
    await callAccount({
      label: `${phase}:${surface}:profile:authorized`,
      method: "GET",
      path: `${prefix}/profile`,
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
      label: `${phase}:${surface}:profile-read:foreign-visitor`,
      method: "GET",
      path: `${prefix}/profile`,
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

await stopServer(live.child);

// 5. Restart server over the same existing database and verify existing-state persistence + foreign refusal
const restarted = startServer(serverEnv);
await waitForHttp(`${origin}/`, restarted.output);
await waitForReady(restarted.output);
await warmSession(cookieA, "203.0.113.41");
await warmSession(cookieB, "203.0.113.42");
await warmSession(cookieReset, "203.0.113.43");
await runAuthorityMatrix("restarted");
await stopServer(restarted.child);

// 6. Advance clock past session TTL and verify expired session refusal
const expiredEnv = {
  ...serverEnv,
  DINKUS_LOCAL_PROOF_NOW: String(futureNowMs),
  DINKUS_PLAYGROUND_WRANGLER_CONFIG: expiredProofConfig,
};
const expired = startServer(expiredEnv);
await waitForHttp(`${origin}/`, expired.output);
await waitForReady(expired.output);
await warmSession(cookieA, "203.0.113.41");
for (const [surface, prefix] of [
  ["registry", REGISTRY_PREFIX],
  ["native", NATIVE_PREFIX],
]) {
  await callAccount({
    label: `expired:${surface}:orders:authorized`,
    method: "GET",
    path: `${prefix}/orders`,
    cookie: cookieA,
    sessionToken: tokenA,
  });
  await callAccount({
    label: `expired:${surface}:profile:authorized`,
    method: "GET",
    path: `${prefix}/profile`,
    cookie: cookieA,
    sessionToken: tokenA,
  });
}
await stopServer(expired.child);

// 7. Missing trusted account origin fails closed (503)
const {
  DINKUS_PLAYGROUND_ACCOUNT_ORIGIN: _dropAccountOrigin,
  DINKUS_LOCAL_PROOF_SITE_URL: _dropProofSiteUrl,
  ...missingOriginProcessEnv
} = serverEnv;
const missingOriginEnv = {
  ...missingOriginProcessEnv,
  DINKUS_PLAYGROUND_WRANGLER_CONFIG: missingOriginConfig,
};
const missingOrigin = startServer(missingOriginEnv);
await waitForHttp(`${origin}/`, missingOrigin.output);
await waitForReady(missingOrigin.output);
await warmSession(cookieA, "203.0.113.41");
await callAccount({
  label: "missing-origin:demo-session",
  method: "POST",
  path: "/api/account/demo-session",
  cookie: cookieA,
  body: {},
});
await callAccount({
  label: "missing-origin:registry:orders",
  method: "GET",
  path: `${REGISTRY_PREFIX}/orders`,
  cookie: cookieA,
  sessionToken: tokenA,
});
await stopServer(missingOrigin.child);

const summary = Object.fromEntries(
  Object.entries(cases).map(([key, entry]) => [
    key,
    {
      status: entry.status,
      errorCode: entry.errorCode,
      orderIds: entry.orderIds,
      profileLine1: entry.profileLine1,
      signedOut: entry.signedOut,
    },
  ]),
);
writeFileSync(join(artifact, "trace.jsonl"), trace.map((item) => JSON.stringify(item)).join("\n") + "\n");
writeFileSync(join(artifact, "status-matrix.json"), JSON.stringify(summary, null, 2) + "\n");

const failures = [];
for (const phase of ["live", "restarted"]) {
  for (const surface of ["registry", "native"]) {
    const ordersEntry = cases[`${phase}:${surface}:orders:authorized`];
    if (ordersEntry?.status !== 200 || !ordersEntry.orderIds?.includes("ord_demo_shopper_1001")) {
      failures.push(`${phase}:${surface}:orders:authorized failed -> ${JSON.stringify(ordersEntry)}`);
    }
    const profileEntry = cases[`${phase}:${surface}:profile:authorized`];
    if (profileEntry?.status !== 200 || profileEntry.profileLine1 !== "900 Durable Ave") {
      failures.push(`${phase}:${surface}:profile:authorized failed -> ${JSON.stringify(profileEntry)}`);
    }
    for (const adverse of [
      `${phase}:${surface}:orders:foreign-visitor`,
      `${phase}:${surface}:profile-read:foreign-visitor`,
      `${phase}:${surface}:profile-write:foreign-visitor`,
      `${phase}:${surface}:orders:reset-visitor`,
    ]) {
      const entry = cases[adverse];
      if (entry?.status !== 401 || entry.errorCode !== "SESSION_DENIED" || entry.orderIds || entry.profileLine1) {
        failures.push(`${adverse} was not refused with 401 SESSION_DENIED -> ${JSON.stringify(entry)}`);
      }
    }
  }
}

if (cases["live:registry:otp-start:without-optin-refused"]?.status !== 400) {
  failures.push(`OTP start without opt-in must return 400 -> ${JSON.stringify(cases["live:registry:otp-start:without-optin-refused"])}`);
}
if (cases["live:registry:otp-verify:with-optin"]?.status !== 200) {
  failures.push(`OTP verify with opt-in must return 200 -> ${JSON.stringify(cases["live:registry:otp-verify:with-optin"])}`);
}
if (cases["live:registry:profile-write:cross-origin"]?.status !== 403) {
  failures.push(`cross-origin profile write must return 403 -> ${JSON.stringify(cases["live:registry:profile-write:cross-origin"])}`);
}
if (cases["live:registry:sign-out:otp-session"]?.status !== 200 || cases["live:registry:sign-out:otp-session"]?.signedOut !== true) {
  failures.push(`sign-out must return 200 signedOut=true -> ${JSON.stringify(cases["live:registry:sign-out:otp-session"])}`);
}
if (cases["live:registry:orders:after-sign-out"]?.status !== 401) {
  failures.push(`orders after sign-out must return 401 -> ${JSON.stringify(cases["live:registry:orders:after-sign-out"])}`);
}
for (const surface of ["registry", "native"]) {
  for (const kind of ["orders", "profile"]) {
    const entry = cases[`expired:${surface}:${kind}:authorized`];
    if (entry?.status !== 401 || entry.errorCode !== "SESSION_DENIED") {
      failures.push(`expired:${surface}:${kind}:authorized must return 401 SESSION_DENIED -> ${JSON.stringify(entry)}`);
    }
  }
}
if (cases["missing-origin:demo-session"]?.status !== 503 || cases["missing-origin:registry:orders"]?.status !== 503) {
  failures.push(`missing origin must fail closed with 503 -> demo=${cases["missing-origin:demo-session"]?.status} orders=${cases["missing-origin:registry:orders"]?.status}`);
}

console.log(`trace: ${trace.length} cases`);
console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0) {
  throw new Error(`real HTTP shopper-account authority proof failed:\n${failures.join("\n")}`);
}
console.log("PASS_PLAYGROUND_HTTP_SHOPPER_ACCOUNT");
process.exit(0);

async function waitForHttp(url, output) {
  for (let i = 0; i < 120; i++) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`local Astro server did not start\n${output.join("")}`);
}

async function waitForReady(log) {
  for (let i = 0; i < 120; i++) {
    if (log.some((line) => line.includes("watching for file changes") || line.includes("Ready on http"))) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`local Astro server did not become ready\n${log.join("")}`);
}
