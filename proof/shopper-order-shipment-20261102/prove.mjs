// Proof for template-store#205 through the playground Worker, which runs Commerce's pinned Registry build
// (v0.8.0, r_gshdrqaldna3r7sn) in the visitor's store. No route interception.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, devices } from "@playwright/test";
import { PLAYGROUND_PROOF_SITE as origin, startPlaygroundVisitor, startPlaygroundWorker } from "../../scripts/lib/playground-worker-proof.mjs";

const out = resolve(import.meta.dirname, "../../.artifacts/proof-205");
mkdirSync(out, { recursive: true });
const ip = "203.0.113.77";
const trace = [];
const log = (step, data) => { trace.push({ step, ...data }); console.log(step, JSON.stringify(data)); };
const live = await startPlaygroundWorker({ name: "proof205", port: 4399, persistTo: join(out, "state"), vars: {
  DINKUS_LOCAL_PROOF: "1", DINKUS_PROOF_MODE: "1", DINKUS_LOCAL_PROOF_SITE_URL: origin,
  DINKUS_PLAYGROUND_ACCOUNT_ORIGIN: origin, DINKUS_LOCAL_PROOF_NOW: String(Date.now()) } });
const base = live.base;
const P = "/_emdash/api/plugins/r_gshdrqaldna3r7sn/";
try {
  const { cookie } = await startPlaygroundVisitor(base, ip, live.output);
  const call = async (path, body, extra = {}) => {
    const r = await fetch(base + path, { method: body === undefined ? "GET" : "POST",
      headers: { origin, cookie, "cf-connecting-ip": ip, "x-emdash-request": "1", ...(body !== undefined ? { "content-type": "application/json" } : {}), ...extra },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const json = await r.json().catch(() => null);
    return { status: r.status, data: json?.data ?? json };
  };
  let list;
  for (let i = 0; i < 30; i++) {
    list = await call(P + "orders", { action: "list" });
    if (list.data?.orders?.length) break;
    await fetch(base + "/", { headers: { cookie, "cf-connecting-ip": ip } });
    await new Promise(r => setTimeout(r, 1000));
  }
  log("admin orders list", { status: list.status, orders: (list.data?.orders ?? []).map(o => ({ orderId: o.orderId, number: o.number, email: o.email ?? o.contact?.email, status: o.status, version: o.version })) });
  const order = list.data.orders.find(o => JSON.stringify(o).includes("jordan.rivers@example.com") && o.status !== "completed") ?? list.data.orders.find(o => o.status !== "completed");
  const email = JSON.stringify(order).match(/[a-z.]+@example\.com/)[0];
  const show = await call(P + "orders", { action: "show", orderId: order.orderId });
  log("admin order show", { status: show.status, orderId: order.orderId, email, statusText: show.data?.order?.status ?? show.data?.status, version: show.data?.order?.version ?? show.data?.version });
  let version = show.data?.order?.version ?? show.data?.version ?? order.version;

  const start = await call(P + "account/sign-in/start", { email, optInUpdates: true });
  log("shopper sign-in start", { status: start.status, ok: start.data?.ok });
  const proofMail = await call(`/api/proof/shopper-account?email=${encodeURIComponent(email)}`);
  const code = proofMail.data?.email?.code;
  const verified = await call(P + "account/sign-in/verify", { email, code, optInUpdates: true });
  log("shopper sign-in verify", { status: verified.status, ok: verified.data?.ok });
  const cap = verified.data.capability;
  const session = { sessionId: cap.sessionId, sessionToken: cap.session, email, expiresAt: Math.floor(Date.parse(cap.expiresAt) / 1000) };

  const completed = await call(P + "orders", { action: "complete", orderId: order.orderId, version, carrier: "USPS", tracking: "9400111899223344556677" });
  log("admin complete with carrier and tracking", { status: completed.status, result: completed.data?.result, error: completed.data?.error?.code });
  const ordersRead = await call(P + "account/orders", undefined, { "x-commerce-customer-session": session.sessionToken });
  const mine = ordersRead.data?.orders?.find(o => o.orderId === order.orderId);
  log("shopper account/orders after complete", { status: ordersRead.status, ok: ordersRead.data?.ok, orderStatus: mine?.status, completed: mine?.completed ? { carrier: mine.completed.carrier, tracking: mine.completed.tracking, at: Boolean(mine.completed.at) } : null });

  const browser = await chromium.launch();
  const [name, value] = cookie.split("=");
  const shots = {};
  const views = { desktop: { viewport: { width: 1440, height: 1000 } }, mobile: { ...devices["iPhone 13"] } };
  for (const [label, opts] of Object.entries(views)) {
    const ctx = await browser.newContext({ ...opts, extraHTTPHeaders: { "cf-connecting-ip": ip } });
    await ctx.addCookies([{ name, value, url: base }]);
    await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), ["dinkus.shopper-session.v1", JSON.stringify(session)]);
    const page = await ctx.newPage();
    await page.goto(base + "/account");
    const card = page.locator(`[data-account-order="${order.orderId}"]`);
    await card.locator("[data-account-order-tracking]").waitFor({ timeout: 60000 });
    const status = await card.locator("[data-account-order-status]").textContent();
    const carrier = await card.locator("[data-account-order-carrier]").textContent();
    const tracking = await card.locator("[data-account-order-tracking]").textContent();
    const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    await page.evaluate(() => { for (const el of document.querySelectorAll("body *")) { const p = getComputedStyle(el).position; if (p === "fixed" || p === "sticky") el.style.display = "none"; } });
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: join(out, `${label}-completed.png`) });
    log(`browser ${label} /account after complete`, { status: status?.trim(), carrier: carrier?.trim(), tracking: tracking?.trim(), noHorizontalScroll: fits });
    shots[label] = { ctx, page, card };
  }
  const reshow = await call(P + "orders", { action: "show", orderId: order.orderId });
  version = reshow.data?.order?.version ?? reshow.data?.version;
  const reopened = await call(P + "orders", { action: "reopen", orderId: order.orderId, version });
  log("admin reopen", { status: reopened.status, result: reopened.data?.result, error: reopened.data?.error?.code });
  for (const [label, { ctx, page, card }] of Object.entries(shots)) {
    await page.reload();
    await card.locator("[data-account-order-status]").waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    const status = await card.locator("[data-account-order-status]").textContent();
    const shipment = await card.locator("[data-account-order-shipment]").count();
    await page.evaluate(() => { for (const el of document.querySelectorAll("body *")) { const p = getComputedStyle(el).position; if (p === "fixed" || p === "sticky") el.style.display = "none"; } });
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: join(out, `${label}-reopened.png`) });
    log(`browser ${label} /account after reopen`, { status: status?.trim(), shipmentElements: shipment });
    await ctx.close();
  }
  await browser.close();
} finally {
  writeFileSync(join(out, "trace.json"), JSON.stringify(trace, null, 2));
  await live.stop();
}
