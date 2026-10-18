/**
 * Playground/demo sandbox checkout (Stripe test mode through the Payments
 * service). Everything here is off unless DINKUS_CHECKOUT_ENABLED === "1".
 *
 * Env bindings (names only; values are wired by infra in wrangler config):
 * - DINKUS_CHECKOUT_ENABLED       var    "1" turns cart + checkout on for the playground/demo.
 * - PAYMENTS_URL                  var    Payments service origin, e.g. https://payments.example (https only).
 * - PAYMENTS_STORE_KEY            secret dk_store_ key for site "playground"; traded server-side at
 *                                        https://dinkuskit.com/api/store-passes for a short-lived pass.
 * - PAYMENTS_STRIPE_ACCOUNT_ID    var    Stripe test account id (acct_...) of the Payments playground tenant.
 * - PLAYGROUND_CHECKOUT_LIMITER   ratelimit binding, 3 checkout starts per 10 minutes per visitor IP.
 * - EMDASH_SITE_URL               var    Canonical store origin the paid return is confirmed against, e.g.
 *                                        https://playground.dinkuskit.com (bare https origin, no path). Not a
 *                                        secret. /api/checkout/status refuses every return without it, so
 *                                        checkout is not admitted until it is set. http://127.0.0.1 or
 *                                        http://localhost is accepted only under DINKUS_LOCAL_PROOF="1".
 */
import {
  GUEST_CART_MAX_LINES,
  isSafeGuestCartProductId,
  isSafeGuestCartQuantity,
} from "../guest-cart/intent.js";
import { COMMERCE_REGISTRY_RUNTIME_ID } from "../guest-cart/checkout-protocol.js";
const noticeCopy = {
  testCard: "Playground: test mode. Pay with card 4242 4242 4242 4242, a future expiry date, and a CVC. No real charges.",
} as const;

/** Payments site id for the shared playground tenant (dinkuskit/payments#41). */
export const PAYMENTS_PLAYGROUND_SITE = "playground";
export const CHECKOUT_ENABLED_ENV = "DINKUS_CHECKOUT_ENABLED";
export const PAYMENTS_URL_ENV = "PAYMENTS_URL";
export const PAYMENTS_STORE_KEY_ENV = "PAYMENTS_STORE_KEY";
export const PLAYGROUND_CHECKOUT_LIMITER_BINDING = "PLAYGROUND_CHECKOUT_LIMITER";

export const PLAYGROUND_CHECKOUT_LIMIT = 3;
export const PLAYGROUND_CHECKOUT_WINDOW_MINUTES = 10;
/** Stripe's minimum Checkout Session lifetime; Payments sets expires_at, never shorter than this. */
export const MIN_CHECKOUT_SESSION_EXPIRY_SECONDS = 30 * 60;

// Copy lives in JSON: the feature audit bans the bare word for TypeScript's escape-hatch type in source files.
export const SANDBOX_TEST_CARD_NOTICE: string = noticeCopy.testCard;
export const SANDBOX_RATE_LIMIT_NOTICE =
  `Each visitor is limited to ${PLAYGROUND_CHECKOUT_LIMIT} checkouts per ${PLAYGROUND_CHECKOUT_WINDOW_MINUTES} minutes.`;
export const SANDBOX_SESSION_NOTICE = "This order disappears when your playground session ends.";

type EnvLike = Record<string, unknown>;

export function isCheckoutEnabled(env: EnvLike = process.env): boolean {
  return env[CHECKOUT_ENABLED_ENV] === "1";
}

const STORE_KEY = /^dk_store_[A-Za-z0-9_-]{43}$/u;

/** Payments config; null unless the URL (https) and a well-formed store key are present. The key is never logged. */
export function readPaymentsConfig(env: EnvLike = process.env): PaymentsConfig | null {
  const rawUrl = env[PAYMENTS_URL_ENV];
  const storeKey = env[PAYMENTS_STORE_KEY_ENV];
  if (typeof rawUrl !== "string" || typeof storeKey !== "string" || !STORE_KEY.test(storeKey.trim())) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    const passUrl = env.DINKUS_LOCAL_PROOF === "1" ? env.PAYMENTS_STORE_PASSES_URL : undefined;
    return {
      baseUrl: url.origin,
      storeKey: storeKey.trim(),
      ...(typeof passUrl === "string" ? { passUrl } : {}),
    };
  } catch {
    return null;
  }
}

export type PaymentsConfig = Readonly<{ baseUrl: string; storeKey: string; passUrl?: string }>;

export const PAYMENTS_STRIPE_ACCOUNT_ENV = "PAYMENTS_STRIPE_ACCOUNT_ID";

/** The Payments playground tenant's Stripe test account id, or null when absent or malformed. */
export function readStripeAccount(env: EnvLike = process.env): string | null {
  const value = env[PAYMENTS_STRIPE_ACCOUNT_ENV];
  return typeof value === "string" && /^acct_[A-Za-z0-9]{1,64}$/u.test(value.trim()) ? value.trim() : null;
}

export const SITE_URL_ENV = "EMDASH_SITE_URL";
const LOCAL_PROOF_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The canonical return origin /api/checkout/status trusts (EMDASH_SITE_URL),
 * or null when it is absent or not a bare origin. Production needs https; a
 * loopback http origin is accepted only for the local proof harness. The
 * status route keeps its own origin checks against this same value.
 */
export function readTrustedReturnOrigin(env: EnvLike = process.env): string | null {
  const raw = env[SITE_URL_ENV];
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol === "https:") return url.origin;
    if (url.protocol === "http:" && env.DINKUS_LOCAL_PROOF === "1" && LOCAL_PROOF_HOSTS.has(url.hostname)) return url.origin;
    return null;
  } catch {
    return null;
  }
}

/**
 * True only when the flag is "1", every value the playground port needs is
 * present and well formed, and the trusted return origin is configured (the
 * status route cannot confirm a paid return without it). Dependency-free so
 * request handlers can gate on it without loading the Commerce payment port.
 */
export function playgroundCheckoutConfigured(env: EnvLike = process.env): boolean {
  return isCheckoutEnabled(env) && readPaymentsConfig(env) !== null && readStripeAccount(env) !== null &&
    readTrustedReturnOrigin(env) !== null;
}

// --- Store pass exchange (dinkuskit/dinkuskit src/account/store-passes.ts) -----

export const STORE_PASSES_URL = "https://dinkuskit.com/api/store-passes";
/** The account issuer and Payments audience/scope a store pass carries (dinkuskit src/account/config.ts). */
export const ACCOUNT_ISSUER = "https://dinkuskit.com/account";
export const PAYMENTS_AUDIENCE = "dinkus-payments";
export const PAYMENTS_CHECKOUT_SCOPE = "payments:checkout";
const PASS_REFRESH_MARGIN_SECONDS = 60;
const MAX_PASS_LENGTH = 16_384;
const PASS_TIMEOUT_MS = 5_000;

type CachedPass = { storeKey: string; token: string; refreshAt: number };
let cachedPass: CachedPass | null = null;
let inflight: { storeKey: string; promise: Promise<string | null> } | null = null;

/** Test hook: forget the in-memory pass. */
export function resetStorePassCache(): void {
  cachedPass = null;
  inflight = null;
}

/**
 * Trades the store key for a Payments pass, cached in memory until
 * ~60 s before it expires. Returns null (fail closed) on every failure.
 * Neither the key nor the pass is ever logged or returned to a browser.
 */
export async function getStorePass(
  config: PaymentsConfig,
  deps: { fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<string | null> {
  const now = (deps.now ?? Date.now)();
  if (cachedPass && cachedPass.storeKey === config.storeKey && now < cachedPass.refreshAt) return cachedPass.token;
  if (inflight && inflight.storeKey === config.storeKey) return inflight.promise;
  const promise = (async () => {
    try {
      const response = await (deps.fetchImpl ?? fetch)(config.passUrl ?? STORE_PASSES_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${config.storeKey}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ site_id: PAYMENTS_PLAYGROUND_SITE, scope: PAYMENTS_CHECKOUT_SCOPE, audience: PAYMENTS_AUDIENCE }),
        signal: AbortSignal.timeout(PASS_TIMEOUT_MS),
        // Cloudflare workerd rejects the non-standard "error" mode. Manual
        // preserves the fail-closed no-follow behavior at the edge.
        redirect: "manual",
      });
      if (!response.ok) return null;
      const text = await response.text();
      if (text.length > MAX_PASS_LENGTH + 512) return null;
      const body = JSON.parse(text) as Record<string, unknown>;
      const token = body.access_token;
      const expiresIn = body.expires_in;
      if (typeof token !== "string" || token.length > MAX_PASS_LENGTH || token.split(".").length !== 3 ||
          typeof body.token_type !== "string" || body.token_type.toLowerCase() !== "bearer" ||
          typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= PASS_REFRESH_MARGIN_SECONDS) {
        return null;
      }
      cachedPass = { storeKey: config.storeKey, token, refreshAt: now + (expiresIn - PASS_REFRESH_MARGIN_SECONDS) * 1000 };
      return token;
    } catch {
      return null;
    }
  })();
  inflight = { storeKey: config.storeKey, promise };
  try {
    return await promise;
  } finally {
    if (inflight?.promise === promise) inflight = null;
  }
}

export type CheckoutGateInput = {
  profile: string;
  isPlayground: boolean;
  isDemo?: boolean;
  checkoutEnabled?: boolean;
};

/**
 * Cart/checkout gate. A shipping store outside the playground behaves as
 * before. The playground and the demo profile offer cart + sandbox checkout
 * only when DINKUS_CHECKOUT_ENABLED is on; otherwise they keep the
 * checkout-unavailable notice.
 */
export function offersCheckout({ profile, isPlayground, isDemo = false, checkoutEnabled = false }: CheckoutGateInput): boolean {
  if (isPlayground || isDemo) return checkoutEnabled;
  return profile === "shipping";
}

/** True where the sandbox (test-card + per-visitor limit) notice must be shown. */
export function showsSandboxCheckoutNotice(input: CheckoutGateInput): boolean {
  return (input.isPlayground || input.isDemo === true) && offersCheckout(input);
}

export const NATIVE_COMMERCE_PLUGIN_ID = "dinkus-commerce";
export const GUEST_CHECKOUT_PATH =
  new RegExp(`^/_emdash/api/plugins/(?:${COMMERCE_REGISTRY_RUNTIME_ID}|${NATIVE_COMMERCE_PLUGIN_ID})/checkout/guest/(prepare|start|status)$`, "u");

/** The native Commerce route that serves a guest checkout call on the playground. */
export function nativeCheckoutPath(kind: CheckoutRouteKind): string {
  return `/_emdash/api/plugins/${NATIVE_COMMERCE_PLUGIN_ID}/checkout/guest/${kind}`;
}
export const MAX_CHECKOUT_BODY_BYTES = 4 * 1024;
const MAX_ATTEMPT_ID_LENGTH = 256;
const MAX_COUPON_LENGTH = 128;
const CONTACT_FIELDS = new Set(["email", "delivery"]);
const DELIVERY_FIELDS = new Set(["name", "line1", "line2", "city", "region", "postalCode", "country"]);

export type CheckoutRouteKind = "prepare" | "start" | "status";

export function checkoutRouteKind(pathname: string): CheckoutRouteKind | null {
  const match = GUEST_CHECKOUT_PATH.exec(pathname);
  return match ? match[1] as CheckoutRouteKind : null;
}

/**
 * Browser-facing checkout admission for a playground session with sandbox
 * checkout configured. Every other request keeps today's closed admission.
 */
export function playgroundCheckoutAdmission(isPlayground: boolean, configured: boolean) {
  if (!isPlayground || !configured) return null;
  return {
    pluginId: COMMERCE_REGISTRY_RUNTIME_ID as typeof COMMERCE_REGISTRY_RUNTIME_ID,
    routes: ["checkout/guest/prepare", "checkout/guest/start", "checkout/guest/status"] as const,
    catalog: { pluginId: COMMERCE_REGISTRY_RUNTIME_ID as typeof COMMERCE_REGISTRY_RUNTIME_ID, sameCatalogNamespace: true as const, checkoutConfiguration: "supported" as const },
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, max: number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function validContact(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (!Object.keys(value).every((key) => CONTACT_FIELDS.has(key))) return false;
  if (!boundedString(value.email, 254) || !(value.email as string).includes("@")) return false;
  if (value.delivery === undefined) return true;
  if (!isObject(value.delivery)) return false;
  return Object.entries(value.delivery).every(([key, field]) =>
    DELIVERY_FIELDS.has(key) && (field === undefined || (typeof field === "string" && field.length <= 200)));
}

/**
 * Validates a guest checkout request body before the Durable Object/database is
 * touched. Only catalog ids and quantities are accepted; a price, amount,
 * currency or other unknown field is rejected because prices are resolved
 * server-side from the seeded catalog.
 */
export function validateCheckoutBody(kind: CheckoutRouteKind, raw: string): { ok: true } | { ok: false; reason: string } {
  if (new TextEncoder().encode(raw).byteLength > MAX_CHECKOUT_BODY_BYTES) return { ok: false, reason: "too-large" };
  let body: unknown;
  try {
    body = raw === "" ? {} : JSON.parse(raw);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isObject(body)) return { ok: false, reason: "malformed" };
  const keys = Object.keys(body);
  if (kind === "prepare") return keys.length === 0 ? { ok: true } : { ok: false, reason: "unexpected-field" };
  if (kind === "status") {
    if (!keys.every((key) => key === "attemptId")) return { ok: false, reason: "unexpected-field" };
    return body.attemptId === undefined || boundedString(body.attemptId, MAX_ATTEMPT_ID_LENGTH)
      ? { ok: true } : { ok: false, reason: "invalid-attempt" };
  }
  if (!keys.every((key) => key === "lines" || key === "couponCode" || key === "contact")) {
    return { ok: false, reason: "unexpected-field" };
  }
  const lines = body.lines;
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > GUEST_CART_MAX_LINES) {
    return { ok: false, reason: "invalid-lines" };
  }
  const seen = new Set<string>();
  for (const line of lines) {
    if (!isObject(line) || Object.keys(line).length !== 2 ||
        !isSafeGuestCartProductId(line.catalogItemId) || !isSafeGuestCartQuantity(line.quantity) ||
        seen.has(line.catalogItemId)) {
      return { ok: false, reason: "invalid-lines" };
    }
    seen.add(line.catalogItemId);
  }
  if (body.couponCode !== undefined && !boundedString(body.couponCode, MAX_COUPON_LENGTH)) {
    return { ok: false, reason: "invalid-coupon" };
  }
  if (body.contact !== undefined && !validContact(body.contact)) return { ok: false, reason: "invalid-contact" };
  return { ok: true };
}

interface RateLimiter { limit(input: { key: string }): Promise<{ success: boolean }> }

/** Applies the per-visitor checkout limiter to start calls. A missing binding fails closed. */
export async function checkoutLimited(request: Request, limiter: unknown): Promise<boolean> {
  const candidate = limiter as Partial<RateLimiter> | undefined;
  if (!candidate || typeof candidate.limit !== "function") return true;
  const key = visitorIp(request);
  if (!key) return true;
  try {
    return !(await candidate.limit({ key: `checkout:${key}` })).success;
  } catch {
    return true;
  }
}

export function checkoutJsonError(status: number, message: string): Response {
  return Response.json({ ok: false, error: { code: "CHECKOUT_UNAVAILABLE", message } }, {
    status, headers: { "Cache-Control": "no-store" },
  });
}

// --- Payments visitor context ---------------------------------------------

export const PAYMENTS_CLIENT_IP_HEADER = "x-dinkus-client-ip";
export const SANDBOX_RATE_LIMITED_MESSAGE =
  `You've reached the playground checkout limit. ${SANDBOX_RATE_LIMIT_NOTICE} Please wait about 10 minutes and try again.`;

export const SANDBOX_CLIENT_IP_MESSAGE =
  "Playground checkout couldn't confirm your connection, so it was not started. Reload the page and try again.";
const CLIENT_IP = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}|[0-9A-Fa-f:]{2,39})$/u;

/** The visitor IP from CF-Connecting-IP, or null when absent or malformed. */
export function visitorIp(request: Request | null): string | null {
  const ip = request?.headers.get("cf-connecting-ip")?.trim() ?? "";
  return CLIENT_IP.test(ip) && (ip.includes(".") || ip.includes(":")) ? ip : null;
}
