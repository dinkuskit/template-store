/**
 * Paid-return authorization through the production wiring: the store
 * middleware (which owns the persistent visitor-binding store) in front of the
 * real `/api/checkout/status` route, backed by a real EmDash-migrated SQLite
 * database read through EmDash's PluginStorageRepository. Nothing injects
 * `__playgroundCheckoutBindings`: the binding written by checkout start must be
 * the one the status route authorizes against.
 */
import { runMigrations } from "emdash/db";
import { createDialect } from "emdash/db/sqlite";
import { Kysely } from "kysely";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("astro:middleware", () => ({ defineMiddleware: (handler: unknown) => handler }));
vi.mock("../../src/features/playground/demo-commerce-seed.js", () => ({ ensurePlaygroundDemoCatalog: vi.fn(async () => ({ created: [] })) }));

const { onRequest } = await import("../../src/middleware.js");
const { POST } = await import("../../src/pages/api/checkout/status.js");
const { playgroundPaymentsFetch } = await import("../../src/features/playground-checkout/payments-port.js");

const site = "https://playground.example.test";
const READY = {
  DINKUS_CHECKOUT_ENABLED: "1",
  PAYMENTS_URL: "https://payments.local.test",
  PAYMENTS_STORE_KEY: `dk_store_${"k".repeat(43)}`,
  PAYMENTS_STRIPE_ACCOUNT_ID: "acct_TEST1",
  EMDASH_SITE_URL: site,
};
const projection = { schema: "dinkuskit.commerce.guest-checkout-projection/v1", state: "pending",
  attemptId: null, redirectUrl: null, order: null, retryAfter: null };
const paidFor = (attemptId: string) => ({ ...projection, state: "paid", attemptId,
  order: { orderId: "order-1", receiptId: "receipt-1", lines: [{ catalogItemId: "fixture", quantity: 1 }] } });

type Handler = (context: unknown, next: unknown) => Promise<Response>;
let db: Kysely<never>;
let dispatch: ReturnType<typeof vi.fn>;
let runtime: { handlePublicPluginApiRoute: ReturnType<typeof vi.fn>; getPluginRouteMeta: ReturnType<typeof vi.fn> };
let paymentsCalls: string[];

function freshDb() {
  return new Kysely<never>({ dialect: createDialect({ url: ":memory:" }) });
}

function cookieContext(request: Request, locals: Record<string, unknown>) {
  const header = request.headers.get("cookie") ?? "";
  return {
    url: new URL(request.url), request, locals,
    cookies: { get: (name: string) => {
      const value = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
      return value === undefined ? undefined : { value };
    } },
  };
}

/** A fresh request with a fresh `locals`, exactly like a new Worker request. */
async function viaMiddleware(path: string, visitor: string, body: unknown, next: (locals: Record<string, unknown>, request: Request) => Promise<Response>) {
  const payload = JSON.stringify(body);
  const request = new Request(site + path, { method: "POST", body: payload, headers: {
    "content-type": "application/json", "content-length": String(payload.length), origin: site,
    cookie: `emdash_playground=${visitor}`, "cf-connecting-ip": "203.0.113.7",
    "x-commerce-guest-capability": "cap.synthetic",
  } });
  const locals: Record<string, unknown> = { emdash: runtime, __playgroundDb: db,
    __playgroundCheckoutLimiter: { limit: async () => ({ success: true }) } };
  return (onRequest as unknown as Handler)(cookieContext(request, locals), () => next(locals, request));
}

/**
 * Commerce's Registry start, served by EmDash behind the middleware: Commerce's
 * own Payments call passes the playground guard, which binds the attempt to this visitor.
 */
async function startCheckout(visitor: string, attemptId: string) {
  const scoped = playgroundPaymentsFetch(process.env, { fetchImpl: (async (url: string, init: RequestInit) => {
    paymentsCalls.push(new URL(url).pathname);
    const sent = JSON.parse(String(init.body)) as { attemptId: string };
    return Response.json({ outcome: "open", attemptId: sent.attemptId,
      session: { expiresAt: Math.floor(Date.now() / 1000) + 1800 } });
  }) as never });
  const response = await viaMiddleware("/_emdash/api/plugins/r_gshdrqaldna3r7sn/checkout/guest/start", visitor,
    { lines: [{ catalogItemId: "fixture", quantity: 1 }] }, async () => {
      await scoped("https://payments.local.test/v1/checkout/session", { method: "POST", body: JSON.stringify({ attemptId }) });
      return Response.json({ success: true, data: { ok: true, capabilityId: "cap", checkout: { ...projection, state: "open", attemptId } } });
    });
  expect(response.status).toBe(200);
  expect(dispatch).not.toHaveBeenCalled();
}

/** The browser's paid return: /api/checkout/status served by the real route behind the middleware. */
function paidReturn(visitor: string, body: unknown = {}) {
  return viaMiddleware("/api/checkout/status", visitor, body,
    async (locals, request) => POST({ request, locals } as never));
}

beforeEach(async () => {
  for (const [key, value] of Object.entries(READY)) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("HTTP is forbidden"); }));
  db = freshDb();
  await runMigrations(db as never);
  paymentsCalls = [];
  dispatch = vi.fn().mockResolvedValue({ success: true, data: { ok: true, capabilityId: "cap", checkout: paidFor("attempt-paid") } });
  runtime = { handlePublicPluginApiRoute: dispatch, getPluginRouteMeta: vi.fn(() => ({ public: true, methods: ["POST"] })) };
});
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await db.destroy(); });

describe("playground paid return reaches order confirmation", () => {
  it("confirms the paid order for the visitor whose checkout start wrote the binding", async () => {
    await startCheckout("visitor-a", "attempt-paid");
    expect(paymentsCalls).toEqual(["/v1/checkout/session"]);

    const capabilityOnly = await paidReturn("visitor-a");
    expect(capabilityOnly.status).toBe(200);
    const body = await capabilityOnly.json() as { ok: boolean; checkout: { state: string; order: { orderId: string } | null } };
    expect(body.ok).toBe(true);
    expect(body.checkout.state).toBe("paid");
    expect(body.checkout.order?.orderId).toBe("order-1");

    const withAttempt = await paidReturn("visitor-a", { attemptId: "attempt-paid" });
    expect(withAttempt.status).toBe(200);
  });

  it("still confirms after the isolate restarts (binding read back from SQLite, not memory)", async () => {
    await startCheckout("visitor-a", "attempt-paid");
    vi.resetModules();
    const restarted = await import("../../src/middleware.js");
    const restartedRoute = await import("../../src/pages/api/checkout/status.js");
    const payload = "{}";
    const request = new Request(site + "/api/checkout/status", { method: "POST", body: payload, headers: {
      "content-type": "application/json", origin: site, cookie: "emdash_playground=visitor-a",
      "cf-connecting-ip": "203.0.113.7", "x-commerce-guest-capability": "cap.synthetic" } });
    const locals: Record<string, unknown> = { emdash: runtime, __playgroundDb: db };
    const response = await (restarted.onRequest as unknown as Handler)(cookieContext(request, locals),
      () => restartedRoute.POST({ request, locals } as never));
    expect(response.status).toBe(200);
    expect((await response.json() as { checkout: { state: string } }).checkout.state).toBe("paid");
  });

  it("refuses a foreign or unbound visitor, before Payments or order disclosure", async () => {
    await startCheckout("visitor-a", "attempt-paid");
    paymentsCalls.length = 0;
    const foreignAttempt = await paidReturn("visitor-b", { attemptId: "attempt-paid" });
    expect(foreignAttempt.status).toBe(403);
    expect(dispatch).not.toHaveBeenCalled();
    const foreignTerminal = await paidReturn("visitor-b");
    expect(foreignTerminal.status).toBe(403);
    expect(JSON.stringify(await foreignTerminal.json())).not.toContain("order-1");
    const unbound = await paidReturn("visitor-a", { attemptId: "never-started" });
    expect(unbound.status).toBe(403);
    expect(paymentsCalls).toEqual([]);
  });

  it("refuses the bound visitor once the binding has expired", async () => {
    await startCheckout("visitor-a", "attempt-paid");
    vi.stubEnv("DINKUS_LOCAL_PROOF", "1");
    vi.stubEnv("DINKUS_LOCAL_PROOF_NOW", String(Date.now() + 2_000_000));
    const expired = await paidReturn("visitor-a");
    expect(expired.status).toBe(403);
    expect(JSON.stringify(await expired.json())).not.toContain("order-1");
  });

  it("fails closed when the status route runs without the middleware's binding store", async () => {
    await startCheckout("visitor-a", "attempt-paid");
    const request = new Request(site + "/api/checkout/status", { method: "POST", body: "{}", headers: {
      origin: site, cookie: "emdash_playground=visitor-a", "x-commerce-guest-capability": "cap.synthetic" } });
    const response = await POST({ request, locals: { emdash: runtime, __playgroundDb: db } } as never);
    expect(response.status).toBe(403);
  });
});
