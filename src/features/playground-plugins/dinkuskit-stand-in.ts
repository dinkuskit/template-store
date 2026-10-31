/**
 * The playground's pretend DinkusKit.com (GrillTrack playground-pretend-connected-20261022).
 *
 * Payments and Ship run their released builds inside the playground store and
 * make the same calls they make on a real store. This answers the ones meant
 * for DinkusKit.com, Payments and Ship inside the playground Worker, so Connect
 * finishes, Payments shows Stripe test mode ready and Ship makes practice
 * labels, and none of it reaches dinkuskit.com. Each answer is signed with a
 * key only this playground uses; anything not made here goes out unchanged,
 * which keeps the playground's own test checkout on the real Payments service.
 */
import { OptionsRepository, PluginStorageRepository } from "emdash";
import { getRequestContext } from "emdash/request-context";
import { CHECKOUT_PRICING_SCHEMA } from "@dinkuskit/commerce/features/checkout";
import { getStorePass, playgroundCheckoutConfigured, readPaymentsConfig, readStripeAccount } from "../playground-checkout/index.js";
import { PAYMENTS_PLAYGROUND_BINDING_REF, playgroundPaymentsFetch } from "../playground-checkout/payments-port.js";
import { PLAYGROUND_FLAT_RATE_SHIPPING } from "../playground/flat-rate-shipping.js";
import { PLAYGROUND_INSTALLED_PLUGIN_IDS } from "./registry-plugins.mjs";

export const STAND_IN_KID = "dinkuskit-playground-stand-in";
export const PLAYGROUND_SITE_ID = "playground";
const ISSUER = "https://dinkuskit.com/account";
const CONNECT_URL = "https://dinkuskit.com/api/store-connections";
const STORE_PASSES_URL = "https://dinkuskit.com/api/store-passes";
const COMMERCE_SETTINGS_PATH = "/api/commerce-settings";
const JWKS_URL = "https://dinkuskit.com/account/.well-known/jwks.json";
const PAYMENTS_ORIGIN = "https://payments.dinkuskit.com";
const SHIP_ORIGIN = "https://ship.dinkuskit.com";
const PASS_SECONDS = 300;
const CONNECT_MS = 5 * 60_000;
/** Pretend connections and passes all name one owner. */
const OWNER = "playground-owner";

/** What each plugin's Connect is for, and the passes its key may get. */
const SERVICES = {
  "dinkus-payments-emdash": { service: "payments", passes: [["payments:checkout", "dinkus-payments"]] },
  "dinkus-ship-emdash": { service: "ship", passes: [["ship:admin", "dinkus-ship"]] },
  "dinkus-commerce-emdash": { service: "commerce", passes: [["commerce:settings", "dinkuskit"], ["payments:checkout", "dinkus-payments"]] },
} as const satisfies Record<string, { service: string; passes: readonly (readonly [string, string])[] }>;
type ClientId = keyof typeof SERVICES;

const encoder = new TextEncoder();
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const random = (size: number) => base64url(crypto.getRandomValues(new Uint8Array(size)));
const sha256 = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));

/** The store key Connect hands a plugin: a fixed pretend key per plugin, never a real DinkusKit.com key. */
export async function standInStoreKey(clientId: ClientId): Promise<string> {
  return `dk_store_${base64url(await sha256(`dinkuskit-playground-stand-in:key:${clientId}`))}`;
}

// ---------------------------------------------------------------------------
// Signing. Every Worker isolate derives the same P-256 key from a fixed public
// seed, so a token one isolate signs is accepted by every other. Only this
// playground's own plugins are ever told to trust it.

let signingKey: Promise<{ privateKey: CryptoKey; jwk: JsonWebKey }> | undefined;

function key() {
  signingKey ??= (async () => {
    const d = await sha256("dinkuskit-playground-stand-in:signing-key");
    // PKCS #8 for a P-256 private key without its public half; the runtime derives it.
    const prefix = [0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08,
      0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01, 0x01, 0x04, 0x20];
    const pkcs8 = new Uint8Array([...prefix, ...d]);
    const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", privateKey) as JsonWebKey;
    return { privateKey, jwk: { kty, crv, x, y, kid: STAND_IN_KID, alg: "ES256", use: "sig" } as JsonWebKey };
  })();
  return signingKey;
}

async function sign(claims: Record<string, unknown>): Promise<string> {
  const { privateKey } = await key();
  const head = base64url(encoder.encode(JSON.stringify({ alg: "ES256", typ: "JWT", kid: STAND_IN_KID })));
  const body = base64url(encoder.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, encoder.encode(`${head}.${body}`));
  return `${head}.${body}.${base64url(new Uint8Array(signature))}`;
}

function token(audience: string, scope: string) {
  const now = Math.floor(Date.now() / 1000);
  return sign({ iss: ISSUER, aud: audience, sub: OWNER, site_id: PLAYGROUND_SITE_ID, scope, iat: now, exp: now + PASS_SECONDS });
}

/** True for a bearer token this stand-in signed; a real DinkusKit.com pass is never one. */
function signedHere(authorization: string | null): boolean {
  const parts = authorization?.startsWith("Bearer ") ? authorization.slice(7).split(".") : [];
  if (parts.length !== 3) return false;
  try {
    const head = JSON.parse(atob(parts[0]!.replaceAll("-", "+").replaceAll("_", "/"))) as { kid?: unknown };
    return head.kid === STAND_IN_KID;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// DinkusKit.com: Connect, the store keys' passes, and the key that signs them.

async function readJson(init: RequestInit | undefined): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse(typeof init?.body === "string" ? init.body : new TextDecoder().decode(init?.body as ArrayBuffer));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function connect(init: RequestInit | undefined): Promise<Response> {
  const body = await readJson(init);
  const client = SERVICES[body.client_id as ClientId];
  if (!client || body.service !== client.service || body.protocol_version !== 2) return json({ error: "invalid_request" }, 400);
  const connectionId = random(18);
  return json({
    protocol_version: 2,
    site_id: PLAYGROUND_SITE_ID,
    connection_id: connectionId,
    challenge: random(32),
    expires_at: Date.now() + CONNECT_MS,
    interval: 1,
    verification_uri: `https://dinkuskit.com/account/connect?connection_id=${encodeURIComponent(connectionId)}`,
  });
}

/** The business owner's Approve is pretend: the first check after Connect finds it approved. */
async function connectToken(init: RequestInit | undefined): Promise<Response> {
  const body = await readJson(init);
  const clientId = body.client_id as ClientId;
  if (!SERVICES[clientId] || typeof body.connection_id !== "string" || typeof body.code_verifier !== "string") {
    return json({ error: "invalid_request" }, 400);
  }
  await recordConnected(SERVICES[clientId].service);
  return json({
    access_token: await token(clientId === "dinkus-payments-emdash" ? "dinkus-payments" : "dinkuskit", `${SERVICES[clientId].service}:admin`),
    token_type: "Bearer",
    expires_in: PASS_SECONDS,
    site_id: PLAYGROUND_SITE_ID,
    store_key: await standInStoreKey(clientId),
  });
}

/** Seconds a real pass has left, from its own exp claim; 0 when unreadable. */
function passSecondsLeft(pass: string): number {
  try {
    const claims = JSON.parse(atob(pass.split(".")[1]!.replaceAll("-", "+").replaceAll("_", "/"))) as { exp?: unknown };
    return typeof claims.exp === "number" ? Math.max(0, Math.floor(claims.exp - Date.now() / 1000)) : 0;
  } catch {
    return 0;
  }
}

async function storePass(authorization: string | null, init: RequestInit | undefined, env: Record<string, unknown>): Promise<Response | null> {
  const presented = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  let clientId: ClientId | undefined;
  for (const candidate of Object.keys(SERVICES) as ClientId[]) {
    if (presented === await standInStoreKey(candidate)) clientId = candidate;
  }
  // A real store key (the playground's own checkout key) goes to the real DinkusKit.com.
  if (!clientId) return null;
  const body = await readJson(init);
  if (body.site_id !== PLAYGROUND_SITE_ID) return json({ error: "site_mismatch" }, 403);
  const allowed = SERVICES[clientId].passes.some(([scope, audience]) => scope === body.scope && audience === body.audience);
  if (!allowed) return json({ error: "service_not_enabled" }, 403);
  // Commerce's checkout pass goes to the real Payments service, which accepts only real passes: it is the
  // pass the playground's own checkout key gets from the real DinkusKit.com, as the playground's checkout
  // always used (site "playground", binding "playground", Stripe test mode). Checkout off: no pass.
  if (clientId === "dinkus-commerce-emdash" && body.scope === "payments:checkout") {
    const config = readPaymentsConfig(env);
    if (!playgroundCheckoutConfigured(env) || !config) return json({ error: "service_not_enabled" }, 403);
    const pass = await getStorePass(config);
    if (!pass) return json({ error: "temporarily_unavailable" }, 503);
    return json({ access_token: pass, token_type: "Bearer", expires_in: passSecondsLeft(pass) });
  }
  return json({ access_token: await token(body.audience as string, body.scope as string), token_type: "Bearer", expires_in: PASS_SECONDS });
}

// ---------------------------------------------------------------------------
// Set up Commerce at DinkusKit.com: the playground's checkout settings.

/**
 * What a real store's Set up Commerce at DinkusKit.com hands Commerce, for the playground: Stripe TEST checkout
 * through the real Payments service under binding "playground", with the playground's flat-rate shipping. With
 * checkout off (no flag, key, Payments origin, Stripe test account or trusted store origin: the same test the
 * middleware admits checkout by) it is the documented turned-off settings, so Commerce's checkout stays unavailable. The store origin is the one EmDash gives the plugins.
 */
function commerceSettings(env: Record<string, unknown>, origin: string): Response {
  const config = readPaymentsConfig(env), account = readStripeAccount(env);
  if (!playgroundCheckoutConfigured(env) || !config || !account) {
    return json({ schema: "dinkuskit.commerce.registry-checkout/v1", enabled: false });
  }
  return json({
    schema: "dinkuskit.commerce.registry-checkout/v1",
    enabled: true,
    commerceOrigin: origin,
    siteId: PLAYGROUND_SITE_ID,
    paymentsOrigin: config.baseUrl,
    bindingRef: PAYMENTS_PLAYGROUND_BINDING_REF,
    providerId: "stripe",
    stripeAccountId: account,
    mode: "test",
    pricingSchema: CHECKOUT_PRICING_SCHEMA,
    issuer: ISSUER,
    audience: "dinkus-payments",
    shipping: structuredClone(PLAYGROUND_FLAT_RATE_SHIPPING),
  });
}

/**
 * Commerce's own calls to the real Payments service (they carry a real pass) pass through the playground's
 * checkout guard: the playground tenant answers session and lookup only, Commerce's binding check is
 * answered with the fixed playground binding, and each attempt is bound to the visitor that started it.
 */
async function guardedPayments(realFetch: typeof fetch, env: Record<string, unknown>, href: string, init: RequestInit | undefined): Promise<Response> {
  // EmDash hands a plugin's request body over as bytes; the guard reads the attempt id from its text.
  const raw = init?.body;
  const body = raw instanceof ArrayBuffer || ArrayBuffer.isView(raw) ? new TextDecoder().decode(raw) : raw;
  try {
    return await playgroundPaymentsFetch(env, { fetchImpl: realFetch })(href, { ...init, body });
  } catch {
    return json({ error: { code: "UNAVAILABLE", message: "Playground checkout is unavailable." } }, 503);
  }
}

// ---------------------------------------------------------------------------
// Payments: a Stripe account in test mode, ready to take TEST orders.

function payments(path: string, method: string, env: Record<string, unknown>): Response {
  const ready = { state: "ready", mode: "test", bindingRef: PLAYGROUND_SITE_ID };
  if (method === "GET" && path === "/v1/status") {
    return json({ ...ready, connectionEvidence: { provider: "stripe", mode: "test", result: "verified", accountRef: readStripeAccount(env) ?? "acct_playground" } });
  }
  // Set up Stripe: the playground's Stripe test account is already set up.
  if (method === "POST" && path === "/v1/connect") return json(ready);
  // Check provider identity: the Stripe account is the playground's own test account.
  if (method === "GET" && path === "/v1/connect/provider-identity") {
    return json({ result: "match", validTestPrefix: true, httpStatus: 200, at: Date.now() });
  }
  return json({ error: "not_found" }, 404);
}

// ---------------------------------------------------------------------------
// Ship: the store's paid orders, with free practice labels.

/** Commerce's orders, under the id the playground installs it with. */
const COMMERCE = PLAYGROUND_INSTALLED_PLUGIN_IDS.commerce;
/** Where the stand-in keeps each playground store's practice labels. */
export const STAND_IN_STORAGE = { pluginId: "dinkuskit-playground", labels: "labels" } as const;
const STAND_IN = STAND_IN_STORAGE.pluginId;

/** The store option that says when a plugin's pretend Connect finished, so the tour can tick it off. */
export const standInConnectedOption = (service: string) => `plugin:${STAND_IN}:connected:${service}`;

async function recordConnected(service: string): Promise<void> {
  const db = getRequestContext()?.db as Db | undefined;
  if (!db) return;
  const options = new OptionsRepository(db as ConstructorParameters<typeof OptionsRepository>[0]);
  if ((await options.get(standInConnectedOption(service))) === null) await options.set(standInConnectedOption(service), new Date().toISOString());
}
const LABEL_WEIGHT_OZ = 8;
export const BOXES = [
  { boxId: "small", name: "Small box", lengthIn: 9, widthIn: 6, heightIn: 3, weightOz: 4 },
  { boxId: "medium", name: "Medium box", lengthIn: 12, widthIn: 10, heightIn: 6, weightOz: 8 },
];
// Practice labels only: TEST orders, and no Pitney Bowes account in the playground.
const SHIP_SETTINGS = { shipFrom: true, boxes: BOXES, postageConnected: false, testSandbox: false };

type Db = ConstructorParameters<typeof PluginStorageRepository>[0];
interface CommerceOrder {
  paidOrder: {
    orderId: string; mode?: string;
    lines: readonly { name: string; quantity: number }[];
    contactSnapshot?: { contact?: { delivery?: Address } };
  };
  number?: number; revision?: number; delivery?: Address;
  completed?: { at: string; carrier?: string; tracking?: string };
}
interface Address { name: string; line1: string; line2?: string; city: string; region?: string; postalCode: string; country: string }
export interface Label {
  labelId: string; orderId: string; version: number; test: boolean; service: "GA" | "PM" | "EM";
  box: (typeof BOXES)[number]; weightOz: number; carrier: string; tracking: string; status: "bought" | "cancelled";
  createdAt: string; cancelledAt: string | null; practice: boolean; priceCents: number | null; refund: string | null; delivery: null;
}

class ShipError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

function storage(db: Db) {
  return {
    orders: new PluginStorageRepository<CommerceOrder>(db, COMMERCE, "orders", []),
    labels: new PluginStorageRepository<Label>(db, STAND_IN, "labels", []),
  };
}

async function allOrders(store: ReturnType<typeof storage>): Promise<{ id: string; data: CommerceOrder }[]> {
  const found: { id: string; data: CommerceOrder }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const result = await store.orders.query({ limit: 100, ...(cursor ? { cursor } : {}) });
    found.push(...result.items);
    cursor = result.cursor;
    if (!cursor) break;
  }
  return found;
}

async function labelsFor(store: ReturnType<typeof storage>, orderId: string): Promise<Label[]> {
  const result = await store.labels.query({ limit: 100 });
  return result.items.map(item => item.data).filter(label => label.orderId === orderId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function shipOrder(record: CommerceOrder, labels: Label[]) {
  const address = record.delivery ?? record.paidOrder.contactSnapshot?.contact?.delivery;
  const lines = record.paidOrder.lines.map(line => ({ name: line.name, quantity: line.quantity, weightOz: LABEL_WEIGHT_OZ }));
  return {
    orderId: record.paidOrder.orderId,
    number: record.number ?? null,
    version: record.revision ?? 1,
    status: record.completed ? "completed" as const : "processing" as const,
    test: record.paidOrder.mode !== "live",
    shipTo: address
      ? { name: address.name, lines: [address.line1, ...(address.line2 ? [address.line2] : [])], city: address.city, region: address.region ?? "", postalCode: address.postalCode }
      : { name: "", lines: [], city: "", region: "", postalCode: "" },
    addressProblem: address ? (address.country === "US" ? null : "Ship labels go to US addresses only.") : "This order has no shipping address.",
    lines,
    itemsWeightOz: lines.reduce((sum, line) => sum + line.quantity * LABEL_WEIGHT_OZ, 0),
    label: labels.find(label => label.status === "bought") ?? null,
    labels,
  };
}

async function findOrder(store: ReturnType<typeof storage>, orderId: string) {
  const entry = (await allOrders(store)).find(item => item.data.paidOrder?.orderId === orderId);
  if (!entry) throw new ShipError(404, "NOT_FOUND", "Ship has no such order for this store.");
  return entry;
}

async function ship(path: string, method: string, init: RequestInit | undefined, requestOrigin: string): Promise<Response> {
  const db = getRequestContext()?.db as Db | undefined;
  if (!db) return json({ error: { code: "INTERNAL", message: "unavailable" } }, 503);
  const store = storage(db);
  try {
    if (method === "GET" && path === "/v1/admin/orders") {
      const orders = await Promise.all((await allOrders(store)).map(async ({ data }) => shipOrder(data, await labelsFor(store, data.paidOrder.orderId))));
      orders.sort((a, b) => (a.status === b.status ? (b.number ?? 0) - (a.number ?? 0) : a.status === "processing" ? -1 : 1));
      return json({
        orders: orders.map(order => ({
          orderId: order.orderId, number: order.number, version: order.version, status: order.status, test: order.test,
          shipTo: order.shipTo, addressProblem: order.addressProblem,
          items: order.lines.map(line => `${line.quantity} × ${line.name}`).join(", "),
          itemCount: order.lines.reduce((sum, line) => sum + line.quantity, 0),
          labelStatus: order.label ? "bought" : order.labels[0]?.status ?? null,
          delivery: null,
        })),
        settings: SHIP_SETTINGS,
        open: null,
      });
    }
    const orderMatch = /^\/v1\/admin\/orders\/([^/]+)(\/prices|\/labels)?$/.exec(path);
    if (orderMatch) {
      const orderId = decodeURIComponent(orderMatch[1]!);
      const { id, data } = await findOrder(store, orderId);
      const current = shipOrder(data, await labelsFor(store, orderId));
      if (method === "GET" && !orderMatch[2]) return json({ order: current, settings: SHIP_SETTINGS });
      // A practice label asks Pitney Bowes nothing, so there are no prices.
      if (method === "POST" && orderMatch[2] === "/prices") return json({ prices: {} });
      if (method === "POST" && orderMatch[2] === "/labels") {
        const request = await readJson(init);
        if (request.version !== current.version) throw new ShipError(409, "STALE", "This order changed. Open it again.");
        if (current.label) throw new ShipError(409, "LABEL_EXISTS", "This order already has a label. Cancel it to make another.");
        if (current.addressProblem) throw new ShipError(409, "ADDRESS", current.addressProblem);
        const box = BOXES.find(candidate => candidate.boxId === request.boxId);
        const weightOz = Number(request.weightOz);
        if (!box || !Number.isFinite(weightOz) || weightOz < 0.1 || weightOz > 1120) throw new ShipError(400, "INVALID", "Pick a box and a weight from 0.1 to 1120 oz.");
        const service = request.service === "PM" || request.service === "EM" ? request.service : "GA";
        const at = new Date().toISOString();
        const tracking = `TEST${Array.from(crypto.getRandomValues(new Uint8Array(9)), byte => String(byte % 10)).join("")}`;
        const label: Label = {
          labelId: `practice_${random(9)}`, orderId, version: current.version, test: true, service, box, weightOz,
          carrier: "USPS", tracking, status: "bought", createdAt: at, cancelledAt: null, practice: true, priceCents: null, refund: null, delivery: null,
        };
        await store.labels.put(label.labelId, label);
        // As on a real store, a label marks the order Completed (shipped) in Commerce.
        await store.orders.put(id, { ...data, revision: current.version + 1, completed: { at, carrier: "USPS", tracking } });
        return json({ label });
      }
    }
    const labelMatch = /^\/v1\/admin\/labels\/([^/]+)\/(cancel|print-link)$/.exec(path);
    if (method === "POST" && labelMatch) {
      const labelId = decodeURIComponent(labelMatch[1]!);
      const label = await store.labels.get(labelId);
      if (!label) throw new ShipError(404, "NOT_FOUND", "Ship has no such label for this store.");
      if (labelMatch[2] === "print-link") {
        return json({ url: `${requestOrigin}/playground-practice-label.pdf`, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() });
      }
      if (label.status === "cancelled") return json({ labelId, refund: null });
      await store.labels.put(labelId, { ...label, status: "cancelled", cancelledAt: new Date().toISOString() });
      const { id, data } = await findOrder(store, label.orderId);
      if (data.completed?.tracking === label.tracking) {
        const { completed: _completed, ...reopened } = data;
        await store.orders.put(id, { ...reopened, revision: (data.revision ?? 1) + 1 });
      }
      return json({ labelId, refund: null });
    }
    return json({ error: { code: "NOT_FOUND", message: "Ship has no such page." } }, 404);
  } catch (error) {
    if (error instanceof ShipError) return json({ error: { code: error.code, message: error.message } }, error.status);
    return json({ error: { code: "INTERNAL", message: "unavailable" } }, 500);
  }
}

// ---------------------------------------------------------------------------

function headerOf(input: RequestInfo | URL, init: RequestInit | undefined, name: string): string | null {
  if (init?.headers) return new Headers(init.headers).get(name);
  return input instanceof Request ? input.headers.get(name) : null;
}

/**
 * Wraps fetch so the plugins' DinkusKit.com, Payments and Ship calls are
 * answered here. Calls this stand-in did not start (the playground's own test
 * checkout, which carries the real Payments key and passes) go out as they are.
 */
/**
 * The key EmDash encrypts plugin secret settings with (Payments and Ship keep
 * their Connect sign-in there). A playground store holds only pretend keys, so
 * the Worker makes its own. Every isolate must make the same key, since a
 * visitor's store outlives the isolate that saved to it: it comes from the
 * Worker's checkout secret, or from a fixed phrase when checkout is off.
 */
export async function playgroundPluginSettingsKey(env: Record<string, unknown>): Promise<string> {
  const secret = typeof env.PAYMENTS_STORE_KEY === "string" && env.PAYMENTS_STORE_KEY ? env.PAYMENTS_STORE_KEY : "checkout-off";
  return `emdash_enc_v1_${base64url(await sha256(`dinkuskit-playground:plugin-settings:${secret}`))}`;
}

const DOH_ORIGIN = "https://cloudflare-dns.com";

/** The store origin EmDash gives the plugins (the Worker sets it from the first request), else this request's. */
function playgroundSiteOrigin(requestOrigin: string): string {
  const configured = typeof process !== "undefined" ? process.env.EMDASH_SITE_URL : undefined;
  try { return configured ? new URL(configured).origin : requestOrigin; } catch { return requestOrigin; }
}
const STAND_IN_HOSTS = new Set(["dinkuskit.com", "payments.dinkuskit.com", "ship.dinkuskit.com"]);

/**
 * EmDash looks up a plugin's host before each call, to refuse private
 * addresses. The playground answers these hosts itself, so it answers that
 * lookup too, with a public address, and needs no network to connect.
 */
function dnsAnswer(name: string | null, type: string | null): Response | null {
  if (!name || !STAND_IN_HOSTS.has(name.toLowerCase())) return null;
  const answer = type === "A" ? [{ name, type: 1, TTL: 300, data: "104.16.0.1" }] : [];
  return new Response(JSON.stringify({ Status: 0, Answer: answer }), { headers: { "content-type": "application/dns-json" } });
}

export function playgroundDinkusKitFetch(
  realFetch: typeof fetch,
  options: { env: () => Record<string, unknown>; origin: () => string },
): typeof fetch {
  return async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let url: URL;
    try { url = new URL(href); } catch { return realFetch(input, init); }
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const authorization = headerOf(input, init, "authorization");
    if (url.origin === DOH_ORIGIN && url.pathname === "/dns-query") {
      const answered = dnsAnswer(url.searchParams.get("name"), url.searchParams.get("type"));
      if (answered) return answered;
    }
    if (url.origin === "https://dinkuskit.com") {
      if (url.href === CONNECT_URL && method === "POST") return connect(init);
      if (url.href === `${CONNECT_URL}/token` && method === "POST") return connectToken(init);
      if (url.href === JWKS_URL) return json({ keys: [(await key()).jwk] });
      if (url.href === STORE_PASSES_URL && method === "POST") return (await storePass(authorization, init, options.env())) ?? realFetch(input, init);
      if (url.pathname === COMMERCE_SETTINGS_PATH && method === "GET" && signedHere(authorization)) {
        return commerceSettings(options.env(), playgroundSiteOrigin(options.origin()));
      }
    }
    if (url.origin === PAYMENTS_ORIGIN && signedHere(authorization)) return payments(url.pathname, method, options.env());
    if (url.origin === PAYMENTS_ORIGIN && typeof input === "string") return guardedPayments(realFetch, options.env(), url.href, init);
    if (url.origin === SHIP_ORIGIN && signedHere(authorization)) return ship(url.pathname, method, init, options.origin());
    return realFetch(input, init);
  };
}
